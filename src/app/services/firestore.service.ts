import { Injectable } from '@angular/core';
import {
  getFirestore,
  Firestore,
  collection,
  query,
  where,
  limit,
  getDocs,
  updateDoc,
  setDoc,
  doc,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';
import { firebaseApp } from '../firebase.config';
import { CasoModel, EstadoCaso } from '../comp/dashboard-llamador/caso.model';

export interface UsuarioApp {
  uid: string;
  email: string;
  apodo: string;
  creadoEn?: any;
}

export interface UploadResult {
  total: number;
  subidos: number;
  errores: number;
}

export interface LlamadorStats {
  email: string;
  nombre: string;        // apodo si existe, sino email
  consumidos: number;
  acepto: number;
  interesado: number;
  sinContacto: number;
  conAbogado: number;
  noInteresado: number;
}

// Nombre real de la colección en Firestore (default database)
const COL_CASOS = 'BDmadre';
const COL_USUARIOS = 'usuarios';

@Injectable({ providedIn: 'root' })
export class FirestoreService {
  private db: Firestore = getFirestore(firebaseApp);

  // ─── CASOS ───────────────────────────────────────────────

  async getSiguienteCaso(): Promise<CasoModel | null> {
    const ref = collection(this.db, COL_CASOS);
    const q = query(ref, where('procesado', '==', false), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const docSnap = snap.docs[0];
    return { id: docSnap.id, ...docSnap.data() } as CasoModel;
  }

  async marcarProcesado(id: string, estado: EstadoCaso, procesadoPor: string, asignado: string = ''): Promise<void> {
    await updateDoc(doc(this.db, COL_CASOS, id), {
      procesado: true,
      estado,
      procesadoPor,
      ASGINADO: asignado || procesadoPor,
      procesadoTimestamp: serverTimestamp()
    });
  }

  async getApodoPorEmail(email: string): Promise<string> {
    const snap = await getDocs(collection(this.db, COL_USUARIOS));
    const usuario = snap.docs.map(d => d.data() as UsuarioApp).find(u => u.email === email);
    return usuario?.apodo || email;
  }

  async getHistorialPor(email: string): Promise<CasoModel[]> {
    const ref = collection(this.db, COL_CASOS);
    const q = query(
      ref,
      where('procesadoPor', '==', email),
      where('procesado', '==', true)
    );
    const snap = await getDocs(q);
    const casos = snap.docs.map(d => ({ id: d.id, ...d.data() } as CasoModel));
    return casos.sort((a, b) => {
      const ta = a.procesadoTimestamp ?? '';
      const tb = b.procesadoTimestamp ?? '';
      return tb > ta ? 1 : -1;
    });
  }

  async getHistorialCompleto(): Promise<CasoModel[]> {
    const ref = collection(this.db, COL_CASOS);
    const q = query(ref, where('procesado', '==', true));
    const snap = await getDocs(q);
    const casos = snap.docs.map(d => ({ id: d.id, ...d.data() } as CasoModel));
    return casos.sort((a, b) => {
      const ta = a.procesadoTimestamp ?? '';
      const tb = b.procesadoTimestamp ?? '';
      return tb > ta ? 1 : -1;
    });
  }

  /**
   * Sube filas del Excel a la colección BDmadre en lotes de 499.
   * Agrega campos de control: procesado, estado, procesadoPor, creadoEn.
   */
  async uploadCasos(
    filas: Record<string, any>[],
    onProgress?: (subidos: number, total: number) => void
  ): Promise<UploadResult> {
    const total = filas.length;
    const chunkSize = 499;
    let subidos = 0;
    let errores = 0;

    for (let i = 0; i < filas.length; i += chunkSize) {
      const chunk = filas.slice(i, i + chunkSize);
      const batch = writeBatch(this.db);

      for (const fila of chunk) {
        const ref = doc(collection(this.db, COL_CASOS));
        batch.set(ref, {
          ...fila,
          procesado: false,
          estado: '',
          procesadoPor: '',
          procesadoTimestamp: null,
          creadoEn: serverTimestamp()
        });
      }

      try {
        await batch.commit();
        subidos += chunk.length;
      } catch {
        errores += chunk.length;
      }

      onProgress?.(subidos, total);
    }

    return { total, subidos, errores };
  }

  // ─── USUARIOS ────────────────────────────────────────────

  async guardarUsuario(uid: string, email: string, apodo: string = ''): Promise<void> {
    await setDoc(doc(this.db, COL_USUARIOS, uid), {
      uid, email, apodo, creadoEn: serverTimestamp()
    });
  }

  async getUsuarios(): Promise<UsuarioApp[]> {
    const snap = await getDocs(collection(this.db, COL_USUARIOS));
    return snap.docs.map(d => d.data() as UsuarioApp);
  }

  async actualizarApodo(uid: string, apodo: string): Promise<void> {
    await updateDoc(doc(this.db, COL_USUARIOS, uid), { apodo });
  }

  async getEstadisticasAdmin(): Promise<LlamadorStats[]> {
    // Traer todos los casos procesados
    const ref = collection(this.db, COL_CASOS);
    const q = query(ref, where('procesado', '==', true));
    const snap = await getDocs(q);

    // Traer usuarios para mapear email → apodo
    const usuarios = await this.getUsuarios();
    const apodoMap = new Map<string, string>();
    for (const u of usuarios) {
      const apodo = u.apodo?.trim() || u.email.split('@')[0];
      apodoMap.set(u.email.toLowerCase(), apodo);
    }

    // Agrupar por procesadoPor
    const mapa = new Map<string, LlamadorStats>();
    for (const d of snap.docs) {
      const data = d.data();
      const email: string = data['procesadoPor'] || '';
      if (!email) continue;

      if (!mapa.has(email)) {
        // Prefer ASGINADO (apodo saved on the case), then users collection lookup, then part before @
        const nombre = data['ASGINADO']?.trim() || apodoMap.get(email.toLowerCase()) || email.split('@')[0];
        mapa.set(email, {
          email,
          nombre,
          consumidos: 0,
          acepto: 0,
          interesado: 0,
          sinContacto: 0,
          conAbogado: 0,
          noInteresado: 0,
        });
      }

      const entry = mapa.get(email)!;
      // Update nombre if we now have a better value (ASGINADO) and currently showing raw email
      if (data['ASGINADO']?.trim() && entry.nombre === email.split('@')[0]) {
        entry.nombre = data['ASGINADO'].trim();
      }
      entry.consumidos++;

      switch (data['estado']) {
        case 'acepto':       entry.acepto++;       break;
        case 'interesado':   entry.interesado++;   break;
        case 'sincontacto':  entry.sinContacto++;  break;
        case 'conabogado':   entry.conAbogado++;   break;
        case 'nointeresado': entry.noInteresado++; break;
      }
    }

    return Array.from(mapa.values()).sort((a, b) => b.consumidos - a.consumidos);
  }
}

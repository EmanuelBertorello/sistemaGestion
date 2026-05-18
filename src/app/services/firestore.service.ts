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
  deleteDoc,
  setDoc,
  addDoc,
  doc,
  writeBatch,
  arrayUnion,
  onSnapshot,
  orderBy,
  serverTimestamp,
  Timestamp,
  increment,
  startAfter,
  getDoc
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

export interface NoticiaItem {
  id: string;
  titulo: string;
  cuerpo: string;
  autor: string;
  creadoEn?: any;
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
const COL_CASOS_VENTA_SI = 'casos_ventasi';
const COL_CASOS_ARCHIVO = 'casos_archivo';
const COL_USUARIOS = 'usuarios';
const COL_NOTIFICACIONES = 'notificaciones';
const COL_PRESENCIA = 'presencia';
const COL_NOTICIAS = 'noticias';
const COL_REGLAS = 'reglas_asignacion';
const COL_STATS = '_stats';
const COL_STATS_LLAMADORES = 'stats_llamadores';
const COL_COLA_CONTADORES = 'cola_contadores';

@Injectable({ providedIn: 'root' })
export class FirestoreService {
  private db: Firestore = getFirestore(firebaseApp);

  // ─── CASOS ───────────────────────────────────────────────

  // ── Contador de cola ─────────────────────────────────────
  private async _actualizarContador(delta: number, deltaVentaSi: number): Promise<void> {
    try {
      const ref = doc(this.db, COL_STATS, 'queue');
      const snap = await getDocs(query(collection(this.db, COL_STATS)));
      const exists = snap.docs.some(d => d.id === 'queue');
      if (exists) {
        await updateDoc(ref, {
          libres: Math.max(0, (await getDocs(query(collection(this.db, COL_CASOS), where('procesado', '==', false), where('ASGINADO', '==', '')))).docs.filter(d => !this._esVentaSi(d.data())).length)
        });
      } else {
        await setDoc(ref, { libres: 0 });
      }
    } catch { /* no bloquear el upload si el contador falla */ }
  }

  async archivarCasosViejos(diasMinimos = 90, onProgress?: (n: number) => void): Promise<number> {
    const corte = new Date();
    corte.setDate(corte.getDate() - diasMinimos);
    const ref = collection(this.db, COL_CASOS);
    const snap = await getDocs(query(ref, where('procesado', '==', true),
      where('procesadoTimestamp', '<=', Timestamp.fromDate(corte))));
    let archivados = 0;
    const chunkSize = 499;
    for (let i = 0; i < snap.docs.length; i += chunkSize) {
      const chunk = snap.docs.slice(i, i + chunkSize);
      const batch = writeBatch(this.db);
      for (const d of chunk) {
        const archRef = doc(collection(this.db, COL_CASOS_ARCHIVO));
        batch.set(archRef, { ...d.data(), archivadoEn: serverTimestamp() });
        batch.delete(d.ref);
      }
      await batch.commit();
      archivados += chunk.length;
      onProgress?.(archivados);
    }
    return archivados;
  }

  async migrarVentaSiAColeccionSeparada(onProgress?: (n: number) => void): Promise<number> {
    const snap = await getDocs(query(collection(this.db, COL_CASOS), where('procesado', '==', false)));
    const ventaSiDocs = snap.docs.filter(d =>
      d.data()['esVentaSi'] === undefined && this._esVentaSi(d.data())
    );
    let migrados = 0;
    const chunkSize = 499;
    for (let i = 0; i < ventaSiDocs.length; i += chunkSize) {
      const chunk = ventaSiDocs.slice(i, i + chunkSize);
      const batch = writeBatch(this.db);
      for (const d of chunk) {
        const newRef = doc(collection(this.db, COL_CASOS_VENTA_SI));
        batch.set(newRef, { ...d.data(), esVentaSi: true });
        batch.delete(d.ref);
      }
      await batch.commit();
      migrados += chunk.length;
      onProgress?.(migrados);
    }
    return migrados;
  }

  private _esVentaSi(data: any): boolean {
    const val = (data['venta'] ?? data['Venta'] ?? data['VENTA'] ?? '').toString().toLowerCase().trim();
    return val === 'si' || val === 'sí';
  }

  private _buildVariantes(apodo?: string, email?: string): Set<string> {
    const v = new Set<string>();
    const add = (s: string) => {
      if (!s || s.length < 2) return;
      const t = s.trim();
      v.add(t);
      v.add(t.toLowerCase());
      v.add(t.toUpperCase());
      v.add(t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
      // cada palabra por separado
      t.split(/\s+/).forEach(w => {
        const c = w.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, '');
        if (c.length >= 2) { v.add(c); v.add(c.toLowerCase()); v.add(c.toUpperCase()); v.add(c.charAt(0).toUpperCase() + c.slice(1).toLowerCase()); }
      });
      // si es email, también el prefijo
      if (t.includes('@')) add(t.split('@')[0]);
    };
    if (apodo) add(apodo);
    if (email) add(email);
    return v;
  }

  async getSiguienteCaso(apodoUsuario?: string, emailUsuario?: string, perfil?: string): Promise<CasoModel | null> {
    const ref = collection(this.db, COL_CASOS);

    const matchPerfil = (data: any): boolean => {
      if (!perfil) return true; // sin perfil → ve todo
      const tc = (data['tipoCaso'] ?? '').toString().trim();
      if (perfil === 'highticket') return tc === '1';
      if (perfil === 'volumen') return tc === '0';
      return true;
    };

    // Correr en paralelo: asignados + libres (más rápido, sin riesgo de timeout encadenado)
    const qLibre = getDocs(query(ref, where('procesado', '==', false), where('ASGINADO', '==', '')));

    let snapAsignados: any[] = [];
    if (apodoUsuario || emailUsuario) {
      const variantes = this._buildVariantes(apodoUsuario, emailUsuario);
      const arr = Array.from(variantes).filter(v => v.length >= 2);
      const chunks: string[][] = [];
      for (let i = 0; i < arr.length; i += 30) chunks.push(arr.slice(i, i + 30));
      const [snapLibre, ...snapsAsig] = await Promise.all([
        qLibre,
        ...chunks.map(ch => getDocs(query(ref, where('procesado', '==', false), where('ASGINADO', 'in', ch))))
      ]);
      // Preferir asignado
      for (const snap of snapsAsig) {
        const found = snap.docs.find((d: any) => !this._esVentaSi(d.data()) && matchPerfil(d.data()));
        if (found) return { id: found.id, ...found.data() } as CasoModel;
      }
      // Fallback: libre
      const libre = snapLibre.docs.find((d: any) => !this._esVentaSi(d.data()) && matchPerfil(d.data()));
      if (libre) return { id: libre.id, ...libre.data() } as CasoModel;
    } else {
      const snapLibre = await qLibre;
      const libre = snapLibre.docs.find((d: any) => !this._esVentaSi(d.data()) && matchPerfil(d.data()));
      if (libre) return { id: libre.id, ...libre.data() } as CasoModel;
    }

    // Fallback: registros viejos sin campo ASGINADO
    const snapAll = await getDocs(query(ref, where('procesado', '==', false), limit(1000)));
    const legacy = snapAll.docs.find(d => d.data()['ASGINADO'] === undefined && !this._esVentaSi(d.data()) && matchPerfil(d.data()));
    if (legacy) return { id: legacy.id, ...legacy.data() } as CasoModel;

    return null;
  }

  async getCasosVentaSi(): Promise<CasoModel[]> {
    // Nueva colección dedicada (nuevos uploads)
    const [snapNuevo, snapOld] = await Promise.all([
      getDocs(query(collection(this.db, COL_CASOS_VENTA_SI), where('procesado', '==', false))),
      // BDmadre legacy — VentaSI que se subieron antes de la separación de colecciones
      getDocs(query(collection(this.db, COL_CASOS), where('esVentaSi', '==', true))),
    ]);
    // También buscar VentaSI viejos sin campo esVentaSi (client-side filter)
    const snapLegacy = await getDocs(query(collection(this.db, COL_CASOS), where('procesado', '==', false)));
    const legacyVentaSi = snapLegacy.docs
      .filter(d => d.data()['esVentaSi'] === undefined && this._esVentaSi(d.data()));

    const seen = new Set<string>();
    const todos: CasoModel[] = [];
    for (const d of [...snapNuevo.docs, ...snapOld.docs, ...legacyVentaSi]) {
      if (!seen.has(d.id)) { seen.add(d.id); todos.push({ id: d.id, ...d.data() } as CasoModel); }
    }
    return todos;
  }

  /** Elimina todos los documentos de BDmadre (procesados y no procesados) */
  async vaciarBDMadre(onProgress?: (eliminados: number) => void): Promise<{ eliminados: number }> {
    const ref = collection(this.db, COL_CASOS);
    const snap = await getDocs(ref);
    const ids = snap.docs.map(d => d.id);
    let eliminados = 0;
    const chunkSize = 499;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const batch = writeBatch(this.db);
      for (const id of chunk) batch.delete(doc(this.db, COL_CASOS, id));
      await batch.commit();
      eliminados += chunk.length;
      onProgress?.(eliminados);
    }
    return { eliminados };
  }

  /** Elimina todos los casos no procesados donde venta = 'si' (cualquier casing) */
  async eliminarVentaSi(onProgress?: (procesados: number) => void): Promise<{ eliminados: number }> {
    const ref = collection(this.db, COL_CASOS);
    // Traer TODOS los docs para atrapar también los que tienen procesado=undefined/null
    const snap = await getDocs(ref);
    const aEliminar = snap.docs.filter(d => {
      const data = d.data();
      if (data['procesado'] === true) return false; // ya procesados → no tocar
      const val = (data['venta'] ?? data['Venta'] ?? data['VENTA'] ?? '').toString().toLowerCase().trim();
      return val === 'si' || val === 'sí';
    }).map(d => d.id);

    let eliminados = 0;
    const chunkSize = 499;
    for (let i = 0; i < aEliminar.length; i += chunkSize) {
      const chunk = aEliminar.slice(i, i + chunkSize);
      const batch = writeBatch(this.db);
      for (const id of chunk) batch.delete(doc(this.db, COL_CASOS, id));
      await batch.commit();
      eliminados += chunk.length;
      onProgress?.(eliminados);
    }
    return { eliminados };
  }

  /** Elimina todos los casos no procesados donde el campo venta está vacío/ausente */
  async eliminarSinVenta(onProgress?: (procesados: number) => void): Promise<{ eliminados: number }> {
    const ref = collection(this.db, COL_CASOS);
    const snap = await getDocs(ref);
    const aEliminar = snap.docs.filter(d => {
      const data = d.data();
      if (data['procesado'] === true) return false;
      const val = (data['venta'] ?? data['Venta'] ?? data['VENTA'] ?? '').toString().toLowerCase().trim();
      return val === ''; // sin valor asignado
    }).map(d => d.id);

    let eliminados = 0;
    const chunkSize = 499;
    for (let i = 0; i < aEliminar.length; i += chunkSize) {
      const chunk = aEliminar.slice(i, i + chunkSize);
      const batch = writeBatch(this.db);
      for (const id of chunk) batch.delete(doc(this.db, COL_CASOS, id));
      await batch.commit();
      eliminados += chunk.length;
      onProgress?.(eliminados);
    }
    return { eliminados };
  }

  async getCasoAsignadoA(apodo: string, emailFallback?: string): Promise<CasoModel | null> {
    const ref = collection(this.db, COL_CASOS);
    const variantes = this._buildVariantes(apodo, emailFallback);
    const arr = Array.from(variantes).filter(v => v.length >= 2);
    const chunks: string[][] = [];
    for (let i = 0; i < arr.length; i += 30) chunks.push(arr.slice(i, i + 30));
    const snaps = await Promise.all(
      chunks.map(ch => getDocs(query(ref, where('procesado', '==', false), where('ASGINADO', 'in', ch), limit(1))))
    );
    const hit = snaps.find(s => !s.empty);
    if (hit) return { id: hit.docs[0].id, ...hit.docs[0].data() } as CasoModel;
    return null;
  }

  async reservarCaso(id: string, apodo: string): Promise<void> {
    await updateDoc(doc(this.db, COL_CASOS, id), { ASGINADO: apodo });
    this._incrementarContadorCola(apodo).catch(() => {});
  }

  async eliminarTodosCasosDeApodo(apodo: string): Promise<number> {
    const ref = collection(this.db, COL_CASOS);
    const variantes = [apodo, apodo.toLowerCase(), apodo.toUpperCase(),
      apodo.charAt(0).toUpperCase() + apodo.slice(1).toLowerCase()];
    const snaps = await Promise.all(
      [...new Set(variantes)].map(v => getDocs(query(ref, where('procesado', '==', false), where('ASGINADO', '==', v))))
    );
    const ids = [...new Set(snaps.flatMap(s => s.docs.map(d => d.id)))];
    const chunkSize = 499;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const batch = writeBatch(this.db);
      ids.slice(i, i + chunkSize).forEach(id => batch.delete(doc(this.db, COL_CASOS, id)));
      await batch.commit();
    }
    return ids.length;
  }

  async liberarTodosCasosDeApodo(apodo: string): Promise<number> {
    const ref = collection(this.db, COL_CASOS);
    const variantes = [apodo, apodo.toLowerCase(), apodo.toUpperCase(),
      apodo.charAt(0).toUpperCase() + apodo.slice(1).toLowerCase()];
    const snaps = await Promise.all(
      [...new Set(variantes)].map(v => getDocs(query(ref, where('procesado', '==', false), where('ASGINADO', '==', v))))
    );
    const ids = [...new Set(snaps.flatMap(s => s.docs.map(d => d.id)))];
    const chunkSize = 499;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const batch = writeBatch(this.db);
      ids.slice(i, i + chunkSize).forEach(id => batch.update(doc(this.db, COL_CASOS, id), { ASGINADO: '' }));
      await batch.commit();
    }
    return ids.length;
  }

  async liberarCaso(id: string, apodoAnterior?: string): Promise<void> {
    await updateDoc(doc(this.db, COL_CASOS, id), { ASGINADO: '' });
    if (apodoAnterior) this._decrementarContadorCola(apodoAnterior).catch(() => {});
  }

  async eliminarDuplicados(onProgress?: (procesados: number, total: number) => void): Promise<{ eliminados: number }> {
    const ref = collection(this.db, COL_CASOS);

    // Clave primaria: CUIL (normalizado). Fallback: Trabajador||Fecha_Accidente
    const claveDe = (data: any): string => {
      const cuil = (data['CUIL'] || data['CUIL_Definitiva'] || '').toString().replace(/\D/g, '').trim();
      if (cuil.length >= 10) return `cuil:${cuil}`;
      const trabajador = (data['Trabajador'] || '').trim().toUpperCase();
      const fecha = (data['Fecha_Accidente'] || '').trim();
      return `nombre:${trabajador}||${fecha}`;
    };

    // Procesar con cursor en páginas de 500 para evitar cargar toda la colección en memoria
    const PAGE_SIZE = 500;
    const visto = new Map<string, { id: string; procesado: boolean }>();
    const aEliminar: string[] = [];
    let cursor: any = null;
    let procesadosTotal = 0;

    while (true) {
      const q = cursor
        ? query(ref, orderBy('__name__'), startAfter(cursor), limit(PAGE_SIZE))
        : query(ref, orderBy('__name__'), limit(PAGE_SIZE));
      const snap = await getDocs(q);
      if (snap.empty) break;

      for (const d of snap.docs) {
        const data = d.data();
        const clave = claveDe(data);
        if (clave === 'cuil:' || clave === 'nombre:||') continue;
        const actualProcesado = data['procesado'] === true;

        if (visto.has(clave)) {
          const existente = visto.get(clave)!;
          if (actualProcesado && !existente.procesado) {
            aEliminar.push(existente.id);
            visto.set(clave, { id: d.id, procesado: true });
          } else {
            aEliminar.push(d.id);
          }
        } else {
          visto.set(clave, { id: d.id, procesado: actualProcesado });
        }
      }

      procesadosTotal += snap.docs.length;
      onProgress?.(procesadosTotal, procesadosTotal);
      cursor = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < PAGE_SIZE) break;
    }

    let eliminados = 0;
    const chunkSize = 499;
    for (let i = 0; i < aEliminar.length; i += chunkSize) {
      const chunk = aEliminar.slice(i, i + chunkSize);
      const batch = writeBatch(this.db);
      for (const id of chunk) {
        batch.delete(doc(this.db, COL_CASOS, id));
      }
      await batch.commit();
      eliminados += chunk.length;
      onProgress?.(eliminados, aEliminar.length);
    }

    return { eliminados };
  }

  async marcarProcesado(id: string, estado: EstadoCaso, procesadoPor: string, asignado: string = '', caso?: any, comentario = ''): Promise<void> {
    const ts = new Date().toISOString();
    const apodoEfectivo = asignado || procesadoPor;
    const entrada: any = { estado, timestamp: ts, por: procesadoPor, apodo: apodoEfectivo };
    if (comentario) entrada.comentario = comentario;
    await updateDoc(doc(this.db, COL_CASOS, id), {
      procesado: true,
      estado,
      procesadoPor,
      ASGINADO: apodoEfectivo,
      procesadoTimestamp: serverTimestamp(),
      historialEstados: arrayUnion(entrada)
    });
    if (estado === 'acepto' && caso) {
      await this.crearNotificacionAcepto(id, caso, apodoEfectivo);
    }
    // Actualizar stats del llamador (fire & forget)
    this._incrementarStatsLlamador(procesadoPor, apodoEfectivo, estado).catch(() => {});
    // Decrementar contador de cola del llamador
    this._decrementarContadorCola(apodoEfectivo).catch(() => {});
  }

  private async _incrementarStatsLlamador(email: string, apodo: string, estado: EstadoCaso): Promise<void> {
    if (!email) return;
    const ref = doc(this.db, COL_STATS_LLAMADORES, email.replace(/[^a-zA-Z0-9]/g, '_'));
    const estadoField = this._estadoAField(estado);
    const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const upd: Record<string, any> = {
      email,
      apodo,
      consumidos: increment(1),
      ultimaActividad: serverTimestamp(),
    };
    if (estadoField) upd[estadoField] = increment(1);
    upd[`hoy_${hoy}`] = increment(1); // contactos de hoy
    try {
      await updateDoc(ref, upd);
    } catch {
      await setDoc(ref, { email, apodo, consumidos: 1, [estadoField || 'otro']: 1, [`hoy_${hoy}`]: 1, ultimaActividad: serverTimestamp() });
    }
  }

  private _estadoAField(estado: string): string {
    const map: Record<string, string> = {
      acepto: 'acepto', pendiente: 'interesado', interesado: 'interesado',
      nocontesto: 'interesado', sincontacto: 'sinContacto',
      conabogado: 'conAbogado', nointeresado: 'noInteresado',
    };
    return map[estado] ?? 'otro';
  }

  private async _decrementarContadorCola(apodo: string): Promise<void> {
    if (!apodo) return;
    const ref = doc(this.db, COL_COLA_CONTADORES, apodo);
    try {
      await updateDoc(ref, { cantidad: increment(-1) });
    } catch { /* no existe el doc todavía, ignorar */ }
  }

  private async _incrementarContadorCola(apodo: string): Promise<void> {
    if (!apodo) return;
    const ref = doc(this.db, COL_COLA_CONTADORES, apodo);
    try {
      await updateDoc(ref, { cantidad: increment(1) });
    } catch {
      await setDoc(ref, { apodo, cantidad: 1 });
    }
  }

  async cambiarEstadoCaso(id: string, nuevoEstado: EstadoCaso, email: string, apodo: string, caso?: any, comentario = ''): Promise<void> {
    const ts = new Date().toISOString();
    const entrada: any = { estado: nuevoEstado, timestamp: ts, por: email, apodo };
    if (comentario) entrada.comentario = comentario;
    await updateDoc(doc(this.db, COL_CASOS, id), {
      estado: nuevoEstado,
      historialEstados: arrayUnion(entrada)
    });
    if (nuevoEstado === 'acepto' && caso) {
      await this.crearNotificacionAcepto(id, caso, apodo);
    }
  }

  private async crearNotificacionAcepto(casoId: string, caso: any, llamador: string): Promise<void> {
    await addDoc(collection(this.db, COL_NOTIFICACIONES), {
      tipo: 'acepto',
      casoId,
      trabajador: caso.Trabajador || '',
      cuil: caso.CUIL || '',
      diasILT: caso.Dias_ILT || '',
      lesion: caso.Lesion_1 || '',
      empresa: caso.Emp_Denominacion || '',
      llamador,
      leida: false,
      timestampMs: Date.now(),
      timestamp: serverTimestamp()
    });
  }

  escucharNotificacionesAcepto(
    desdeMs: number,
    callback: (notifs: Array<{ id: string; trabajador: string; cuil: string; diasILT: string; lesion: string; empresa: string; llamador: string; timestampMs: number }>) => void
  ): () => void {
    const ref = collection(this.db, COL_NOTIFICACIONES);
    const q = query(ref, where('leida', '==', false), where('tipo', '==', 'acepto'));
    return onSnapshot(q, snap => {
      const notifs = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .filter(n => n.timestampMs >= desdeMs)
        .sort((a, b) => b.timestampMs - a.timestampMs);
      callback(notifs);
    });
  }

  async marcarNotificacionLeida(id: string): Promise<void> {
    await updateDoc(doc(this.db, COL_NOTIFICACIONES, id), { leida: true });
  }

  async getApodoPorEmail(email: string): Promise<string> {
    const snap = await getDocs(collection(this.db, COL_USUARIOS));
    const usuario = snap.docs.map(d => d.data() as UsuarioApp).find(u => u.email === email);
    return usuario?.apodo || email;
  }

  async asegurarUsuarioRegistrado(uid: string, email: string): Promise<void> {
    const snap = await getDocs(query(collection(this.db, COL_USUARIOS), where('email', '==', email)));
    if (snap.empty) {
      // Usar uid como ID del documento
      await setDoc(doc(this.db, COL_USUARIOS, uid), { uid, email, apodo: '', creadoEn: serverTimestamp() });
    } else {
      // Doc existe — asegurarse de que tenga el uid correcto guardado
      const docData = snap.docs[0].data() as any;
      if (!docData.uid) {
        await updateDoc(snap.docs[0].ref, { uid });
      }
    }
  }

  async actualizarApodoPorEmail(email: string, apodo: string): Promise<void> {
    const snap = await getDocs(query(collection(this.db, COL_USUARIOS), where('email', '==', email)));
    if (!snap.empty) {
      await updateDoc(snap.docs[0].ref, { apodo });
    }
  }

  async getHistorialPor(email: string, apodo?: string, pageSize = 200): Promise<CasoModel[]> {
    const ref = collection(this.db, COL_CASOS);
    const apodoEfectivo = apodo && apodo !== email ? apodo : email.split('@')[0];
    const ESTADOS_VALIDOS = new Set(['acepto', 'pendiente', 'interesado', 'nocontesto', 'sincontacto', 'conabogado', 'nointeresado']);

    // Construir variantes del apodo para queries indexadas
    const variantes = this._buildVariantes(apodoEfectivo, email);
    const arr = Array.from(variantes).filter(v => v.length >= 2);
    const chunks: string[][] = [];
    for (let i = 0; i < arr.length; i += 30) chunks.push(arr.slice(i, i + 30));

    // Queries indexadas por ASGINADO (sin full scan)
    const queriesAsginado = chunks.map(ch =>
      getDocs(query(ref, where('ASGINADO', 'in', ch), limit(pageSize)))
    );
    // Query por procesadoPor
    const queryProcesadoPor = getDocs(query(ref, where('procesadoPor', '==', email), limit(pageSize)));

    const snaps = await Promise.all([queryProcesadoPor, ...queriesAsginado]);

    const seen = new Set<string>();
    const casos: CasoModel[] = [];
    for (const snap of snaps) {
      for (const d of snap.docs) {
        if (seen.has(d.id)) continue;
        const data = d.data() as any;
        if (!ESTADOS_VALIDOS.has(data['estado'])) continue;
        seen.add(d.id);
        casos.push({ id: d.id, ...data } as CasoModel);
      }
    }

    return casos
      .sort((a, b) => {
        const ta = a.procesadoTimestamp ?? '';
        const tb = b.procesadoTimestamp ?? '';
        return tb > ta ? 1 : -1;
      })
      .slice(0, pageSize);
  }

  async getCasosPorEstado(estado: string): Promise<CasoModel[]> {
    const ref = collection(this.db, COL_CASOS);

    // 'interesado' agrupa pendiente + interesado + nocontesto (legacy)
    const estadosFiltro = estado === 'interesado'
      ? ['pendiente', 'interesado', 'nocontesto']
      : [estado];

    const snaps = await Promise.all(
      estadosFiltro.map(e =>
        getDocs(query(ref, where('procesado', '==', true), where('estado', '==', e)))
      )
    );

    const casos: CasoModel[] = [];
    for (const snap of snaps) {
      for (const d of snap.docs) {
        casos.push({ id: d.id, ...d.data() } as CasoModel);
      }
    }

    return casos.sort((a, b) => {
      const ta = a.procesadoTimestamp ?? '';
      const tb = b.procesadoTimestamp ?? '';
      return tb > ta ? 1 : -1;
    });
  }

  async getHistorialCompleto(): Promise<CasoModel[]> {
    const ref = collection(this.db, COL_CASOS);
    const [snap1, snap2] = await Promise.all([
      getDocs(query(ref, where('procesado', '==', true))),
      getDocs(query(ref, where('estado', '!=', ''))),
    ]);
    const mapaIds = new Map<string, CasoModel>();
    for (const snap of [snap1, snap2]) {
      for (const d of snap.docs) {
        const data = d.data() as any;
        if (data.estado && data.procesadoPor) {
          mapaIds.set(d.id, { id: d.id, ...data } as CasoModel);
        }
      }
    }
    const casos = Array.from(mapaIds.values());
    return casos.sort((a, b) => {
      const ta = a.procesadoTimestamp ?? '';
      const tb = b.procesadoTimestamp ?? '';
      return tb > ta ? 1 : -1;
    });
  }

  /** Listener en tiempo real del historial completo (admin). Devuelve unsubscribe. */
  escucharHistorialCompleto(callback: (casos: CasoModel[]) => void): () => void {
    const ref = collection(this.db, COL_CASOS);
    const mapaIds = new Map<string, CasoModel>();

    const merge = () => {
      const casos = Array.from(mapaIds.values())
        .filter(c => c.estado && c.procesadoPor)
        .sort((a, b) => {
          const ta = a.procesadoTimestamp ?? '';
          const tb = b.procesadoTimestamp ?? '';
          return tb > ta ? 1 : -1;
        });
      callback(casos);
    };

    const unsub1 = onSnapshot(query(ref, where('procesado', '==', true)), snap => {
      snap.docs.forEach(d => mapaIds.set(d.id, { id: d.id, ...d.data() } as CasoModel));
      merge();
    });

    const unsub2 = onSnapshot(query(ref, where('estado', '!=', '')), snap => {
      snap.docs.forEach(d => {
        const data = d.data() as any;
        if (data.estado && data.procesadoPor) {
          mapaIds.set(d.id, { id: d.id, ...data } as CasoModel);
        }
      });
      merge();
    });

    return () => { unsub1(); unsub2(); };
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

    // Separar VentaSI del resto
    const filasNormales = filas.filter(f => !this._esVentaSi(f));
    const filasVentaSi = filas.filter(f => this._esVentaSi(f));

    // Subir casos normales a BDmadre
    for (let i = 0; i < filasNormales.length; i += chunkSize) {
      const chunk = filasNormales.slice(i, i + chunkSize);
      const batch = writeBatch(this.db);
      for (const fila of chunk) {
        const ref = doc(collection(this.db, COL_CASOS));
        batch.set(ref, {
          ...fila,
          ASGINADO: (fila['ASGINADO'] ?? '').toString().trim(),
          esVentaSi: false,
          procesado: false,
          estado: '',
          procesadoPor: '',
          procesadoTimestamp: null,
          creadoEn: serverTimestamp()
        });
      }
      try { await batch.commit(); subidos += chunk.length; }
      catch { errores += chunk.length; }
      onProgress?.(subidos, total);
    }

    // Subir VentaSI a su propia colección
    for (let i = 0; i < filasVentaSi.length; i += chunkSize) {
      const chunk = filasVentaSi.slice(i, i + chunkSize);
      const batch = writeBatch(this.db);
      for (const fila of chunk) {
        const ref = doc(collection(this.db, COL_CASOS_VENTA_SI));
        batch.set(ref, {
          ...fila,
          ASGINADO: (fila['ASGINADO'] ?? '').toString().trim(),
          esVentaSi: true,
          procesado: false,
          estado: '',
          procesadoPor: '',
          procesadoTimestamp: null,
          creadoEn: serverTimestamp()
        });
      }
      try { await batch.commit(); subidos += chunk.length; }
      catch { errores += chunk.length; }
      onProgress?.(subidos, total);
    }

    // Actualizar contador de cola
    await this._actualizarContador(filasNormales.length, 0);

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

  async getTodosLlamadoresConPerfil(): Promise<Array<{ apodo: string; perfil: string; limitePendientes: number }>> {
    const [usuariosSnap, configSnap] = await Promise.all([
      getDocs(collection(this.db, COL_USUARIOS)),
      getDocs(collection(this.db, 'config_llamadores')),
    ]);
    const configMap = new Map<string, any>();
    configSnap.docs.forEach(d => configMap.set(d.data()['apodo'], d.data()));

    return usuariosSnap.docs
      .map(d => d.data() as any)
      .filter(u => u.apodo && u.apodo.trim())
      .map(u => {
        const cfg = configMap.get(u.apodo) ?? {};
        return { apodo: u.apodo, perfil: cfg.perfil ?? '', limitePendientes: cfg.limitePendientes ?? 35 };
      })
      .sort((a, b) => a.apodo.localeCompare(b.apodo));
  }

  async actualizarApodo(uid: string, apodo: string): Promise<void> {
    await updateDoc(doc(this.db, COL_USUARIOS, uid), { apodo });
  }

  async actualizarEmailUsuario(uid: string, email: string): Promise<void> {
    await updateDoc(doc(this.db, COL_USUARIOS, uid), { email });
  }

  async eliminarUsuarioFirestore(uid: string): Promise<void> {
    await deleteDoc(doc(this.db, COL_USUARIOS, uid));
  }

  // ─── PRESENCIA ───────────────────────────────────────────

  private presenciaKey(email: string): string {
    return email.replace(/[.#$[\]]/g, '_');
  }

  async registrarPresencia(email: string, apodo: string): Promise<void> {
    await setDoc(doc(this.db, COL_PRESENCIA, this.presenciaKey(email)), {
      email, apodo, timestamp: Date.now()
    });
  }

  async limpiarPresencia(email: string): Promise<void> {
    try {
      await deleteDoc(doc(this.db, COL_PRESENCIA, this.presenciaKey(email)));
    } catch {}
  }

  escucharPresencia(
    callback: (users: Array<{ email: string; apodo: string; timestamp: number }>) => void
  ): () => void {
    const ref = collection(this.db, COL_PRESENCIA);
    return onSnapshot(ref, snap => {
      const ahora = Date.now();
      const users = snap.docs
        .map(d => d.data() as any)
        .filter(u => ahora - u.timestamp < 90_000) // 90 seg sin heartbeat = desconectado
        .sort((a, b) => (a.apodo || '').localeCompare(b.apodo || ''));
      callback(users);
    });
  }

  async marcarEmailEnviado(id: string): Promise<void> {
    await updateDoc(doc(this.db, COL_CASOS, id), { emailEnviado: true, emailErrorMsg: '' });
  }

  async marcarEmailError(id: string, msg: string): Promise<void> {
    await updateDoc(doc(this.db, COL_CASOS, id), { emailErrorMsg: msg });
  }

  async ocultarCasoDeHistorial(id: string, email: string): Promise<void> {
    await updateDoc(doc(this.db, COL_CASOS, id), { ocultadoPor: arrayUnion(email) });
  }

  async marcarCartaImpresa(id: string): Promise<void> {
    await updateDoc(doc(this.db, COL_CASOS, id), { cartaImpresa: true });
  }

  async registrarRecontacto(id: string, email: string, apodo: string, comentario: string): Promise<void> {
    const ts = new Date().toISOString();
    await updateDoc(doc(this.db, COL_CASOS, id), {
      recontactos: arrayUnion({ timestamp: ts, comentario, por: email, apodo })
    });
  }

  async guardarSeguimiento(
    id: string,
    entry: { tipo: string; fecha: string; hora: string; intencion: string; nota: string; por: string; apodo: string },
    proximaAccion: { tipo: string; fecha: string; hora: string },
    intencion: string
  ): Promise<void> {
    const seg = { ...entry, timestamp: new Date().toISOString() };
    await updateDoc(doc(this.db, COL_CASOS, id), {
      seguimientos: arrayUnion(seg),
      proximaAccion,
      intencion,
    });
  }

  async guardarExpediente(id: string, nroExpediente: string): Promise<void> {
    await updateDoc(doc(this.db, COL_CASOS, id), { nroExpediente });
  }

  async guardarSumarioCertero(id: string, sumario: object): Promise<void> {
    await updateDoc(doc(this.db, COL_CASOS, id), { certeroData: sumario });
  }

  // ── Reglas de asignación (Cola Personal) ─────────────────

  async getReglasCola(): Promise<Array<{ id: string; localidad: string; apodo: string }>> {
    const snap = await getDocs(collection(this.db, COL_REGLAS));
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  }

  async agregarReglaCola(localidad: string, apodo: string): Promise<void> {
    await addDoc(collection(this.db, COL_REGLAS), { localidad: localidad.trim(), apodo: apodo.trim() });
  }

  async eliminarReglaCola(id: string): Promise<void> {
    await deleteDoc(doc(this.db, COL_REGLAS, id));
  }

  /** Retorna cuántos casos no procesados tiene cada apodo en su cola personal */
  async getEstadoColas(): Promise<Array<{ apodo: string; cantidad: number }>> {
    const BASURA = new Set(['asginado', 'asignado', 'assigned', 'apodo', 'llamador', 'nombre']);

    // Construir mapa email → apodo desde la colección usuarios
    const usuariosSnap = await getDocs(collection(this.db, COL_USUARIOS));
    const emailAApodo = new Map<string, string>(); // email.toLowerCase() → apodo
    for (const d of usuariosSnap.docs) {
      const u = d.data() as any;
      const email = (u.email ?? '').toLowerCase();
      const apodo = (u.apodo ?? '').trim();
      if (email) emailAApodo.set(email, apodo || '');
    }

    const ref = collection(this.db, COL_CASOS);
    const snap = await getDocs(query(ref, where('procesado', '==', false)));

    // Agrupar normalizando: si ASGINADO es un email → resolver al apodo
    const mapaLower = new Map<string, { display: string; cantidad: number }>();
    let sinAsignar = 0;
    for (const d of snap.docs) {
      if (this._esVentaSi(d.data())) continue;
      let raw = (d.data()['ASGINADO'] ?? '').toString().trim();
      if (!raw || BASURA.has(raw.toLowerCase())) { sinAsignar++; continue; }

      // Si parece un email, intentar resolverlo al apodo
      if (raw.includes('@')) {
        const apodoResuelto = emailAApodo.get(raw.toLowerCase());
        if (apodoResuelto) raw = apodoResuelto;
        // Si el usuario no tiene apodo configurado, usar la parte antes del @
        else raw = raw.split('@')[0];
      }

      const key = raw.toLowerCase();
      if (mapaLower.has(key)) {
        mapaLower.get(key)!.cantidad++;
      } else {
        mapaLower.set(key, { display: raw, cantidad: 1 });
      }
    }
    const resultado = Array.from(mapaLower.values())
      .map(v => ({ apodo: v.display, cantidad: v.cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);
    if (sinAsignar > 0) resultado.push({ apodo: '— Sin asignar —', cantidad: sinAsignar });
    return resultado;
  }

  /** Aplica las reglas a los docs sin ASGINADO basándose en Localidad_Ocurrencia */
  async aplicarReglasCola(onProgress?: (n: number) => void): Promise<{ asignados: number }> {
    const [reglas, snap] = await Promise.all([
      this.getReglasCola(),
      getDocs(query(collection(this.db, COL_CASOS), where('procesado', '==', false)))
    ]);
    const candidatos = snap.docs.filter(d => !d.data()['ASGINADO']);
    let asignados = 0;
    const chunkSize = 499;
    const aActualizar: Array<{ id: string; apodo: string }> = [];

    for (const d of candidatos) {
      const localidad = (d.data()['Localidad_Ocurrencia'] ?? '').toString().trim().toLowerCase();
      const regla = reglas.find(r => localidad.includes(r.localidad.toLowerCase()));
      if (regla) aActualizar.push({ id: d.id, apodo: regla.apodo });
    }

    for (let i = 0; i < aActualizar.length; i += chunkSize) {
      const chunk = aActualizar.slice(i, i + chunkSize);
      const batch = writeBatch(this.db);
      for (const { id, apodo } of chunk) batch.update(doc(this.db, COL_CASOS, id), { ASGINADO: apodo });
      await batch.commit();
      asignados += chunk.length;
      onProgress?.(asignados);
    }
    return { asignados };
  }

  // ── Config por llamador ───────────────────────────────────

  async getConfigLlamador(apodo: string): Promise<{ limitePendientes: number; perfil: string }> {
    const snap = await getDocs(
      query(collection(this.db, 'config_llamadores'), where('apodo', '==', apodo))
    );
    if (!snap.empty) {
      const data = snap.docs[0].data() as any;
      return { limitePendientes: data.limitePendientes ?? 35, perfil: data.perfil ?? '' };
    }
    return { limitePendientes: 35, perfil: '' };
  }

  async setPerfilLlamador(apodo: string, perfil: string): Promise<void> {
    const snap = await getDocs(
      query(collection(this.db, 'config_llamadores'), where('apodo', '==', apodo))
    );
    if (!snap.empty) {
      await updateDoc(snap.docs[0].ref, { perfil });
    } else {
      await addDoc(collection(this.db, 'config_llamadores'), { apodo, perfil, limitePendientes: 35 });
    }
  }

  async setConfigLlamador(apodo: string, limitePendientes: number): Promise<void> {
    const snap = await getDocs(
      query(collection(this.db, 'config_llamadores'), where('apodo', '==', apodo))
    );
    if (!snap.empty) {
      await updateDoc(snap.docs[0].ref, { limitePendientes });
    } else {
      await addDoc(collection(this.db, 'config_llamadores'), { apodo, limitePendientes });
    }
  }

  async debugCola(apodo: string, email: string): Promise<{ libres: number; asignados: number; variantesUsadas: string[] }> {
    const ref = collection(this.db, COL_CASOS);
    const variantes = this._buildVariantes(apodo, email);
    const arr = Array.from(variantes).filter(v => v.length >= 2);
    const [snapLibre, ...snapAsignados] = await Promise.all([
      getDocs(query(ref, where('procesado', '==', false), where('ASGINADO', '==', ''))),
      ...arr.map(v => getDocs(query(ref, where('procesado', '==', false), where('ASGINADO', '==', v), limit(10))))
    ]);
    const libres = snapLibre.docs.filter(d => !this._esVentaSi(d.data())).length;
    const asignados = snapAsignados.reduce((sum, s) => sum + s.docs.filter(d => !this._esVentaSi(d.data())).length, 0);
    return { libres, asignados, variantesUsadas: arr };
  }

  async reasignarCasosPorEstado(
    desdeApodo: string,
    hastaApodo: string,
    hastaEmail: string,
    estados: string[],
    devolverACola: boolean = false
  ): Promise<number> {
    if (!desdeApodo || !hastaApodo || estados.length === 0) return 0;
    const ref = collection(this.db, COL_CASOS);
    const variantes = new Set<string>();
    const add = (s: string) => {
      if (!s) return;
      variantes.add(s); variantes.add(s.toLowerCase()); variantes.add(s.toUpperCase());
      variantes.add(s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
    };
    add(desdeApodo);
    const arr = Array.from(variantes);
    const snaps = await Promise.all(arr.map(v => getDocs(query(ref, where('ASGINADO', '==', v)))));
    const todosMap = new Map<string, any>();
    for (const snap of snaps) {
      for (const d of snap.docs) todosMap.set(d.id, d);
    }
    const filtrados = Array.from(todosMap.values()).filter(d => estados.includes(d.data()['estado']));
    const chunkSize = 499;
    for (let i = 0; i < filtrados.length; i += chunkSize) {
      const batch = writeBatch(this.db);
      filtrados.slice(i, i + chunkSize).forEach(d => {
        if (devolverACola) {
          batch.update(d.ref, {
            ASGINADO: hastaApodo,
            procesado: false,
            estado: '',
            procesadoPor: '',
            procesadoTimestamp: null,
          });
        } else {
          batch.update(d.ref, { ASGINADO: hastaApodo, procesadoPor: hastaEmail });
        }
      });
      await batch.commit();
    }
    return filtrados.length;
  }

  async reasignarCasosDe(desdeApodo: string, hastaApodo: string): Promise<number> {
    const ref = collection(this.db, COL_CASOS);
    const variantes = new Set<string>();
    const add = (s: string) => {
      if (!s) return;
      variantes.add(s); variantes.add(s.toLowerCase()); variantes.add(s.toUpperCase());
      variantes.add(s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
    };
    add(desdeApodo);
    const arr = Array.from(variantes);
    const ESTADOS_NO_MOVER = new Set(['acepto', 'interesado', 'pendiente', 'nocontesto']);
    const snaps = await Promise.all(arr.map(v => getDocs(query(ref, where('ASGINADO', '==', v)))));
    const todos = [...new Map(snaps.flatMap(s => s.docs).map(d => [d.id, d])).values()]
      .filter(d => {
        const estado = (d.data()['estado'] ?? '').toString();
        return !ESTADOS_NO_MOVER.has(estado);
      });
    const chunkSize = 499;
    for (let i = 0; i < todos.length; i += chunkSize) {
      const batch = writeBatch(this.db);
      todos.slice(i, i + chunkSize).forEach(d => {
        batch.update(d.ref, { ASGINADO: hastaApodo });
      });
      await batch.commit();
    }
    return todos.length;
  }

  /** Busca por procesadoPor (email) y actualiza ASGINADO al nuevo apodo.
   *  Cubre casos donde ASGINADO quedó como email en lugar de apodo. */
  async sincronizarApodoPorEmail(emailOrigen: string, apodoNuevo: string, devolverACola = false): Promise<number> {
    const ESTADOS_NO_MOVER = new Set(['acepto', 'interesado', 'pendiente', 'nocontesto']);
    const ref = collection(this.db, COL_CASOS);
    const snap = await getDocs(query(ref, where('procesadoPor', '==', emailOrigen)));
    const aActualizar = snap.docs.filter(d => {
      const estado = (d.data()['estado'] ?? '').toString();
      return !ESTADOS_NO_MOVER.has(estado);
    });
    const chunkSize = 499;
    for (let i = 0; i < aActualizar.length; i += chunkSize) {
      const batch = writeBatch(this.db);
      aActualizar.slice(i, i + chunkSize).forEach(d => {
        if (devolverACola) {
          batch.update(d.ref, {
            ASGINADO: apodoNuevo,
            procesado: false,
            estado: '',
            procesadoPor: '',
            procesadoTimestamp: null,
          });
        } else {
          batch.update(d.ref, { ASGINADO: apodoNuevo });
        }
      });
      await batch.commit();
    }
    return aActualizar.length;
  }

  async repararAsginadoTipoCaso(): Promise<number> {
    const ref = collection(this.db, COL_CASOS);
    const [snap0, snap1] = await Promise.all([
      getDocs(query(ref, where('ASGINADO', '==', '0'))),
      getDocs(query(ref, where('ASGINADO', '==', '1'))),
    ]);
    const todos = [...snap0.docs, ...snap1.docs];
    const chunkSize = 499;
    for (let i = 0; i < todos.length; i += chunkSize) {
      const batch = writeBatch(this.db);
      todos.slice(i, i + chunkSize).forEach(d => {
        const tipoCaso = d.data()['ASGINADO']; // '0' o '1'
        batch.update(d.ref, { ASGINADO: '', tipoCaso });
      });
      await batch.commit();
    }
    return todos.length;
  }

  /** Elimina casos no procesados con Dias_ILT < minDias (default 10) */
  async eliminarPorMinILT(minDias: number = 10, onProgress?: (n: number) => void): Promise<{ eliminados: number }> {
    const ref = collection(this.db, COL_CASOS);
    const snap = await getDocs(query(ref, where('procesado', '==', false)));
    const aEliminar = snap.docs.filter(d => {
      const val = Number((d.data()['Dias_ILT'] ?? '').toString().trim());
      return !isNaN(val) && val < minDias;
    }).map(d => d.id);

    let eliminados = 0;
    const chunkSize = 499;
    for (let i = 0; i < aEliminar.length; i += chunkSize) {
      const batch = writeBatch(this.db);
      aEliminar.slice(i, i + chunkSize).forEach(id => batch.delete(doc(this.db, COL_CASOS, id)));
      await batch.commit();
      eliminados += Math.min(chunkSize, aEliminar.length - i);
      onProgress?.(eliminados);
    }
    return { eliminados };
  }

  async vaciarCola(onProgress?: (n: number) => void): Promise<{ eliminados: number }> {
    const ref = collection(this.db, COL_CASOS);
    const snap = await getDocs(query(ref, where('procesado', '==', false)));
    const ids = snap.docs.map(d => d.id);
    let eliminados = 0;
    const chunkSize = 499;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const batch = writeBatch(this.db);
      ids.slice(i, i + chunkSize).forEach(id => batch.delete(doc(this.db, COL_CASOS, id)));
      await batch.commit();
      eliminados += Math.min(chunkSize, ids.length - i);
      onProgress?.(eliminados);
    }
    return { eliminados };
  }

  async getCasosEnColaCompleto(): Promise<CasoModel[]> {
    const ref = collection(this.db, COL_CASOS);
    const snap = await getDocs(query(ref, where('procesado', '==', false)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as CasoModel));
  }

  async getCantidadEnCola(): Promise<number> {
    const ref = collection(this.db, COL_CASOS);
    const BASURA = new Set(['asginado', 'asignado', 'assigned', 'apodo', 'llamador', 'nombre']);
    // Docs nuevos con esVentaSi=false (query eficiente)
    const [snapNuevos, snapTodos] = await Promise.all([
      getDocs(query(ref, where('procesado', '==', false), where('esVentaSi', '==', false))),
      getDocs(query(ref, where('procesado', '==', false))),
    ]);
    // Docs legacy sin campo esVentaSi — filtrar client-side
    const seen = new Set(snapNuevos.docs.map(d => d.id));
    const legacyCount = snapTodos.docs.filter(d => {
      if (seen.has(d.id)) return false;
      if (this._esVentaSi(d.data())) return false;
      return true;
    }).length;
    // Solo contar los sin asignar (libres)
    const libresNuevos = snapNuevos.docs.filter(d => {
      const raw = (d.data()['ASGINADO'] ?? '').toString().trim();
      return !raw || BASURA.has(raw.toLowerCase());
    }).length;
    const libresLegacy = snapTodos.docs.filter(d => {
      if (seen.has(d.id)) return false;
      if (this._esVentaSi(d.data())) return false;
      const raw = (d.data()['ASGINADO'] ?? '').toString().trim();
      return !raw || BASURA.has(raw.toLowerCase());
    }).length;
    return libresNuevos + libresLegacy;
  }

  // ── Noticias ──────────────────────────────────────────────
  async publicarNoticia(titulo: string, cuerpo: string, autor: string): Promise<void> {
    await addDoc(collection(this.db, COL_NOTICIAS), {
      titulo,
      cuerpo,
      autor,
      creadoEn: serverTimestamp(),
    });
  }

  async eliminarNoticia(id: string): Promise<void> {
    await deleteDoc(doc(this.db, COL_NOTICIAS, id));
  }

  escucharNoticias(callback: (noticias: NoticiaItem[]) => void): () => void {
    const ref = collection(this.db, COL_NOTICIAS);
    const q = query(ref, orderBy('creadoEn', 'desc'));
    return onSnapshot(q, snap => {
      const noticias = snap.docs.map(d => ({
        id: d.id,
        ...(d.data() as any),
      })) as NoticiaItem[];
      callback(noticias);
    });
  }

  async getEstadisticasAdmin(desde?: Date): Promise<LlamadorStats[]> {
    // Traer todos los casos procesados
    const ref = collection(this.db, COL_CASOS);
    const q = desde
      ? query(ref, where('procesado', '==', true), where('procesadoTimestamp', '>=', Timestamp.fromDate(desde)))
      : query(ref, where('procesado', '==', true));
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
        // Apodo actual del usuario tiene prioridad; ASGINADO de cada caso puede ser stale
        const rawAsginado = data['ASGINADO']?.trim() ?? '';
        const apodoFromCase = rawAsginado && !rawAsginado.includes('@') ? rawAsginado : null;
        const nombre = apodoMap.get(email.toLowerCase()) || apodoFromCase || email.split('@')[0];
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
      entry.consumidos++;

      switch (data['estado']) {
        case 'acepto':                          entry.acepto++;       break;
        case 'pendiente':
        case 'interesado':
        case 'nocontesto':                      entry.interesado++;   break;
        case 'sincontacto':                     entry.sinContacto++;  break;
        case 'conabogado':                      entry.conAbogado++;   break;
        case 'nointeresado':                    entry.noInteresado++; break;
      }
    }

    return Array.from(mapa.values()).sort((a, b) => b.consumidos - a.consumidos);
  }
}

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
  Timestamp
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
const COL_USUARIOS = 'usuarios';
const COL_NOTIFICACIONES = 'notificaciones';
const COL_PRESENCIA = 'presencia';
const COL_NOTICIAS = 'noticias';
const COL_REGLAS = 'reglas_asignacion';

@Injectable({ providedIn: 'root' })
export class FirestoreService {
  private db: Firestore = getFirestore(firebaseApp);

  // ─── CASOS ───────────────────────────────────────────────

  async getSiguienteCaso(): Promise<CasoModel | null> {
    const ref = collection(this.db, COL_CASOS);
    // Solo casos sin procesar y sin asignar (ASGINADO vacío o no definido)
    const q = query(ref, where('procesado', '==', false), where('ASGINADO', '==', ''), limit(5));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const docSnap = snap.docs[0];
      return { id: docSnap.id, ...docSnap.data() } as CasoModel;
    }
    // Fallback: sin campo ASGINADO (registros viejos)
    const q2 = query(ref, where('procesado', '==', false), limit(10));
    const snap2 = await getDocs(q2);
    const libre = snap2.docs.find(d => !d.data()['ASGINADO']);
    if (libre) return { id: libre.id, ...libre.data() } as CasoModel;
    return null;
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

  async getCasoAsignadoA(apodo: string): Promise<CasoModel | null> {
    const ref = collection(this.db, COL_CASOS);
    const q = query(ref, where('procesado', '==', false), where('ASGINADO', '==', apodo), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0];
      return { id: d.id, ...d.data() } as CasoModel;
    }
    return null;
  }

  async reservarCaso(id: string, apodo: string): Promise<void> {
    await updateDoc(doc(this.db, COL_CASOS, id), { ASGINADO: apodo });
  }

  async liberarCaso(id: string): Promise<void> {
    await updateDoc(doc(this.db, COL_CASOS, id), { ASGINADO: '' });
  }

  async eliminarDuplicados(onProgress?: (procesados: number, total: number) => void): Promise<{ eliminados: number }> {
    const ref = collection(this.db, COL_CASOS);
    const snap = await getDocs(ref);
    const visto = new Map<string, string>(); // clave → id a conservar
    const aEliminar: string[] = [];

    for (const d of snap.docs) {
      const data = d.data();
      const trabajador = (data['Trabajador'] || '').trim().toUpperCase();
      const fecha = (data['Fecha_Accidente'] || '').trim();
      if (!trabajador && !fecha) continue;
      const clave = `${trabajador}||${fecha}`;
      if (visto.has(clave)) {
        // Ya existe uno, este es duplicado — eliminar el de menor prioridad
        // Si el existente ya está procesado, eliminar el nuevo; si no, eliminar el existente y conservar el procesado
        const idExistente = visto.get(clave)!;
        const existenteSnap = snap.docs.find(x => x.id === idExistente);
        const existenteProcesado = existenteSnap?.data()['procesado'] === true;
        const actualProcesado = data['procesado'] === true;
        if (actualProcesado && !existenteProcesado) {
          // Conservar el actual (procesado), eliminar el existente
          aEliminar.push(idExistente);
          visto.set(clave, d.id);
        } else {
          aEliminar.push(d.id);
        }
      } else {
        visto.set(clave, d.id);
      }
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
    const entrada: any = { estado, timestamp: ts, por: procesadoPor, apodo: asignado || procesadoPor };
    if (comentario) entrada.comentario = comentario;
    await updateDoc(doc(this.db, COL_CASOS, id), {
      procesado: true,
      estado,
      procesadoPor,
      ASGINADO: asignado || procesadoPor,
      procesadoTimestamp: serverTimestamp(),
      historialEstados: arrayUnion(entrada)
    });
    if (estado === 'acepto' && caso) {
      await this.crearNotificacionAcepto(id, caso, asignado || procesadoPor);
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
    await updateDoc(doc(this.db, COL_CASOS, id), { emailEnviado: true });
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
    for (const d of snap.docs) {
      let raw = (d.data()['ASGINADO'] ?? '').toString().trim();
      if (!raw) continue;
      if (BASURA.has(raw.toLowerCase())) continue;

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
    return Array.from(mapaLower.values())
      .map(v => ({ apodo: v.display, cantidad: v.cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);
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

  async getConfigLlamador(apodo: string): Promise<{ limitePendientes: number }> {
    const snap = await getDocs(
      query(collection(this.db, 'config_llamadores'), where('apodo', '==', apodo))
    );
    if (!snap.empty) {
      const data = snap.docs[0].data() as any;
      return { limitePendientes: data.limitePendientes ?? 35 };
    }
    return { limitePendientes: 35 };
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

  async getCantidadEnCola(): Promise<number> {
    const ref = collection(this.db, COL_CASOS);
    const snap = await getDocs(query(ref, where('procesado', '==', false)));
    return snap.size;
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
        // ASGINADO only if it's an actual apodo (not an email address)
        const rawAsginado = data['ASGINADO']?.trim() ?? '';
        const apodoFromCase = rawAsginado && !rawAsginado.includes('@') ? rawAsginado : null;
        const nombre = apodoFromCase || apodoMap.get(email.toLowerCase()) || email.split('@')[0];
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
      const asginadoActual = data['ASGINADO']?.trim() ?? '';
      if (asginadoActual && !asginadoActual.includes('@') && entry.nombre !== asginadoActual) {
        entry.nombre = asginadoActual;
      }
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

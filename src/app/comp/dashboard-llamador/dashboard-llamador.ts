import { Component, OnInit, OnDestroy, ChangeDetectorRef, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirestoreService } from '../../services/firestore.service';
import { CerteroService, SumarioCertero } from '../../services/certero.service';
import { AnexoService } from '../../services/anexo.service';
import { CasoModel, EstadoCaso } from './caso.model';
import { NoticiaItem } from '../../services/firestore.service';

@Component({
  selector: 'app-dashboard-llamador',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './dashboard-llamador.html',
  styleUrls: ['./dashboard-llamador.css']
})
export class DashboardLlamador implements OnInit, OnDestroy {
  estadoActivo: EstadoCaso = '';
  mostrarDescartarOpciones = false;
  mostrarModalExpediente = false;
  expedienteInput = '';
  expedienteError = '';

  // Modal comentario al cambiar estado
  mostrarModalComentario = false;
  comentarioInput = '';
  pendingCambioEstado: { caso: CasoModel; estado: EstadoCaso } | null = null;
  pendingEstadoCasoActual: EstadoCaso | null = null; // para el flujo del caso actual
  comentarioCasoActual = '';

  // Modal seguimiento (pendiente desde caso actual o historial)
  mostrarModalSeguimiento = false;
  casoSeguimiento: CasoModel | null = null; // null = caso actual
  sgIntencion = '';
  sgNota = '';
  sgTipo = 'Llamar';
  sgFecha = '';
  sgHora = '';
  sgError = '';
  sgGuardando = false;

  // Panel derecho en tab seguimiento
  casoPanelDerecho: CasoModel | null = null;

  // Búsqueda en seguimiento
  busquedaSeguimiento = '';
  buscando = false;
  cargandoInicial = true;
  seccionActiva: 'caso' | 'acepto' | 'pendientes' | 'historial' | 'seguimiento' = 'caso';
  casoModal: CasoModel | null = null;
  mostrarModalMatricula = false;
  mostrarModalPerfil = false;
  perfilApodo = '';
  perfilPassword = '';
  perfilPasswordActual = '';
  perfilGuardando = false;
  perfilMensaje = '';
  perfilError = '';

  limitePendientes = 35; // se sobreescribe desde Firestore según el apodo

  matriculas = [
    { label: 'DNI',                  archivo: 'assets/matriculas/dni.pdf' },
    { label: 'Matrícula CABA',       archivo: 'assets/matriculas/matricula-caba.pdf' },
    { label: 'Matrícula Provincia',  archivo: 'assets/matriculas/matricula-provincia.pdf' },
    { label: 'Matrícula Santa Fe',   archivo: 'assets/matriculas/matricula-santafe.pdf' },
    { label: 'Matrícula Neuquén',    archivo: 'assets/matriculas/matricula-neuquen.pdf' },
    { label: 'Matrícula Río Negro',  archivo: 'assets/matriculas/matricula-rionegro.pdf' },
    { label: 'Matrícula Entre Ríos', archivo: 'assets/matriculas/matricula-entrerios.pdf' },
  ];

  caso: CasoModel | null = null;
  historial: CasoModel[] = [];
  busquedaHistorial = '';

  // Filtros por columna en historial
  filtroEstado = '';
  filtroDias = '';
  filtroZona = '';
  filtroDiag = '';

  sinDatos = false;
  sumario: SumarioCertero | null = null;
  cargandoSumario = false;
  relacionContactos: Record<string, SumarioCertero | null> = {};
  cargandoRelacion: Record<string, boolean> = {};

  // Estado de cambio en historial
  cambiandoEstado: Record<string, boolean> = {};

  apodoUsuario = '';
  noticias: NoticiaItem[] = [];
  mostrarNoticias = false;
  private unsubNoticias: (() => void) | null = null;
  private pollingInterval: any = null;
  private heartbeatInterval: any = null;

  readonly TODOS_ESTADOS: Array<{ value: EstadoCaso; label: string }> = [
    { value: 'acepto',       label: 'Acepto' },
    { value: 'pendiente',    label: 'Pendiente' },
    { value: 'sincontacto',  label: 'Sin Contacto' },
    { value: 'conabogado',   label: 'Con Abogado' },
    { value: 'nointeresado', label: 'No Interesado' },
  ];

  constructor(
    public auth: AuthService,
    private firestoreService: FirestoreService,
    private certero: CerteroService,
    private anexo: AnexoService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      this.cargandoInicial = false;
      return;
    }

    try {
      const email = this.auth.getCurrentEmail();
      const uid = this.auth.getCurrentUid();
      // Registrar automáticamente si no existe en la colección usuarios
      this.firestoreService.asegurarUsuarioRegistrado(uid, email);
      this.apodoUsuario = await this.firestoreService.getApodoPorEmail(email);

      // Cargar config personal (límite de pendientes, etc.)
      const config = await this.firestoreService.getConfigLlamador(this.apodoUsuario);
      this.limitePendientes = config.limitePendientes;

      // Registrar presencia y mantener heartbeat cada 30s
      await this.firestoreService.registrarPresencia(email, this.apodoUsuario);
      this.heartbeatInterval = setInterval(() => {
        this.firestoreService.registrarPresencia(email, this.apodoUsuario);
      }, 30_000);

      await this.cargarSiguienteCaso();
      await this.cargarHistorial();
      this.unsubNoticias = this.firestoreService.escucharNoticias(n => {
        this.noticias = n;
        this.cdr.detectChanges();
      });
    } catch (e) {
      console.error('Error al inicializar dashboard llamador:', e);
    } finally {
      this.cargandoInicial = false;
      this.cdr.detectChanges();
      if (this.sinDatos) {
        this.iniciarPolling();
      }
    }
  }

  /** Casos pendientes: nuevo estado + legacy interesado/nocontesto */
  get pendientes(): CasoModel[] {
    return this.historial.filter(c =>
      c.estado === 'pendiente' || c.estado === 'interesado' || c.estado === 'nocontesto'
    );
  }

  get pendientesCount(): number { return this.pendientes.length; }

  get limitePendientesAlcanzado(): boolean { return false; }

  get aceptos(): CasoModel[] {
    return this.historial.filter(c => c.estado === 'acepto');
  }

  private esPendiente(estado: string): boolean {
    return estado === 'pendiente' || estado === 'interesado' || estado === 'nocontesto';
  }

  get historialFiltrado(): CasoModel[] {
    const q = this.busquedaHistorial.trim().toLowerCase();
    const email = this.auth.getCurrentEmail();
    return this.historial.filter(c => {
      // Ocultar casos marcados como ocultos por este llamador
      if (c.ocultadoPor?.includes(email)) return false;
      if (q && !(c.Trabajador || '').toLowerCase().includes(q)) return false;
      if (this.filtroEstado) {
        if (this.filtroEstado === 'pendiente' && !this.esPendiente(c.estado)) return false;
        if (this.filtroEstado !== 'pendiente' && c.estado !== this.filtroEstado) return false;
      }
      if (this.filtroDias && (c.Dias_ILT || '') !== this.filtroDias) return false;
      if (this.filtroZona && !(c.zona || '').toLowerCase().includes(this.filtroZona.toLowerCase())) return false;
      if (this.filtroDiag && !(c.Diag_1 || '').toLowerCase().includes(this.filtroDiag.toLowerCase())) return false;
      return true;
    });
  }

  async ocultarCaso(caso: CasoModel): Promise<void> {
    if (!caso.id) return;
    const email = this.auth.getCurrentEmail();
    await this.firestoreService.ocultarCasoDeHistorial(caso.id, email);
    // Actualizar local para que desaparezca sin recargar
    const idx = this.historial.findIndex(c => c.id === caso.id);
    if (idx >= 0) {
      this.historial[idx] = {
        ...this.historial[idx],
        ocultadoPor: [...(this.historial[idx].ocultadoPor ?? []), email]
      };
    }
    this.cdr.detectChanges();
  }

  ngOnDestroy() {
    this.detenerPolling();
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.unsubNoticias?.();
    this.firestoreService.limpiarPresencia(this.auth.getCurrentEmail());
  }

  private iniciarPolling() {
    if (this.pollingInterval) return;
    this.pollingInterval = setInterval(async () => {
      if (this.buscando || this.caso) {
        this.detenerPolling();
        return;
      }
      try {
        const identificador = this.apodoUsuario || this.auth.getCurrentEmail();
        const siguiente = await this.firestoreService.getSiguienteCaso(this.apodoUsuario, this.auth.getCurrentEmail());
        if (siguiente) {
          if (siguiente.id) await this.firestoreService.reservarCaso(siguiente.id, identificador);
          this.caso = siguiente;
          this.sinDatos = false;
          this.detenerPolling();
          this.cdr.detectChanges();
        }
      } catch (e) {
        // silencioso
      }
    }, 2000);
  }

  private detenerPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private async cargarSiguienteCaso(buscarNuevo = false) {
    this.sinDatos = false;
    this.sumario = null;
    this.relacionContactos = {};
    this.cargandoRelacion = {};
    const identificador = this.apodoUsuario || this.auth.getCurrentEmail();

    if (!buscarNuevo) {
      const yaAsignado = await this.firestoreService.getCasoAsignadoA(identificador, this.auth.getCurrentEmail());
      if (yaAsignado) {
        // Si el ASGINADO no coincide con el identificador actual, normalizarlo
        if (yaAsignado.id && yaAsignado.ASGINADO !== identificador) {
          this.firestoreService.reservarCaso(yaAsignado.id, identificador);
        }
        this.caso = yaAsignado;
        this.cargarSumario(yaAsignado.CUIL);
        return;
      }
    }

    const siguiente = await this.firestoreService.getSiguienteCaso(this.apodoUsuario, this.auth.getCurrentEmail());
    if (siguiente) {
      if (siguiente.id) {
        await this.firestoreService.reservarCaso(siguiente.id, identificador);
      }
      this.caso = siguiente;
      this.cargarSumario(siguiente.CUIL);
      return;
    }

    this.caso = null;
    this.sinDatos = true;
  }

  async buscarContactoRelacion(cuil: string): Promise<void> {
    if (this.cargandoRelacion[cuil]) return;
    this.cargandoRelacion = { ...this.cargandoRelacion, [cuil]: true };
    this.cdr.detectChanges();
    const data = await this.certero.getSumario(cuil);
    this.relacionContactos = { ...this.relacionContactos, [cuil]: data };
    this.cargandoRelacion = { ...this.cargandoRelacion, [cuil]: false };
    this.cdr.detectChanges();
  }

  private async cargarSumario(cuil?: string) {
    if (!cuil) return;

    // Si el caso ya tiene datos cacheados en Firestore, usarlos directamente
    if (this.caso?.certeroData && !this.caso.certeroData['_noEncontrado']) {
      this.sumario = this.caso.certeroData as any;
      this.cdr.detectChanges();
      return;
    }

    this.cargandoSumario = true;
    this.cdr.detectChanges();
    const data = await this.certero.getSumario(cuil);
    this.sumario = data;

    // Guardar en Firestore para futuros accesos
    if (data && this.caso?.id) {
      this.firestoreService.guardarSumarioCertero(this.caso.id, data);
      this.caso = { ...this.caso, certeroData: data as any };
    }

    this.cargandoSumario = false;
    this.cdr.detectChanges();
  }

  private async cargarHistorial() {
    const email = this.auth.getCurrentEmail();
    if (!email) return;
    this.historial = await this.firestoreService.getHistorialPor(email, this.apodoUsuario);
  }

  get estadoActivoLabel(): string {
    const estados: Record<string, string> = {
      acepto:       'Acepto',
      pendiente:    'Pendiente',
      interesado:   'Pendiente',
      nocontesto:   'Pendiente',
      sincontacto:  'Sin Contacto',
      conabogado:   'Con Abogado',
      nointeresado: 'No Interesado',
    };
    return this.estadoActivo ? (estados[this.estadoActivo] ?? this.estadoActivo) : '';
  }

  get esEstadoDescartar(): boolean {
    return ['sincontacto', 'conabogado', 'nointeresado'].includes(this.estadoActivo);
  }

  getEstadoColor(estado: string): string {
    const colores: Record<string, string> = {
      acepto:       'bg-green-100 text-green-700',
      pendiente:    'bg-yellow-100 text-yellow-700',
      interesado:   'bg-yellow-100 text-yellow-700',
      nocontesto:   'bg-yellow-100 text-yellow-700',
      sincontacto:  'bg-red-100 text-red-700',
      conabogado:   'bg-orange-100 text-orange-700',
      nointeresado: 'bg-gray-100 text-gray-600',
    };
    return colores[estado] || 'bg-gray-100 text-gray-700';
  }

  setEstado(estado: EstadoCaso): void {
    if (estado === 'acepto') {
      this.expedienteInput = '';
      this.expedienteError = '';
      this.mostrarModalExpediente = true;
      return;
    }
    if (estado === 'pendiente') {
      this.abrirModalSeguimiento(null); // null = caso actual
      return;
    }
    this.estadoActivo = estado;
    this.mostrarDescartarOpciones = false;
  }

  confirmarExpediente(): void {
    if (!this.expedienteInput.trim()) {
      this.expedienteError = 'El número de expediente es obligatorio.';
      return;
    }
    this.mostrarModalExpediente = false;

    if (this.pendingCambioEstado) {
      // Viene del historial: guardar expediente y abrir modal de comentario
      const { caso } = this.pendingCambioEstado;
      if (caso.id) {
        this.firestoreService.guardarExpediente(caso.id, this.expedienteInput.trim());
        const idx = this.historial.findIndex(c => c.id === caso.id);
        if (idx >= 0) this.historial[idx] = { ...this.historial[idx], nroExpediente: this.expedienteInput.trim() };
      }
      this.comentarioInput = '';
      this.mostrarModalComentario = true;
    } else {
      // Viene del caso actual
      this.estadoActivo = 'acepto';
      this.mostrarDescartarOpciones = false;
      if (this.caso?.id) {
        this.firestoreService.guardarExpediente(this.caso.id, this.expedienteInput.trim());
        this.caso = { ...this.caso, nroExpediente: this.expedienteInput.trim() };
      }
    }
  }

  cancelarExpediente(): void {
    this.mostrarModalExpediente = false;
    this.expedienteInput = '';
    this.expedienteError = '';
    if (this.pendingCambioEstado) {
      // Vino del historial: resetear el select visualmente
      this.pendingCambioEstado = null;
      this.historial = [...this.historial];
      this.cdr.detectChanges();
    }
  }

  abrirDescartar(): void {
    this.mostrarDescartarOpciones = !this.mostrarDescartarOpciones;
    if (this.mostrarDescartarOpciones) this.estadoActivo = '';
  }

  elegirDescartar(estado: EstadoCaso): void {
    this.estadoActivo = estado;
    this.mostrarDescartarOpciones = false;
  }

  setSeccion(seccion: 'caso' | 'acepto' | 'pendientes' | 'historial' | 'seguimiento'): void {
    this.seccionActiva = seccion;
  }

  limpiarFiltros(): void {
    this.busquedaHistorial = '';
    this.filtroEstado = '';
    this.filtroDias = '';
    this.filtroZona = '';
    this.filtroDiag = '';
  }

  // ── Helpers seguimiento ────────────────────────────────────
  nSeguimientos(caso: CasoModel): number {
    return (caso.seguimientos?.length ?? 0) + (caso.recontactos?.length ?? 0);
  }

  primerCelular(caso: CasoModel): { codigoArea: string; numero: string } | null {
    const cels: any[] = caso.certeroData?.['celulares'] ?? [];
    return cels[0] ?? null;
  }

  primerEmail(caso: CasoModel): string | null {
    const emails: any[] = caso.certeroData?.['emails'] ?? [];
    return emails[0]?.direccion ?? null;
  }

  abrirWhatsappCaso(caso: CasoModel): void {
    const cel = this.primerCelular(caso);
    if (!cel) return;
    const tel = (cel.codigoArea + cel.numero).replace(/\D/g, '');
    window.open(`https://wa.me/54${tel}`, 'wa_llamador');
  }

  ultimoComentario(caso: CasoModel): string {
    const segs = caso.seguimientos;
    if (segs && segs.length > 0) return segs[segs.length - 1].nota || '—';
    const recons = caso.recontactos;
    if (recons && recons.length > 0) return recons[recons.length - 1].comentario || '—';
    return '—';
  }

  ultimoContactoTs(caso: CasoModel): string {
    const segs = caso.seguimientos ?? [];
    const recons = caso.recontactos ?? [];
    const all = [...segs, ...recons].sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    if (all.length === 0) return '—';
    const d = new Date(all[0].timestamp);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
      + ' · ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }

  proximaAccionLabel(caso: CasoModel): string {
    const pa = caso.proximaAccion;
    if (!pa?.fecha) return 'Primer contacto';
    const fecha = new Date(pa.fecha + 'T00:00:00');
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const diff = fecha.getTime() - hoy.getTime();
    if (diff <= 0) return `${pa.tipo} HOY`;
    if (diff <= 86_400_000) return `${pa.tipo} mañana ${pa.hora}`;
    return `${pa.tipo} ${fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} ${pa.hora}`;
  }

  esCasoUrgente(caso: CasoModel): boolean {
    const pa = caso.proximaAccion;
    if (!pa?.fecha) return false;
    const fecha = new Date(pa.fecha + 'T00:00:00');
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    return fecha <= hoy;
  }

  get vencenHoy(): number {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    return this.seguimiento.filter(c => {
      const pa = c.proximaAccion;
      if (!pa?.fecha) return false;
      return new Date(pa.fecha + 'T00:00:00') <= hoy;
    }).length;
  }

  get sinContacto48h(): number {
    const limite = Date.now() - 48 * 3600_000;
    return this.seguimiento.filter(c => {
      const segs = c.seguimientos ?? [];
      const recons = c.recontactos ?? [];
      const all = [...segs, ...recons];
      if (all.length === 0) return false;
      const ultimo = Math.max(...all.map(x => new Date(x.timestamp).getTime()));
      return ultimo < limite;
    }).length;
  }

  get seguimientoOrdenado(): CasoModel[] {
    const q = this.busquedaSeguimiento.trim().toLowerCase();
    const filtrado = q
      ? this.seguimiento.filter(c => (c.Trabajador || '').toLowerCase().includes(q))
      : this.seguimiento;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    return [...filtrado].sort((a, b) => {
      const prioA = this.calcPrioridad(a, hoy);
      const prioB = this.calcPrioridad(b, hoy);
      if (prioA !== prioB) return prioA - prioB;
      return Number(b.Dias_ILT ?? 0) - Number(a.Dias_ILT ?? 0);
    });
  }

  private calcPrioridad(c: CasoModel, hoy: Date): number {
    const pa = c.proximaAccion;
    if (!pa?.fecha) return 1;
    const f = new Date(pa.fecha + 'T00:00:00');
    return f <= hoy ? 0 : 2;
  }

  seleccionarPanel(caso: CasoModel | null): void {
    this.casoPanelDerecho = caso;
    if (caso) {
      this.sgIntencion = caso.intencion || '';
      this.sgNota = '';
      this.sgTipo = caso.proximaAccion?.tipo || 'Llamar';
      this.sgFecha = this.fechaHoyISO();
      this.sgHora = caso.proximaAccion?.hora || '10:00';
      this.sgError = '';
    }
  }

  fechaHoyISO(): string {
    return new Date().toISOString().split('T')[0];
  }

  abrirModalSeguimiento(caso: CasoModel | null): void {
    this.casoSeguimiento = caso;
    this.sgIntencion = caso?.intencion || '';
    this.sgNota = '';
    this.sgTipo = caso?.proximaAccion?.tipo || 'Llamar';
    this.sgFecha = this.fechaHoyISO();
    this.sgHora = caso?.proximaAccion?.hora || '10:00';
    this.sgError = '';
    this.mostrarModalSeguimiento = true;
  }

  cancelarSeguimiento(): void {
    this.mostrarModalSeguimiento = false;
    this.casoSeguimiento = null;
    this.sgError = '';
    this.historial = [...this.historial]; // reset visual select
    this.cdr.detectChanges();
  }

  async guardarSeguimientoPanel(): Promise<void> {
    await this._guardarSeguimiento(this.casoPanelDerecho);
  }

  async guardarSeguimientoModal(): Promise<void> {
    await this._guardarSeguimiento(this.casoSeguimiento);
    this.mostrarModalSeguimiento = false;
    this.casoSeguimiento = null;
  }

  private async _guardarSeguimiento(caso: CasoModel | null): Promise<void> {
    if (!this.sgFecha || !this.sgHora) {
      this.sgError = 'La próxima acción es obligatoria.';
      return;
    }
    this.sgGuardando = true;
    this.sgError = '';
    const email = this.auth.getCurrentEmail();
    const proximaAccion = { tipo: this.sgTipo, fecha: this.sgFecha, hora: this.sgHora };
    const entry = {
      tipo: this.sgTipo, fecha: this.sgFecha, hora: this.sgHora,
      intencion: this.sgIntencion, nota: this.sgNota.trim(),
      por: email, apodo: this.apodoUsuario
    };

    if (caso?.id) {
      // Caso del historial / panel
      await this.firestoreService.guardarSeguimiento(caso.id, entry, proximaAccion, this.sgIntencion);
      if (caso.estado !== 'pendiente') {
        await this.firestoreService.cambiarEstadoCaso(caso.id, 'pendiente', email, this.apodoUsuario, caso);
      }
      const nuevoSeg = { ...entry, timestamp: new Date().toISOString() };
      const patch = {
        ...caso,
        estado: 'pendiente' as EstadoCaso,
        seguimientos: [...(caso.seguimientos ?? []), nuevoSeg],
        proximaAccion, intencion: this.sgIntencion
      };
      const idx = this.historial.findIndex(c => c.id === caso.id);
      if (idx >= 0) this.historial[idx] = patch;
      if (this.casoPanelDerecho?.id === caso.id) this.casoPanelDerecho = patch;
    } else {
      // Caso actual (nuevo)
      this.estadoActivo = 'pendiente';
      this.comentarioCasoActual = this.sgNota.trim();
      this.mostrarDescartarOpciones = false;
      if (this.caso?.id) {
        await this.firestoreService.guardarSeguimiento(this.caso.id, entry, proximaAccion, this.sgIntencion);
        this.caso = {
          ...this.caso,
          seguimientos: [...(this.caso.seguimientos ?? []), { ...entry, timestamp: new Date().toISOString() }],
          proximaAccion, intencion: this.sgIntencion
        };
      }
    }

    this.sgNota = '';
    this.sgFecha = this.fechaHoyISO();
    this.sgGuardando = false;
    this.cdr.detectChanges();
  }

  // ── Abre el modal de comentario antes de cambiar el estado ──
  iniciarCambioEstado(caso: CasoModel, nuevoEstado: EstadoCaso): void {
    if (!caso.id || !nuevoEstado) return;

    // Acepto: pedir expediente primero
    if (nuevoEstado === 'acepto') {
      this.pendingCambioEstado = { caso, estado: nuevoEstado };
      this.expedienteInput = '';
      this.expedienteError = '';
      this.mostrarModalExpediente = true;
      return;
    }

    // Pendiente: abrir modal de seguimiento
    if (nuevoEstado === 'pendiente') {
      this.abrirModalSeguimiento(caso);
      return;
    }

    // No interesado / Sin contacto / Con abogado: sin restricciones, solo comentario
    this.pendingCambioEstado = { caso, estado: nuevoEstado };
    this.comentarioInput = '';
    this.mostrarModalComentario = true;
  }

  async confirmarCambioEstado(): Promise<void> {
    this.mostrarModalComentario = false;

    if (this.pendingEstadoCasoActual) {
      // Flujo caso actual: solo setear estado y guardar comentario
      this.estadoActivo = this.pendingEstadoCasoActual;
      this.comentarioCasoActual = this.comentarioInput.trim();
      this.mostrarDescartarOpciones = false;
      this.pendingEstadoCasoActual = null;
      this.comentarioInput = '';
      return;
    }

    if (!this.pendingCambioEstado) return;
    const { caso, estado } = this.pendingCambioEstado;
    await this.cambiarEstadoCaso(caso, estado, this.comentarioInput.trim());
    this.pendingCambioEstado = null;
    this.comentarioInput = '';
  }

  cancelarCambioEstado(): void {
    this.mostrarModalComentario = false;
    this.pendingEstadoCasoActual = null;
    this.pendingCambioEstado = null;
    this.comentarioInput = '';
    this.historial = [...this.historial];
    this.cdr.detectChanges();
  }

  async cambiarEstadoCaso(caso: CasoModel, nuevoEstado: EstadoCaso, comentario = ''): Promise<void> {
    if (!caso.id || !nuevoEstado) return;
    this.cambiandoEstado = { ...this.cambiandoEstado, [caso.id]: true };
    this.cdr.detectChanges();
    try {
      await this.firestoreService.cambiarEstadoCaso(
        caso.id, nuevoEstado,
        this.auth.getCurrentEmail(),
        this.apodoUsuario,
        caso,
        comentario
      );
      const idx = this.historial.findIndex(c => c.id === caso.id);
      if (idx >= 0) this.historial[idx] = { ...this.historial[idx], estado: nuevoEstado };
    } finally {
      this.cambiandoEstado = { ...this.cambiandoEstado, [caso.id]: false };
      this.cdr.detectChanges();
    }
  }

  get seguimiento(): CasoModel[] {
    return this.historial.filter(c =>
      c.estado === 'pendiente' || c.estado === 'interesado' || c.estado === 'nocontesto'
    );
  }

  // ── Stats card ─────────────────────────────────────────────
  readonly OBJETIVO_DIARIO = 25;

  private get _hoyISO(): string {
    return new Date().toISOString().split('T')[0];
  }

  /** Casos cuyo historialEstados tiene al menos una entrada de hoy (primer contacto o recontacto) */
  get contactosHoy(): number {
    const hoy = this._hoyISO;
    return this.historial.filter(c => {
      const hist = c.historialEstados ?? [];
      return hist.some(h => h.timestamp?.startsWith(hoy));
    }).length;
  }

  /** Seguimientos registrados hoy (excluye el primer contacto — solo recontactos) */
  get recontactosHoy(): number {
    const hoy = this._hoyISO;
    return this.historial.reduce((acc, c) => {
      const segs = c.seguimientos ?? [];
      return acc + segs.filter(s => s.timestamp?.startsWith(hoy)).length;
    }, 0);
  }

  /** Total casos marcados como interesado/pendiente */
  get interesadosCount(): number { return this.pendientes.length; }

  /** Total casos con abogado */
  get conAbogadoCount(): number {
    return this.historial.filter(c => c.estado === 'conabogado').length;
  }

  abrirWaNumero(codigoArea: string, numero: string): void {
    const tel = (codigoArea + numero).replace(/\D/g, '');
    window.open(`https://wa.me/54${tel}`, 'wa_llamador');
  }

  abrirWhatsappVinculo(documento: string): void {
    const telefono = documento.replace(/\D/g, '');
    window.open(`https://wa.me/54${telefono}`, 'wa_llamador');
  }

  async solicitarDatoNuevo(): Promise<void> {
    if (this.buscando || !this.caso || !this.estadoActivo || this.limitePendientesAlcanzado) return;

    if (this.caso.id) {
      await this.firestoreService.marcarProcesado(
        this.caso.id,
        this.estadoActivo,
        this.auth.getCurrentEmail(),
        this.apodoUsuario,
        this.caso,
        this.comentarioCasoActual
      );
      this.historial = [{ ...this.caso, estado: this.estadoActivo, procesado: true }, ...this.historial];
      this.comentarioCasoActual = '';
    }

    this.buscando = true;
    this.estadoActivo = '';
    this.mostrarDescartarOpciones = false;
    this.seccionActiva = 'caso';
    this.cdr.detectChanges();

    await this.cargarSiguienteCaso(true);

    // Recargar historial fresco desde Firestore para asegurar datos actualizados
    await this.cargarHistorial();

    this.buscando = false;
    this.cdr.detectChanges();

    if (this.sinDatos) this.iniciarPolling();
  }

  async cerrarSesion(): Promise<void> {
    this.detenerPolling();
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    await this.firestoreService.limpiarPresencia(this.auth.getCurrentEmail());
    await this.auth.logout();
    this.router.navigate(['/login']);
  }

  generarAnexo(caso?: CasoModel | null): void {
    const target = caso ?? this.caso;
    if (!target) return;
    this.anexo.generarAnexo(target);
  }

  abrirModalPerfil(): void {
    this.perfilApodo = this.apodoUsuario;
    this.perfilPassword = '';
    this.perfilPasswordActual = '';
    this.perfilMensaje = '';
    this.perfilError = '';
    this.mostrarModalPerfil = true;
  }

  async guardarPerfil(): Promise<void> {
    if (this.perfilGuardando) return;
    this.perfilGuardando = true;
    this.perfilMensaje = '';
    this.perfilError = '';
    this.cdr.detectChanges();
    try {
      const email = this.auth.getCurrentEmail();
      if (this.perfilApodo.trim() && this.perfilApodo.trim() !== this.apodoUsuario) {
        await this.firestoreService.actualizarApodoPorEmail(email, this.perfilApodo.trim());
        this.apodoUsuario = this.perfilApodo.trim();
      }
      if (this.perfilPassword.trim().length >= 6) {
        await this.auth.cambiarPassword(this.perfilPassword.trim(), this.perfilPasswordActual.trim() || undefined);
      }
      this.perfilMensaje = 'Datos actualizados correctamente.';
    } catch (e: any) {
      if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
        this.perfilError = 'La contraseña actual es incorrecta.';
      } else if (e.code === 'auth/requires-recent-login') {
        this.perfilError = 'Por seguridad cerrá sesión, volvé a ingresar y cambiá la contraseña.';
      } else {
        this.perfilError = 'Error al guardar. Intentá de nuevo.';
      }
    } finally {
      this.perfilGuardando = false;
      this.cdr.detectChanges();
    }
  }

  descargarMatricula(archivo: string, label: string): void {
    const a = document.createElement('a');
    a.href = archivo;
    a.download = label + '.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

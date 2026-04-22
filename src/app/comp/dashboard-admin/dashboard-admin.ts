import { Component, NgZone, OnInit, OnDestroy, ChangeDetectorRef, PLATFORM_ID, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirestoreService, UploadResult, LlamadorStats, NoticiaItem } from '../../services/firestore.service';
import { EmailService } from '../../services/email.service';
import { CerteroService } from '../../services/certero.service';
import { AnexoService } from '../../services/anexo.service';
import { CasoModel } from '../dashboard-llamador/caso.model';
import * as XLSX from 'xlsx';

type SeccionActiva = 'estadisticas' | 'acepto' | 'interesado' | 'sincontacto' | 'conabogado' | 'nointeresado' | 'cargar' | 'historial' | 'duplicados' | 'noticias' | 'cola' | 'ventasi';

type EstadoUpload = 'idle' | 'preview' | 'subiendo' | 'limpiando' | 'done' | 'error';

interface NotifAcepto {
  id: string;
  trabajador: string;
  cuil: string;
  diasILT: string;
  lesion: string;
  empresa: string;
  llamador: string;
  timestampMs: number;
}

@Component({
  selector: 'app-dashboard-admin',
  imports: [FormsModule, DatePipe],
  templateUrl: './dashboard-admin.html',
  styleUrl: './dashboard-admin.css',
})
export class DashboardAdmin implements OnInit, OnDestroy {
  notificaciones: NotifAcepto[] = [];
  noticias: NoticiaItem[] = [];
  noticiasTitulo = '';
  noticiasCuerpo = '';
  noticiasGuardando = false;
  private unsubNotif: (() => void) | null = null;
  private unsubPresencia: (() => void) | null = null;
  private unsubNoticias: (() => void) | null = null;
  private unsubHistorial: (() => void) | null = null;
  private historialInterval: any = null;
  private colaInterval: any = null;
  private adminInitMs = Date.now();
  private prevNotifCount = 0;

  usuariosConectados: { apodo: string; email: string }[] = [];
  mostrarConectados = false;
  casosEnCola = 0;
  constructor(
    private auth: AuthService,
    private router: Router,
    private fs: FirestoreService,
    private emailSvc: EmailService,
    private certero: CerteroService,
    private anexo: AnexoService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  generarAnexo(caso: CasoModel): void {
    this.anexo.generarAnexo(caso);
  }

  seccionActiva: SeccionActiva = 'estadisticas';

  // Filtro de período en estadísticas
  periodoFiltro: 'semana' | 'mes' | 'anual' | 'total' = 'total';
  readonly PERIODOS: Array<{ value: 'semana' | 'mes' | 'anual' | 'total'; label: string }> = [
    { value: 'semana', label: 'Última semana' },
    { value: 'mes',    label: 'Último mes' },
    { value: 'anual',  label: 'Anual' },
    { value: 'total',  label: 'Total' },
  ];

  // Caso detalle (al hacer click en una fila)
  casoDetalle: CasoModel | null = null;

  llamadores: LlamadorStats[] = [];
  cargandoStats = false;

  // ── Historial ─────────────────────────────────────────────
  historial: CasoModel[] = [];
  cargandoHistorial = true;
  historialFiltroLlamador = '';
  historialFiltroEstado = '';
  historialFiltroApellido = '';

  // ── Casos por estado ──────────────────────────────────────
  casosEstado: CasoModel[] = [];
  cargandoCasosEstado = false;

  // ── Modal detalle llamador ─────────────────────────────────
  modalVisible = false;
  modalLlamador: LlamadorStats | null = null;
  modalEstadoLabel = '';
  modalEstadoKey = '';
  modalColorText = '';
  modalCasos: CasoModel[] = [];
  modalCargando = false;

  readonly SECCIONES_ESTADO: { key: SeccionActiva; label: string; emoji: string; campo: keyof LlamadorStats; colorBg: string; colorText: string; barColor: string }[] = [
    { key: 'acepto',       label: 'Acepto',        emoji: '✓', campo: 'acepto',       colorBg: 'bg-green-50',  colorText: 'text-green-600',  barColor: 'bg-green-400'  },
    { key: 'interesado',   label: 'Interesado',    emoji: '★', campo: 'interesado',   colorBg: 'bg-yellow-50', colorText: 'text-yellow-500', barColor: 'bg-yellow-400' },
    { key: 'sincontacto',  label: 'Sin Contacto',  emoji: '✕', campo: 'sinContacto',  colorBg: 'bg-red-50',    colorText: 'text-red-500',    barColor: 'bg-red-400'    },
    { key: 'conabogado',   label: 'Con Abogado',   emoji: '⚖', campo: 'conAbogado',   colorBg: 'bg-orange-50', colorText: 'text-orange-500', barColor: 'bg-orange-400' },
    { key: 'nointeresado', label: 'No Interesado', emoji: '–', campo: 'noInteresado', colorBg: 'bg-gray-50',   colorText: 'text-gray-500',   barColor: 'bg-gray-400'   },
  ];

  readonly Math = Math;

  // ── Upload state ──────────────────────────────────────────
  estadoUpload: EstadoUpload = 'idle';
  archivoNombre = '';
  columnas: string[] = [];
  totalFilas = 0;
  filaPreview: Record<string, any>[] = [];
  datosParaSubir: Record<string, any>[] = [];
  uploadSubidos = 0;
  uploadTotal = 0;
  uploadResult: UploadResult | null = null;
  uploadError = '';

  // limpieza automática post-upload
  limpiezaPaso = '';
  limpiezaVentaSiEliminados = 0;
  limpiezaSinVentaEliminados = 0;
  limpiezaDuplicadosEliminados = 0;

  get uploadPct(): number {
    if (this.uploadTotal === 0) return 0;
    return Math.round((this.uploadSubidos / this.uploadTotal) * 100);
  }

  // ─────────────────────────────────────────────────────────

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;
    await this.cargarEstadisticas();
    this.fs.getCantidadEnCola().then(n => this.zone.run(() => { this.casosEnCola = n; }));
    this.colaInterval = setInterval(() => {
      this.fs.getCantidadEnCola().then(n => this.zone.run(() => { this.casosEnCola = n; this.cdr.detectChanges(); }));
    }, 500);

    // Carga inicial
    this.fs.getHistorialCompleto().then(h => {
      this.zone.run(() => { this.historial = h; this.cargandoHistorial = false; this.cdr.detectChanges(); });
    });
    // Polling cada 500ms
    this.historialInterval = setInterval(async () => {
      const h = await this.fs.getHistorialCompleto();
      this.zone.run(() => { this.historial = h; this.cdr.detectChanges(); });
    }, 500);
    this.unsubNotif = this.fs.escucharNotificacionesAcepto(this.adminInitMs, notifs => {
      this.zone.run(() => {
        if (notifs.length > this.prevNotifCount) {
          this.playNotificationSound();
        }
        this.prevNotifCount = notifs.length;
        this.notificaciones = notifs;
        this.cdr.detectChanges();
      });
    });
    this.unsubPresencia = this.fs.escucharPresencia(usuarios => {
      this.zone.run(() => {
        this.usuariosConectados = usuarios;
        this.cdr.detectChanges();
      });
    });
    this.unsubNoticias = this.fs.escucharNoticias(n => {
      this.zone.run(() => {
        this.noticias = n;
        this.cdr.detectChanges();
      });
    });
  }

  ngOnDestroy() {
    this.unsubNotif?.();
    this.unsubPresencia?.();
    this.unsubNoticias?.();
    this.unsubHistorial?.();
    if (this.historialInterval) clearInterval(this.historialInterval);
    if (this.colaInterval) clearInterval(this.colaInterval);
  }

  async publicarNoticia(): Promise<void> {
    if (!this.noticiasTitulo.trim() || !this.noticiasCuerpo.trim() || this.noticiasGuardando) return;
    this.noticiasGuardando = true;
    this.cdr.detectChanges();
    try {
      await this.fs.publicarNoticia(
        this.noticiasTitulo.trim(),
        this.noticiasCuerpo.trim(),
        this.auth.getCurrentEmail()
      );
      this.noticiasTitulo = '';
      this.noticiasCuerpo = '';
    } finally {
      this.noticiasGuardando = false;
      this.cdr.detectChanges();
    }
  }

  async eliminarNoticia(id: string): Promise<void> {
    await this.fs.eliminarNoticia(id);
  }

  async cerrarNotificacion(id: string): Promise<void> {
    await this.fs.marcarNotificacionLeida(id);
  }

  private playNotificationSound(): void {
    try {
      const ctx = new AudioContext();
      // Acorde mayor ascendente: Do-Mi-Sol (C5-E5-G5)
      const notas = [523.25, 659.25, 783.99];
      notas.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.18;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.25, t + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.start(t);
        osc.stop(t + 0.5);
      });
    } catch (e) {
      // AudioContext no disponible (SSR o navegador bloqueado)
    }
  }

  private getDesde(periodo: 'semana' | 'mes' | 'anual' | 'total'): Date | undefined {
    const now = new Date();
    if (periodo === 'semana') {
      const d = new Date(now); d.setDate(d.getDate() - 7); return d;
    } else if (periodo === 'mes') {
      const d = new Date(now); d.setMonth(d.getMonth() - 1); return d;
    } else if (periodo === 'anual') {
      const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d;
    }
    return undefined;
  }

  async setPeriodo(p: 'semana' | 'mes' | 'anual' | 'total') {
    this.periodoFiltro = p;
    await this.cargarEstadisticas();
  }

  async cargarEstadisticas() {
    this.cargandoStats = true;
    try {
      this.llamadores = await this.fs.getEstadisticasAdmin(this.getDesde(this.periodoFiltro));
    } catch (e) {
      console.error('Error cargando estadísticas:', e);
    } finally {
      this.cargandoStats = false;
      this.cdr.detectChanges();
    }
  }

  async setSeccion(s: SeccionActiva) {
    this.seccionActiva = s;
    const estadoMap: Partial<Record<SeccionActiva, string>> = {
      acepto: 'acepto', interesado: 'interesado', sincontacto: 'sincontacto',
      conabogado: 'conabogado', nointeresado: 'nointeresado',
    };
    const estado = estadoMap[s];
    if (estado) {
      this.cargandoCasosEstado = true;
      this.casosEstado = [];
      this.cdr.detectChanges();
      try {
        this.casosEstado = await this.fs.getCasosPorEstado(estado);
      } catch (e) {
        console.error('Error cargando casos por estado:', e);
      } finally {
        this.cargandoCasosEstado = false;
        this.cdr.detectChanges();
      }
    }
    if (s === 'ventasi') {
      this.cargandoVentaSi = true;
      this.casosVentaSi = [];
      this.cdr.detectChanges();
      try {
        this.casosVentaSi = await this.fs.getCasosVentaSi();
      } catch (e) {
        console.error('Error cargando casos venta SI:', e);
      } finally {
        this.cargandoVentaSi = false;
        this.cdr.detectChanges();
      }
    }
  }

  getBarWidth(valor: number, total: number): string {
    if (total === 0) return '0%';
    return (valor / total * 100) + '%';
  }

  getTotal(campo: keyof LlamadorStats): number {
    return this.llamadores.reduce((a, l) => a + (l[campo] as number), 0);
  }

  getSeccionActual() {
    return this.SECCIONES_ESTADO.find(s => s.key === this.seccionActiva) ?? null;
  }

  get esCargar(): boolean { return this.seccionActiva === 'cargar'; }
  get esHistorial(): boolean { return this.seccionActiva === 'historial'; }
  get esDuplicados(): boolean { return this.seccionActiva === 'duplicados'; }
  get esCola(): boolean { return this.seccionActiva === 'cola'; }
  get esVentaSi(): boolean { return this.seccionActiva === 'ventasi'; }

  // ── Venta SI ──────────────────────────────────────────────
  casosVentaSi: CasoModel[] = [];
  cargandoVentaSi = false;
  ventaSiFiltroApellido = '';

  get casosVentaSiFiltrado(): CasoModel[] {
    const q = this.ventaSiFiltroApellido.trim().toLowerCase();
    if (!q) return this.casosVentaSi;
    return this.casosVentaSi.filter(c => (c.Trabajador || '').toLowerCase().includes(q));
  }

  // ── Duplicados ────────────────────────────────────────────
  estadoDupli: 'idle' | 'buscando' | 'done' | 'error' = 'idle';
  dupliEliminados = 0;
  dupliError = '';

  // ── Vaciar BDmadre ────────────────────────────────────────
  estadoVaciar: 'idle' | 'confirm' | 'borrando' | 'done' | 'error' = 'idle';
  vaciarEliminados = 0;
  vaciarError = '';

  // ── Eliminar Venta = SI ───────────────────────────────────
  estadoVentaSi: 'idle' | 'buscando' | 'done' | 'error' = 'idle';
  ventaSiEliminados = 0;
  ventaSiError = '';

  // ── Eliminar sin valor de Venta ───────────────────────────
  estadoSinVenta: 'idle' | 'buscando' | 'done' | 'error' = 'idle';
  sinVentaEliminados = 0;
  sinVentaError = '';

  // ── Cola Personal ─────────────────────────────────────────
  colaCargando = false;
  colaEstados: Array<{ apodo: string; cantidad: number }> = [];
  reglasCola: Array<{ id: string; localidad: string; apodo: string }> = [];
  nuevaReglaLocalidad = '';
  nuevaReglaApodo = '';
  colaReglaError = '';
  colaAplicandoReglas = false;
  colaReglaAsignados = 0;

  // Límites de pendientes por llamador
  limitesConfig: Record<string, number> = {};   // apodo → límite actual en edición
  limitesGuardando: Record<string, boolean> = {};
  limitesMensaje: Record<string, string> = {};

  async vaciarBDMadre() {
    this.estadoVaciar = 'borrando';
    this.vaciarEliminados = 0;
    this.vaciarError = '';
    this.cdr.detectChanges();
    try {
      const result = await this.fs.vaciarBDMadre((n) => {
        this.vaciarEliminados = n;
        this.cdr.detectChanges();
      });
      this.vaciarEliminados = result.eliminados;
      this.estadoVaciar = 'done';
    } catch (e: any) {
      this.vaciarError = e.message ?? 'Error al vaciar.';
      this.estadoVaciar = 'error';
    }
    this.cdr.detectChanges();
  }

  async eliminarVentaSi() {
    this.estadoVentaSi = 'buscando';
    this.ventaSiEliminados = 0;
    this.ventaSiError = '';
    this.cdr.detectChanges();
    try {
      const result = await this.fs.eliminarVentaSi((n) => {
        this.ventaSiEliminados = n;
        this.cdr.detectChanges();
      });
      this.ventaSiEliminados = result.eliminados;
      this.estadoVentaSi = 'done';
    } catch (e: any) {
      this.ventaSiError = e.message ?? 'Error al eliminar.';
      this.estadoVentaSi = 'error';
    }
    this.cdr.detectChanges();
  }

  async eliminarSinVenta() {
    this.estadoSinVenta = 'buscando';
    this.sinVentaEliminados = 0;
    this.sinVentaError = '';
    this.cdr.detectChanges();
    try {
      const result = await this.fs.eliminarSinVenta((n) => {
        this.sinVentaEliminados = n;
        this.cdr.detectChanges();
      });
      this.sinVentaEliminados = result.eliminados;
      this.estadoSinVenta = 'done';
    } catch (e: any) {
      this.sinVentaError = e.message ?? 'Error al eliminar.';
      this.estadoSinVenta = 'error';
    }
    this.cdr.detectChanges();
  }

  async buscarYEliminarDuplicados() {
    this.estadoDupli = 'buscando';
    this.dupliEliminados = 0;
    this.dupliError = '';
    this.cdr.detectChanges();
    try {
      // Eliminar duplicados por nombre + fecha accidente
      const result = await this.fs.eliminarDuplicados((procesados) => {
        this.dupliEliminados = procesados;
        this.cdr.detectChanges();
      });
      this.dupliEliminados = result.eliminados;
      this.estadoDupli = 'done';
    } catch (e: any) {
      this.dupliError = e.message ?? 'Error al eliminar duplicados.';
      this.estadoDupli = 'error';
    }
    this.cdr.detectChanges();
  }

  private esPendiente(estado: string): boolean {
    return estado === 'pendiente' || estado === 'interesado' || estado === 'nocontesto';
  }

  get historialFiltrado(): CasoModel[] {
    const q = this.historialFiltroApellido.trim().toLowerCase();
    return this.historial.filter(c => {
      if (!c.Trabajador) return false;
      const okLlamador = !this.historialFiltroLlamador || c.procesadoPor === this.historialFiltroLlamador;
      const okEstado = !this.historialFiltroEstado
        || (this.historialFiltroEstado === 'interesado' ? this.esPendiente(c.estado) : c.estado === this.historialFiltroEstado);
      const okApellido = !q || (c.Trabajador || '').toLowerCase().includes(q);
      return okLlamador && okEstado && okApellido;
    });
  }

  get casosEstadoFiltrado(): CasoModel[] {
    const q = this.historialFiltroApellido.trim().toLowerCase();
    if (!q) return this.casosEstado;
    return this.casosEstado.filter(c => (c.Trabajador || '').toLowerCase().includes(q));
  }

  get llamadoresUnicos(): string[] {
    return [...new Set(this.historial.map(c => c.procesadoPor).filter(Boolean))].sort();
  }

  async setSeccionHistorial() {
    this.seccionActiva = 'historial';
    if (this.historial.length === 0) {
      this.cargandoHistorial = true;
      this.cdr.detectChanges();
      try {
        // El listener en tiempo real (escucharHistorialCompleto) ya actualiza this.historial
        // automáticamente. Solo esperamos brevemente si todavía no llegaron datos.
        await new Promise(r => setTimeout(r, 800));
      } catch (e) {
        console.error('Error cargando historial:', e);
      } finally {
        this.cargandoHistorial = false;
        this.cdr.detectChanges();
      }
    }
    // Refresco silencioso en background
    this.fs.getHistorialCompleto().then(h => this.zone.run(() => { this.historial = h; }));
  }

  async abrirModal(llamador: LlamadorStats, estadoKey: string, label: string, colorText: string) {
    this.modalVisible = true;
    this.modalLlamador = llamador;
    this.modalEstadoLabel = label;
    this.modalEstadoKey = estadoKey;
    this.modalColorText = colorText;
    this.modalCasos = [];
    this.modalCargando = true;
    this.cdr.detectChanges();
    try {
      const todos = await this.fs.getHistorialPor(llamador.email);
      const esPendiente = (e: string) => e === 'pendiente' || e === 'interesado' || e === 'nocontesto';
      this.modalCasos = todos.filter(c =>
        estadoKey === 'interesado' ? esPendiente(c.estado) : c.estado === estadoKey
      );
    } catch (e) {
      console.error('Error cargando modal:', e);
    } finally {
      this.modalCargando = false;
      this.cdr.detectChanges();
    }
  }

  async abrirModalGlobal(estadoKey: string, label: string, colorText: string) {
    this.modalVisible = true;
    this.modalLlamador = null;
    this.modalEstadoLabel = label;
    this.modalEstadoKey = estadoKey;
    this.modalColorText = colorText;
    this.modalCasos = [];
    this.modalCargando = true;
    this.cdr.detectChanges();
    try {
      this.modalCasos = estadoKey === 'todos'
        ? await this.fs.getHistorialCompleto()
        : await this.fs.getCasosPorEstado(estadoKey);
    } catch (e) {
      console.error('Error cargando modal global:', e);
    } finally {
      this.modalCargando = false;
      this.cdr.detectChanges();
    }
  }

  enviandoEmail: Record<string, boolean> = {};
  emailEnviado: Record<string, boolean> = {};
  emailError: Record<string, string> = {};

  async imprimirCarta(caso: CasoModel): Promise<void> {
    // Si no hay domicilios cacheados, buscar en Certero antes de imprimir
    const domiciliosCacheados: any[] = caso.certeroData?.['domicilios'] ?? [];
    if (domiciliosCacheados.length === 0 && caso.CUIL) {
      const data = await this.certero.getSumario(caso.CUIL);
      if (data && !data._noEncontrado) {
        caso = { ...caso, certeroData: data as any };
        if (caso.id) this.fs.guardarSumarioCertero(caso.id, data);
      }
    }
    this._generarCartaPDF(caso);
  }

  private _generarCartaPDF(caso: CasoModel): void {
    const nombreCompleto = caso.Trabajador || '';

    // ── Parsear nombre y apellido ─────────────────────────────
    let apellidoRaw: string, primerNombre: string;
    if (nombreCompleto.includes(',')) {
      apellidoRaw = nombreCompleto.split(',')[0].trim();
      primerNombre = nombreCompleto.split(',')[1]?.trim().split(' ')[0] ?? 'Cliente';
    } else {
      const partes = nombreCompleto.trim().split(/\s+/);
      apellidoRaw = partes[0] ?? '';
      primerNombre = partes[1] ?? partes[0] ?? 'Cliente';
    }
    const apellido = apellidoRaw.charAt(0).toUpperCase() + apellidoRaw.slice(1).toLowerCase();
    primerNombre = primerNombre.charAt(0).toUpperCase() + primerNombre.slice(1).toLowerCase();

    // ── Dirección desde certeroData cacheado ──────────────────
    const domicilios: any[] = caso.certeroData?.['domicilios'] ?? [];
    let lineaDireccion = '';
    let lineaCiudad = '';
    let lineaProvincia = '';
    let lineaCP = '';
    if (domicilios.length > 0) {
      const d = domicilios[0];
      const calle = [d.calle, d.altura].filter(Boolean).join(' ');
      const detalle = [d.piso ? `Piso ${d.piso}` : '', d.depto ? `Dpto ${d.depto}` : ''].filter(Boolean).join(' ');
      lineaDireccion = detalle ? `${calle}, ${detalle}` : calle;
      lineaCiudad    = d.localidad  ?? '';
      lineaProvincia = d.provincia  ?? '';
      lineaCP        = d.cp         ?? '';
    }

    import('jspdf').then(({ jsPDF }) => {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const PW = 210, PH = 297;
      const ML = 22, MR = 22;
      const CW = PW - ML - MR;

      // ── Franja azul superior (más alta para dar aire) ─────────
      doc.setFillColor(30, 58, 138);
      doc.rect(0, 0, PW, 22, 'F');
      doc.setFillColor(37, 99, 235);
      doc.rect(0, 22, PW, 2.5, 'F');

      // ── Franja azul inferior ──────────────────────────────────
      doc.setFillColor(37, 99, 235);
      doc.rect(0, PH - 16, PW, 2.5, 'F');
      doc.setFillColor(30, 58, 138);
      doc.rect(0, PH - 13.5, PW, 13.5, 'F');

      // ── Fecha dentro del encabezado ───────────────────────────
      const hoy = new Date();
      const fechaStr = hoy.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(200, 215, 255);
      doc.text(fechaStr, PW - MR, 14, { align: 'right' });

      // ── Helpers ───────────────────────────────────────────────
      let y = 32;

      const ln = (txt: string, size: number, bold: boolean, r: number, g: number, b: number, width = CW) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        doc.setTextColor(r, g, b);
        const lines = doc.splitTextToSize(txt, width);
        doc.text(lines, ML, y);
        y += lines.length * (size * 0.44) + 2;
      };

      const sp = (mm: number) => { y += mm; };

      // ── Línea divisoria ───────────────────────────────────────
      doc.setDrawColor(37, 99, 235);
      doc.setLineWidth(0.5);
      doc.line(ML, y, ML + CW, y);
      sp(8);

      // ── ENCABEZADO: MENSAJE ───────────────────────────────────
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(37, 99, 235);
      doc.text('MENSAJE', ML, y);
      y += 6;

      ln(`Hola ${primerNombre}, ¿cómo estás?`, 14, true, 26, 26, 26);
      sp(6);

      ln('Te escribo por tu accidente de trabajo. Tengo entendido que la aseguradora no evaluó las secuelas de tus lesiones, lo cual es una lástima, ya que es muy probable que haya aspectos positivos para valorar.', 13, false, 50, 50, 50);
      sp(5);

      ln('Te cuento que en casos como el tuyo —accidentes con baja prolongada— siempre vale la pena hacer una revisión médica.', 13, false, 50, 50, 50);
      sp(5);

      ln('Yo me dedico a realizar este trámite y no es necesario que te muevas de tu casa, excepto para la evaluación médica.', 13, false, 50, 50, 50);
      sp(5);

      ln('Tené en cuenta que la ART directamente no informa estas cuestiones.', 13, false, 50, 50, 50);
      sp(5);

      ln('Me gustaría que me consultes o, al menos, que puedas sacarte las dudas que tengas.', 13, false, 50, 50, 50);
      sp(5);

      ln('Abajo te dejo mi teléfono para que me mandes un WhatsApp sin compromiso. En dos minutos te digo si tiene o no sentido avanzar.', 13, false, 50, 50, 50);

      // ── Firma ─────────────────────────────────────────────────
      sp(10);
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.35);
      doc.line(ML, y, ML + 65, y);
      sp(6);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(12);
      doc.setTextColor(110, 110, 110);
      doc.text('Un saludo,', ML, y);
      y += 7;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(30, 58, 138);
      doc.text('Carla Vignale', ML, y);

      // ── BLOQUE DESTINATARIO EN TERCIO INFERIOR ────────────────
      const FOOTER_Y = PH - 16;
      const BLOCK_H  = 60;
      const blockY   = FOOTER_Y - BLOCK_H - 6;

      // Fondo gris suave
      doc.setFillColor(245, 247, 250);
      doc.roundedRect(ML - 5, blockY - 6, CW + 10, BLOCK_H + 6, 3, 3, 'F');

      // Barra azul izquierda
      doc.setFillColor(37, 99, 235);
      doc.rect(ML - 5, blockY - 6, 4, BLOCK_H + 6, 'F');

      // Etiqueta título
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(37, 99, 235);
      doc.text('DATOS DEL DESTINATARIO', ML + 3, blockY);

      // Fichas: label pequeño encima, valor grande debajo
      // Disposición en 2 columnas para los campos cortos
      let by = blockY + 8;
      const COL2 = ML + 3 + CW / 2; // inicio columna derecha

      const ficha = (label: string, valor: string, x: number, maxW: number) => {
        if (!valor) return 0;
        // Label pequeño azul
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(37, 99, 235);
        doc.text(label.toUpperCase(), x, by);
        // Valor más grande oscuro
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(26, 26, 26);
        const lines = doc.splitTextToSize(valor, maxW);
        doc.text(lines, x, by + 4.5);
        return lines.length * 5.5 + 4.5;
      };

      // Fila 1: Nombre (ancho completo)
      const h1 = ficha('Nombre y Apellido', `${primerNombre} ${apellido}`, ML + 3, CW - 6);
      by += h1 + 5;

      // Fila 2: Dirección (ancho completo)
      const h2 = ficha('Dirección', lineaDireccion, ML + 3, CW - 6);
      by += h2 + 5;

      // Fila 3: Ciudad | Provincia | CP en tres columnas
      const tercio = (CW - 6) / 3;
      ficha('Ciudad',          lineaCiudad,              ML + 3,              tercio - 3);
      ficha('Provincia',       lineaProvincia,            ML + 3 + tercio,     tercio - 3);
      ficha('Código Postal',   lineaCP ? `CP ${lineaCP}` : '', ML + 3 + tercio * 2, tercio - 3);

      doc.save(`Carta - ${apellido}.pdf`);

      // Marcar carta como impresa en Firestore
      if (caso.id) {
        this.fs.marcarCartaImpresa(caso.id);
        const idx = this.casosEstado.findIndex(c => c.id === caso.id);
        if (idx >= 0) this.casosEstado[idx] = { ...this.casosEstado[idx], cartaImpresa: true };
        this.cdr.detectChanges();
      }
    });
  }

  async enviarEmail(caso: CasoModel) {
    const id = caso.id ?? caso.CUIL ?? Math.random().toString();
    this.enviandoEmail[id] = true;
    this.emailError[id] = '';
    this.cdr.detectChanges();
    try {
      // 1. Si no hay certeroData con emails, consultar Certero y cachear
      let emailsCacheados: string[] = this.emailSvc.getEmailsDelCaso(caso);
      if (emailsCacheados.length === 0 && caso.CUIL) {
        const data = await this.certero.getSumario(caso.CUIL);
        if (data && !data._noEncontrado) {
          caso = { ...caso, certeroData: data as any };
          if (caso.id) this.fs.guardarSumarioCertero(caso.id, data);
          emailsCacheados = this.emailSvc.getEmailsDelCaso(caso);
        }
      }

      // 2. Si aún no hay emails, guardar error y salir
      if (emailsCacheados.length === 0) {
        const msg = 'Sin email en Certero';
        this.emailError[id] = msg;
        if (caso.id) {
          await this.fs.marcarEmailError(caso.id, msg);
          const patch = { emailErrorMsg: msg };
          const idxEstado = this.casosEstado.findIndex(c => c.id === caso.id);
          if (idxEstado >= 0) this.casosEstado[idxEstado] = { ...this.casosEstado[idxEstado], ...patch };
          const idxModal = this.modalCasos.findIndex(c => c.id === caso.id);
          if (idxModal >= 0) this.modalCasos[idxModal] = { ...this.modalCasos[idxModal], ...patch };
        }
        return;
      }

      // 3. Abrir Gmail compose por cada email encontrado
      const { destinatarios } = this.emailSvc.abrirMailtos(caso);

      // 4. Marcar como enviado en Firestore y actualizar ambas listas en memoria
      this.emailEnviado[id] = true;
      if (caso.id) {
        await this.fs.marcarEmailEnviado(caso.id);
        const patch = { emailEnviado: true, emailErrorMsg: '' };
        const idxEstado = this.casosEstado.findIndex(c => c.id === caso.id);
        if (idxEstado >= 0) this.casosEstado[idxEstado] = { ...this.casosEstado[idxEstado], ...patch };
        const idxModal = this.modalCasos.findIndex(c => c.id === caso.id);
        if (idxModal >= 0) this.modalCasos[idxModal] = { ...this.modalCasos[idxModal], ...patch };
      }
    } catch (e: any) {
      const msg = 'Error al abrir Gmail';
      this.emailError[id] = msg;
      if (caso.id) {
        await this.fs.marcarEmailError(caso.id, msg);
        const patch = { emailErrorMsg: msg };
        const idxEstado = this.casosEstado.findIndex(c => c.id === caso.id);
        if (idxEstado >= 0) this.casosEstado[idxEstado] = { ...this.casosEstado[idxEstado], ...patch };
        const idxModal = this.modalCasos.findIndex(c => c.id === caso.id);
        if (idxModal >= 0) this.modalCasos[idxModal] = { ...this.modalCasos[idxModal], ...patch };
      }
      console.error('Gmail error:', e);
    } finally {
      this.enviandoEmail[id] = false;
      this.cdr.detectChanges();
    }
  }

  cerrarModal() {
    this.modalVisible = false;
    this.modalLlamador = null;
    this.modalCasos = [];
    this.cdr.detectChanges();
  }

  labelEstado(e: string): string {
    const map: Record<string, string> = {
      acepto: 'Acepto', interesado: 'Interesado', sincontacto: 'Sin Contacto',
      conabogado: 'Con Abogado', nointeresado: 'No Interesado'
    };
    return map[e] ?? e;
  }

  colorEstado(e: string): string {
    const map: Record<string, string> = {
      acepto: 'bg-green-100 text-green-700',
      interesado: 'bg-yellow-100 text-yellow-700',
      sincontacto: 'bg-red-100 text-red-700',
      conabogado: 'bg-orange-100 text-orange-700',
      nointeresado: 'bg-gray-100 text-gray-600',
    };
    return map[e] ?? 'bg-gray-100 text-gray-500';
  }

  // ── Excel / Upload ────────────────────────────────────────

  /**
   * Mapeo de posición de columna → nombre de campo en Firestore/CasoModel.
   * El Excel no tiene fila de encabezados estándar: la primera fila (row 0)
   * contiene datos reales mezclados con los labels "venta" y "asignado" en
   * las últimas columnas. Se lee con header:1 y se salta row 0.
   */
  private readonly EXCEL_COLS: Record<number, string> = {
    0:  'Trabajador',
    1:  'Lesion_1',
    2:  'ART',
    3:  'CUIL',
    4:  'Tipo_Accidente',
    5:  'Fecha_Accidente',
    6:  'Dias_ILT',
    7:  'Lesion_2',
    8:  'Diag_1',
    9:  'Secuelas',
    10: 'zona',
    11: 'Provincia_Ocurrencia',
    12: 'CUIT_Empleador',
    13: 'Egreso',
    15: 'Nro_Intercurrencia',
    16: 'Fecha_Alta_Medica',
    17: 'Registrado_Por',
    18: 'Domicilio_Ocurrencia',
    20: 'Cod_Prest_Med',
    21: 'Fecha_Inicio_Inasistencia',
    23: 'Intercurrencia',
    25: 'Fecha_Inicio_Transitoriedad',
    28: 'Ocupacion',
    38: 'Agente_Material',
    39: 'Forma_Accidente',
    40: 'Descripcion_Siniestro',
    41: 'Recalificacion',
    42: 'Cronico',
    43: 'Tratamiento_Pendiente',
    45: 'Ingreso_Base',
    47: 'Ocurrencia_Via_Publica',
    48: 'Nro_AT',
    49: 'CUIT_Ocurrencia',
    53: 'Emp_Denominacion',
    54: 'Emp_Direccion',
    55: 'Emp_Forma_Juridica',
    56: 'Emp_Actividad_Principal',
    57: 'Emp_Actividad_Secundaria',
    58: 'Emp_Otra_Actividad',
    59: 'Emp_Afiliacion_Vigente',
    60: 'Emp_Inicio_Afiliacion',
    61: 'Tipo_Registro',
    62: 'Forma_Ingreso',
    64: 'Sexo',
    65: 'Nacionalidad',
    67: 'CUIL_Definitiva',
    68: 'venta',
    69: 'ASGINADO',
  };

  private mapearFila(row: any[]): Record<string, any> {
    const obj: Record<string, any> = {};
    for (const [idxStr, campo] of Object.entries(this.EXCEL_COLS)) {
      const val = row[Number(idxStr)];
      obj[campo] = (val === undefined || val === null) ? '' : String(val).trim();
    }
    return obj;
  }

  onArchivoSeleccionado(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.resetUpload();
    this.archivoNombre = file.name;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];

        // Leer TODAS las filas como arrays (sin asumir fila de encabezados)
        const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { defval: '', header: 1 }) as any[][];

        // Fila 0 tiene los datos mezclados con los labels de las últimas columnas → se omite
        const filasMapeadas = rawRows
          .slice(1)
          .map(row => this.mapearFila(row))
          .filter(f => f['Trabajador'] !== '');  // descartar filas vacías

        if (filasMapeadas.length === 0) {
          this.uploadError = 'El archivo no contiene datos válidos.';
          this.estadoUpload = 'error';
        } else {
          this.datosParaSubir = filasMapeadas;
          this.totalFilas = filasMapeadas.length;
          this.columnas = Object.values(this.EXCEL_COLS);
          this.filaPreview = filasMapeadas.slice(0, 5);
          this.estadoUpload = 'preview';
        }
      } catch {
        this.uploadError = 'No se pudo leer el archivo. Asegurate de que sea un Excel válido (.xlsx / .xls).';
        this.estadoUpload = 'error';
      }
      this.cdr.detectChanges();
    };
    reader.readAsArrayBuffer(file);
    input.value = '';
  }

  async confirmarUpload() {
    if (this.datosParaSubir.length === 0) return;

    this.estadoUpload = 'subiendo';
    this.uploadSubidos = 0;
    this.uploadTotal = this.datosParaSubir.length;

    try {
      const result = await this.fs.uploadCasos(
        this.datosParaSubir,
        (subidos, total) => {
          this.uploadSubidos = subidos;
          this.uploadTotal = total;
          this.cdr.detectChanges();
        }
      );
      this.uploadResult = result;

      // Limpieza automática
      this.estadoUpload = 'limpiando';

      this.limpiezaPaso = 'Eliminando registros sin valor de Venta...';
      this.cdr.detectChanges();
      const r2 = await this.fs.eliminarSinVenta();
      this.limpiezaSinVentaEliminados = r2.eliminados;

      this.limpiezaPaso = 'Eliminando duplicados...';
      this.cdr.detectChanges();
      const r3 = await this.fs.eliminarDuplicados();
      this.limpiezaDuplicadosEliminados = r3.eliminados;

      this.estadoUpload = 'done';
    } catch (err: any) {
      this.uploadError = err.message ?? 'Error durante la carga.';
      this.estadoUpload = 'error';
    }
    this.cdr.detectChanges();
  }

  resetUpload() {
    this.estadoUpload = 'idle';
    this.archivoNombre = '';
    this.columnas = [];
    this.totalFilas = 0;
    this.filaPreview = [];
    this.datosParaSubir = [];
    this.uploadSubidos = 0;
    this.uploadTotal = 0;
    this.uploadResult = null;
    this.uploadError = '';
    this.limpiezaPaso = '';
    this.limpiezaVentaSiEliminados = 0;
    this.limpiezaSinVentaEliminados = 0;
    this.limpiezaDuplicadosEliminados = 0;
  }

  // ── Cola Personal ─────────────────────────────────────────

  async cargarDatosCola(): Promise<void> {
    this.colaCargando = true;
    this.cdr.detectChanges();
    try {
      [this.colaEstados, this.reglasCola] = await Promise.all([
        this.fs.getEstadoColas(),
        this.fs.getReglasCola(),
      ]);
      // Para cada apodo con cola, cargar su límite actual
      for (const { apodo } of this.colaEstados) {
        if (!(apodo in this.limitesConfig)) {
          const cfg = await this.fs.getConfigLlamador(apodo);
          this.limitesConfig[apodo] = cfg.limitePendientes;
        }
      }
    } finally {
      this.colaCargando = false;
      this.cdr.detectChanges();
    }
  }

  async guardarLimiteLlamador(apodo: string): Promise<void> {
    this.limitesGuardando[apodo] = true;
    this.limitesMensaje[apodo] = '';
    this.cdr.detectChanges();
    try {
      await this.fs.setConfigLlamador(apodo, this.limitesConfig[apodo]);
      this.limitesMensaje[apodo] = '✓ Guardado';
    } catch {
      this.limitesMensaje[apodo] = 'Error al guardar';
    } finally {
      this.limitesGuardando[apodo] = false;
      this.cdr.detectChanges();
    }
  }

  async setSeccionCola(): Promise<void> {
    this.seccionActiva = 'cola';
    await this.cargarDatosCola();
  }

  async agregarReglaCola(): Promise<void> {
    this.colaReglaError = '';
    const loc = this.nuevaReglaLocalidad.trim();
    const apodo = this.nuevaReglaApodo.trim();
    if (!loc || !apodo) { this.colaReglaError = 'Completá ambos campos.'; return; }
    await this.fs.agregarReglaCola(loc, apodo);
    this.nuevaReglaLocalidad = '';
    this.nuevaReglaApodo = '';
    await this.cargarDatosCola();
  }

  async eliminarReglaCola(id: string): Promise<void> {
    await this.fs.eliminarReglaCola(id);
    this.reglasCola = this.reglasCola.filter(r => r.id !== id);
    this.cdr.detectChanges();
  }

  async aplicarReglasCola(): Promise<void> {
    this.colaAplicandoReglas = true;
    this.colaReglaAsignados = 0;
    this.cdr.detectChanges();
    try {
      const result = await this.fs.aplicarReglasCola(n => {
        this.colaReglaAsignados = n;
        this.cdr.detectChanges();
      });
      this.colaReglaAsignados = result.asignados;
      await this.cargarDatosCola();
    } finally {
      this.colaAplicandoReglas = false;
      this.cdr.detectChanges();
    }
  }

  // ── Nav ──────────────────────────────────────────────────

  irACrearUsuario(): void {
    this.router.navigate(['/crear-usuario']);
  }

  async cerrarSesion(): Promise<void> {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }
}

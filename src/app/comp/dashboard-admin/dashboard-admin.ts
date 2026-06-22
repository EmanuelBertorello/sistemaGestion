import { Component, NgZone, OnInit, OnDestroy, ChangeDetectorRef, PLATFORM_ID, Inject, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirestoreService, UploadResult, LlamadorStats, NoticiaItem } from '../../services/firestore.service';
import { EmailService } from '../../services/email.service';
import { CerteroService } from '../../services/certero.service';
import { AnexoService } from '../../services/anexo.service';
import { CasoModel, EstadoCaso } from '../dashboard-llamador/caso.model';
import * as XLSX from 'xlsx';

type SeccionActiva = 'estadisticas' | 'acepto' | 'interesado' | 'sincontacto' | 'conabogado' | 'nointeresado' | 'cargar' | 'historial' | 'duplicados' | 'noticias' | 'cola' | 'ventasi' | 'llamadoras';

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

  sidebarCollapsed = false;
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
  casoDetalleCambiando = false;
  casoDetalleMensaje = '';

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
  casosEstadoFiltroLlamador = '';

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
  limpiezaMigradosVentaSi = 0;
  resumenVentaSi = 0;
  resumenVentaNo = 0;
  resumenVolumen = 0;
  resumenHighTicket = 0;

  get uploadPct(): number {
    if (this.uploadTotal === 0) return 0;
    return Math.round((this.uploadSubidos / this.uploadTotal) * 100);
  }

  // ─────────────────────────────────────────────────────────

  @HostListener('document:keydown.escape')
  onEscape() { this.casoDetalle = null; }

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;
    await this.cargarEstadisticas();
    this.fs.getCantidadEnCola().then(n => this.zone.run(() => { this.casosEnCola = n; }));
    this.colaInterval = setInterval(() => {
      this.fs.getCantidadEnCola().then(n => this.zone.run(() => { this.casosEnCola = n; this.cdr.detectChanges(); }));
    }, 15000); // cada 15s — no martillar Firestore

    // Historial en tiempo real con onSnapshot (reemplaza polling cada 30s)
    this.unsubHistorial = this.fs.escucharHistorialCompleto(casos => {
      this.zone.run(() => {
        this.historial = casos;
        this.cargandoHistorial = false;
        this.cdr.detectChanges();
      });
    });
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
    if (this.historialInterval) clearInterval(this.historialInterval); // legacy, puede estar vacío
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
      this.llamadores = await this.fs.getEstadisticasAdmin(this.getDesde(this.periodoFiltro), this.auth.getCurrentEmail());
    } catch (e) {
      console.error('Error cargando estadísticas:', e);
    } finally {
      this.cargandoStats = false;
      this.cdr.detectChanges();
    }
  }

  async setSeccion(s: SeccionActiva) {
    this.seccionActiva = s;
    this.casosEstadoFiltroLlamador = '';
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
  migrando = false;
  migradosCount = 0;

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

  // Buscador de localidades
  buscarLocalidadTermino = '';
  localidadesEncontradas: string[] = [];
  buscandoLocalidades = false;
  colaAplicandoReglas = false;
  colaReglaAsignados = 0;

  // Límites de pendientes por llamador
  limitesConfig: Record<string, number> = {};
  limitesGuardando: Record<string, boolean> = {};
  limitesMensaje: Record<string, string> = {};

  // Límites diarios por llamador
  limiteDiarioConfig: Record<string, number> = {};
  limiteDiarioGuardando: Record<string, boolean> = {};
  limiteDiarioMensaje: Record<string, string> = {};

  // Perfiles por llamador
  perfilesConfig: Record<string, string> = {};
  todosLlamadores: Array<{ apodo: string; perfil: string; limitePendientes: number; limiteDiario: number; requiereDocs: boolean; requiereExpediente: boolean }> = [];

  // Requisitos de "Acepto" por llamador (PDFs / nro de expediente)
  requiereDocsConfig: Record<string, boolean> = {};
  requiereExpedienteConfig: Record<string, boolean> = {};
  requisitosGuardando: Record<string, boolean> = {};
  requisitosMensaje: Record<string, string> = {};

  // Liberar/Eliminar casos por llamador
  liberandoApodo: Record<string, boolean> = {};
  liberadosMensaje: Record<string, string> = {};
  eliminandoApodo: Record<string, boolean> = {};

  descargandoCola = false;

  vaciandoCola = false;
  vaciarColaEliminados = 0;

  eliminandoILT = false;
  iltEliminados = 0;

  async eliminarMenosDe10ILT(): Promise<void> {
    if (!confirm('¿Eliminar de la cola todos los casos con menos de 10 días de ILT?')) return;
    this.eliminandoILT = true;
    this.iltEliminados = 0;
    this.cdr.detectChanges();
    try {
      const result = await this.fs.eliminarPorMinILT(10, (n) => {
        this.iltEliminados = n;
        this.cdr.detectChanges();
      });
      this.iltEliminados = result.eliminados;
      alert(`✓ ${result.eliminados} casos con ILT < 10 días eliminados.`);
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
    } finally {
      this.eliminandoILT = false;
      this.cdr.detectChanges();
    }
  }

  async vaciarCola() {
    this.vaciandoCola = true;
    this.vaciarColaEliminados = 0;
    this.cdr.detectChanges();
    try {
      const result = await this.fs.vaciarCola((n) => {
        this.vaciarColaEliminados = n;
        this.cdr.detectChanges();
      });
      this.vaciarColaEliminados = result.eliminados;
      alert(`✓ ${result.eliminados} casos en cola eliminados.`);
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
    } finally {
      this.vaciandoCola = false;
      this.cdr.detectChanges();
    }
  }

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

  archivando = false;
  archivadosCount = 0;

  async archivarCasosViejos(): Promise<void> {
    this.archivando = true;
    this.archivadosCount = 0;
    this.cdr.detectChanges();
    try {
      this.archivadosCount = await this.fs.archivarCasosViejos(90, n => {
        this.archivadosCount = n;
        this.cdr.detectChanges();
      });
      alert(`✓ ${this.archivadosCount} casos archivados (procesados hace >90 días).`);
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
    } finally {
      this.archivando = false;
      this.cdr.detectChanges();
    }
  }

  async migrarVentaSiExistente(): Promise<void> {
    this.migrando = true;
    this.migradosCount = 0;
    this.cdr.detectChanges();
    try {
      this.migradosCount = await this.fs.migrarVentaSiAColeccionSeparada(n => {
        this.migradosCount = n;
        this.cdr.detectChanges();
      });
      alert(`✓ ${this.migradosCount} casos VentaSI migrados a colección separada.`);
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
    } finally {
      this.migrando = false;
      this.cdr.detectChanges();
    }
  }

  async eliminarVentaSi() {
    this.estadoVentaSi = 'buscando';
    this.ventaSiEliminados = 0;
    this.ventaSiError = '';
    this.cdr.detectChanges();
    try {
      // Exportar Excel antes de borrar
      const casos = await this.fs.getCasosVentaSi();
      if (casos.length > 0) {
        const filas = casos.map(c => ({
          Trabajador: c.Trabajador || '',
          CUIL: c.CUIL || '',
          Empresa: c.Emp_Denominacion || '',
          ART: (c as any).ART || '',
          Dias_ILT: c.Dias_ILT || '',
          Fecha_Accidente: c.Fecha_Accidente || '',
          Lesion: c.Lesion_1 || '',
          Diagnostico: c.Diag_1 || '',
          Zona: c.zona || '',
          Ingreso_Base: c.Ingreso_Base || '',
          Registrado_Por: c.Registrado_Por || '',
        }));
        const ws = XLSX.utils.json_to_sheet(filas);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'VentaSI');
        XLSX.writeFile(wb, `venta_si_backup_${new Date().toISOString().slice(0,10)}.xlsx`);
      }

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
    const ll = this.casosEstadoFiltroLlamador.trim().toLowerCase();
    return this.casosEstado.filter(c => {
      if (q && !(c.Trabajador || '').toLowerCase().includes(q)) return false;
      if (ll) {
        const cLlamador = ((c.ASGINADO || c.procesadoPor) ?? '').toLowerCase();
        if (!cLlamador.includes(ll)) return false;
      }
      return true;
    });
  }

  get llamadoresEnEstado(): string[] {
    const set = new Set<string>();
    for (const c of this.casosEstado) {
      const ll = (c.ASGINADO || c.procesadoPor || '').trim();
      if (ll) set.add(ll);
    }
    return [...set].sort();
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
      // Pasar el apodo real para que getHistorialPor use tanto email como ASGINADO
      const todos = await this.fs.getHistorialPor(llamador.email, llamador.nombre);
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

  formatFecha(val: any): string {
    if (!val && val !== 0) return '—';
    const n = typeof val === 'number' ? val : Number(val);
    if (!isNaN(n) && n > 1000 && n < 100000) {
      const d = new Date((n - 25569) * 86400 * 1000);
      if (!isNaN(d.getTime())) {
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        return `${dd}/${mm}/${d.getUTCFullYear()}`;
      }
    }
    return String(val) || '—';
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
      acepto: 'badge badge-acepto',
      pendiente: 'badge badge-pendiente',
      interesado: 'badge badge-interesado',
      nocontesto: 'badge badge-interesado',
      sincontacto: 'badge badge-sincontacto',
      conabogado: 'badge badge-conabogado',
      nointeresado: 'badge badge-nointeresado',
    };
    return map[e] ?? 'badge badge-nointeresado';
  }

  async adminCambiarEstado(estado: EstadoCaso): Promise<void> {
    if (!this.casoDetalle?.id || this.casoDetalleCambiando) return;
    this.casoDetalleCambiando = true;
    this.casoDetalleMensaje = '';
    try {
      // Preservar al llamador original: el mérito es de quien trabajó el caso, no del admin
      const emailLlamador = this.casoDetalle.procesadoPor || '';
      const apodoLlamador = this.casoDetalle.ASGINADO || emailLlamador.split('@')[0] || 'admin';
      await this.fs.cambiarEstadoCaso(this.casoDetalle.id, estado, emailLlamador || 'admin', apodoLlamador, this.casoDetalle);
      this.casoDetalle = { ...this.casoDetalle, estado };
      this.casoDetalleMensaje = '✓ Estado actualizado';
      // Refrescar lista si está en historial
      if (this.seccionActiva !== 'estadisticas' && this.seccionActiva !== 'cargar' && this.seccionActiva !== 'ventasi' && this.seccionActiva !== 'cola') {
        this.casosEstado = this.casosEstado.map(c => c.id === this.casoDetalle!.id ? { ...c, estado } : c);
      }
      if (this.seccionActiva === 'historial') {
        this.historial = this.historial.map(c => c.id === this.casoDetalle!.id ? { ...c, estado } : c);
      }
    } catch {
      this.casoDetalleMensaje = 'Error al cambiar estado';
    } finally {
      this.casoDetalleCambiando = false;
      this.cdr.detectChanges();
    }
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
    69: 'tipoCaso',
  };

  private excelSerialAFecha(serial: number): string {
    // Excel serial: días desde 1/1/1900 (con bug año bisiesto 1900)
    // 25569 = días entre epoch Excel y epoch Unix (1/1/1970)
    const ms = (serial - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return String(serial);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  private readonly CAMPOS_FECHA = new Set([
    'Fecha_Accidente', 'Fecha_Alta_Medica', 'Fecha_Inicio_Inasistencia',
    'Fecha_Inicio_Transitoriedad', 'Fecha_Cese_Transitoriedad',
    'Fecha_Toma_Conocimiento', 'Fecha_Ingreso_Denuncia',
    'Fecha_Finalizacion', 'Fecha_Rechazo', 'FechaNacimiento',
  ]);

  private mapearFila(row: any[]): Record<string, any> {
    const obj: Record<string, any> = {};
    for (const [idxStr, campo] of Object.entries(this.EXCEL_COLS)) {
      const val = row[Number(idxStr)];
      if (val === undefined || val === null) { obj[campo] = ''; continue; }
      // Convertir serial numérico de Excel a fecha DD/MM/YYYY
      if (this.CAMPOS_FECHA.has(campo) && typeof val === 'number' && val > 1000) {
        obj[campo] = this.excelSerialAFecha(val);
      } else {
        obj[campo] = String(val).trim();
      }
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

        // Detectar posición de venta/tipoCaso leyendo la fila de encabezados (fila 0)
        // para ser resiliente ante cambios de columnas entre versiones del archivo
        const headerRow = rawRows[0] ?? [];
        let ventaIdx = 68, tipoCasoIdx = 69; // fallback al formato anterior
        headerRow.forEach((cell: any, idx: number) => {
          if (!cell) return;
          const h = cell.toString().toLowerCase().trim();
          if (h === 'venta') ventaIdx = idx;
          else if (h === 'tipocaso') tipoCasoIdx = idx;
        });

        // Fila 0 tiene los datos mezclados con los labels de las últimas columnas → se omite
        const filasMapeadas = rawRows
          .slice(1)
          .map(row => {
            const obj = this.mapearFila(row);
            const vVal = row[ventaIdx];
            const tVal = row[tipoCasoIdx];
            obj['venta'] = (vVal == null) ? '' : vVal.toString();
            obj['tipoCaso'] = (tVal == null) ? '' : tVal.toString();
            return obj;
          })
          .filter(f => f['Trabajador'] !== '');  // descartar filas vacías

        if (filasMapeadas.length === 0) {
          this.uploadError = 'El archivo no contiene datos válidos.';
          this.estadoUpload = 'error';
        } else {
          this.datosParaSubir = filasMapeadas;
          this.totalFilas = filasMapeadas.length;
          this.columnas = Object.values(this.EXCEL_COLS);
          this.filaPreview = filasMapeadas.slice(0, 5);

          // Conteos en preview para que el admin vea antes de confirmar
          this.resumenVentaSi = filasMapeadas.filter(f => {
            const v = (f['venta'] ?? '').toString().toLowerCase().trim();
            return v === 'si' || v === 'sí';
          }).length;
          this.resumenVentaNo = filasMapeadas.filter(f => {
            const v = (f['venta'] ?? '').toString().toLowerCase().trim();
            return v === 'no';
          }).length;
          this.resumenVolumen = filasMapeadas.filter(f =>
            (f['tipoCaso'] ?? '').toString().trim() === '0'
          ).length;
          this.resumenHighTicket = filasMapeadas.filter(f =>
            (f['tipoCaso'] ?? '').toString().trim() === '1'
          ).length;

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

      this.limpiezaPaso = 'Migrando VentaSI a colección separada...';
      this.cdr.detectChanges();
      this.limpiezaMigradosVentaSi = await this.fs.migrarVentaSiAColeccionSeparada(n => {
        this.limpiezaMigradosVentaSi = n;
        this.cdr.detectChanges();
      });

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
    this.limpiezaMigradosVentaSi = 0;
    this.resumenVentaSi = 0;
    this.resumenVentaNo = 0;
    this.resumenVolumen = 0;
    this.resumenHighTicket = 0;
  }

  // ── Cola Personal ─────────────────────────────────────────

  async cargarDatosCola(): Promise<void> {
    this.colaCargando = true;
    this.cdr.detectChanges();
    try {
      // Reparar ASGINADO corruptos ('0','1') antes de cargar estados
      await this.fs.repararAsginadoTipoCaso();

      [this.colaEstados, this.reglasCola, this.todosLlamadores] = await Promise.all([
        this.fs.getEstadoColas(),
        this.fs.getReglasCola(),
        this.fs.getTodosLlamadoresConPerfil(),
      ]);
      await this.cargarUsuariosReasig();
      // Inicializar perfilesConfig y limitesConfig con todos los llamadores
      for (const ll of this.todosLlamadores) {
        this.perfilesConfig[ll.apodo] = ll.perfil;
        if (!(ll.apodo in this.limitesConfig)) this.limitesConfig[ll.apodo] = ll.limitePendientes;
        if (!(ll.apodo in this.limiteDiarioConfig)) this.limiteDiarioConfig[ll.apodo] = ll.limiteDiario;
        this.requiereDocsConfig[ll.apodo] = ll.requiereDocs;
        this.requiereExpedienteConfig[ll.apodo] = ll.requiereExpediente;
      }
      // Cargar config para apodos de colaEstados que no estén en todosLlamadores (mismatch de casing)
      const apodosYaCargados = new Set(this.todosLlamadores.map(l => l.apodo.toLowerCase()));
      for (const { apodo } of this.colaEstados) {
        if (apodo === '— Sin asignar —') continue;
        if (!apodosYaCargados.has(apodo.toLowerCase())) {
          const cfg = await this.fs.getConfigLlamador(apodo);
          this.perfilesConfig[apodo] = cfg.perfil ?? '';
          this.limitesConfig[apodo] = cfg.limitePendientes;
          this.limiteDiarioConfig[apodo] = cfg.limiteDiario;
          this.requiereDocsConfig[apodo] = cfg.requiereDocs;
          this.requiereExpedienteConfig[apodo] = cfg.requiereExpediente;
        }
      }
    } finally {
      this.colaCargando = false;
      this.cdr.detectChanges();
    }
  }

  async guardarLimiteDiarioLlamador(apodo: string): Promise<void> {
    this.limiteDiarioGuardando[apodo] = true;
    this.limiteDiarioMensaje[apodo] = '';
    this.cdr.detectChanges();
    try {
      const val = Number(this.limiteDiarioConfig[apodo]) || 0;
      await this.fs.setLimiteDiarioLlamador(apodo, val);
      this.limiteDiarioConfig[apodo] = val;
      this.limiteDiarioMensaje[apodo] = '✓';
      setTimeout(() => { this.limiteDiarioMensaje[apodo] = ''; this.cdr.detectChanges(); }, 2000);
    } catch {
      this.limiteDiarioMensaje[apodo] = 'Error';
    } finally {
      this.limiteDiarioGuardando[apodo] = false;
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

  async descargarExcelCola(): Promise<void> {
    this.descargandoCola = true;
    this.cdr.detectChanges();
    try {
      const casos = await this.fs.getCasosEnColaCompleto();
      const filas = casos.map(c => ({
        Trabajador: c.Trabajador || '',
        CUIL: c.CUIL || '',
        Empresa: c.Emp_Denominacion || '',
        ART: (c as any).ART || '',
        Dias_ILT: c.Dias_ILT || '',
        Fecha_Accidente: c.Fecha_Accidente || '',
        Lesion: c.Lesion_1 || '',
        Diagnostico: c.Diag_1 || '',
        Zona: c.zona || '',
        Provincia: c.Provincia_Ocurrencia || '',
        Ingreso_Base: c.Ingreso_Base || '',
        Registrado_Por: c.Registrado_Por || '',
        ASGINADO: c.ASGINADO || '',
        Nro_AT: c.Nro_AT || '',
        Tipo_Accidente: c.Tipo_Accidente || '',
        Egreso: c.Egreso || '',
        Tipo: (c as any).tipoCaso === '1' ? 'HighTicket' : (c as any).tipoCaso === '0' ? 'Volumen' : '',
      }));
      const ws = XLSX.utils.json_to_sheet(filas);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Cola');
      XLSX.writeFile(wb, `cola_${new Date().toISOString().slice(0,10)}.xlsx`);
    } catch (e: any) {
      alert('Error al descargar: ' + (e?.message ?? e));
    } finally {
      this.descargandoCola = false;
      this.cdr.detectChanges();
    }
  }

  async eliminarCasosApodo(apodo: string): Promise<void> {
    this.eliminandoApodo[apodo] = true;
    this.cdr.detectChanges();
    try {
      const n = await this.fs.eliminarTodosCasosDeApodo(apodo);
      await this.cargarDatosCola();
    } catch {
    } finally {
      this.eliminandoApodo[apodo] = false;
      this.cdr.detectChanges();
    }
  }

  async guardarPerfilLlamador(apodo: string): Promise<void> {
    const perfil = this.perfilesConfig[apodo] ?? '';
    await this.fs.setPerfilLlamador(apodo, perfil);
  }

  async toggleRequiereDocs(apodo: string): Promise<void> {
    this.requisitosGuardando[apodo] = true;
    this.requisitosMensaje[apodo] = '';
    this.cdr.detectChanges();
    try {
      await this.fs.setRequiereDocsLlamador(apodo, this.requiereDocsConfig[apodo]);
      this.requisitosMensaje[apodo] = '✓';
      setTimeout(() => { this.requisitosMensaje[apodo] = ''; this.cdr.detectChanges(); }, 2000);
    } finally {
      this.requisitosGuardando[apodo] = false;
      this.cdr.detectChanges();
    }
  }

  async toggleRequiereExpediente(apodo: string): Promise<void> {
    this.requisitosGuardando[apodo] = true;
    this.requisitosMensaje[apodo] = '';
    this.cdr.detectChanges();
    try {
      await this.fs.setRequiereExpedienteLlamador(apodo, this.requiereExpedienteConfig[apodo]);
      this.requisitosMensaje[apodo] = '✓';
      setTimeout(() => { this.requisitosMensaje[apodo] = ''; this.cdr.detectChanges(); }, 2000);
    } finally {
      this.requisitosGuardando[apodo] = false;
      this.cdr.detectChanges();
    }
  }

  // ── Reasignación de historial ─────────────────────────────
  usuariosReasig: Array<{ apodo: string; email: string }> = [];
  reasigDesde = '';
  reasigHasta = '';
  reasigEstados: Record<string, boolean> = { nointeresado: false, conabogado: false, sincontacto: false };
  reasigDevolverACola = false;
  reasignandoHist = false;
  reasigResultado = 0;

  // ── Reasignación de cola (no procesados) ──────────────────
  colaReasigDesde = '';
  colaReasigHasta = '';
  reasignandoCola = false;
  colaReasigResultado = -1;

  // ── Sincronizar apodo por email (retroactivo) ─────────────
  sincEmailOrigen = '';
  sincApodoDestino = '';
  sincDevolverACola = false;
  sincronizando = false;
  sincResultado = -1;

  async cargarUsuariosReasig(): Promise<void> {
    const usuarios = await this.fs.getUsuarios();
    this.usuariosReasig = usuarios
      .filter(u => u.email)
      .map(u => ({ apodo: u.apodo?.trim() || u.email.split('@')[0], email: u.email }))
      .sort((a, b) => a.apodo.localeCompare(b.apodo));
  }

  async ejecutarReasignacion(): Promise<void> {
    const estados = (Object.entries(this.reasigEstados) as [string, boolean][])
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (!this.reasigDesde || !this.reasigHasta || estados.length === 0) {
      alert('Seleccioná ambos usuarios y al menos un estado.');
      return;
    }
    if (this.reasigDesde === this.reasigHasta) {
      alert('Los usuarios deben ser distintos.');
      return;
    }
    const hastaUser = this.usuariosReasig.find(u => u.apodo === this.reasigHasta);
    if (!hastaUser) return;
    this.reasignandoHist = true;
    this.reasigResultado = 0;
    this.cdr.detectChanges();
    try {
      const n = await this.fs.reasignarCasosPorEstado(
        this.reasigDesde, this.reasigHasta, hastaUser.email, estados, this.reasigDevolverACola
      );
      this.reasigResultado = n;
      alert(`✓ ${n} casos reasignados de ${this.reasigDesde} → ${this.reasigHasta}`);
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
    } finally {
      this.reasignandoHist = false;
      this.cdr.detectChanges();
    }
  }

  async ejecutarSincronizacion(): Promise<void> {
    if (!this.sincEmailOrigen || !this.sincApodoDestino) {
      alert('Completá email y apodo destino.');
      return;
    }
    if (!confirm(`¿Sincronizar todos los casos de "${this.sincEmailOrigen}" al apodo "${this.sincApodoDestino}"?`)) return;
    this.sincronizando = true;
    this.sincResultado = -1;
    this.cdr.detectChanges();
    try {
      const [n1] = await Promise.all([
        this.fs.sincronizarApodoPorEmail(this.sincEmailOrigen, this.sincApodoDestino, this.sincDevolverACola),
      ]);
      this.sincResultado = n1;
      await this.cargarDatosCola();
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
    } finally {
      this.sincronizando = false;
      this.cdr.detectChanges();
    }
  }

  async ejecutarReasignacionCola(): Promise<void> {
    if (!this.colaReasigDesde || !this.colaReasigHasta) {
      alert('Seleccioná ambos llamadores.');
      return;
    }
    if (this.colaReasigDesde === this.colaReasigHasta) {
      alert('Los llamadores deben ser distintos.');
      return;
    }
    if (!confirm(`¿Reasignar TODOS los casos en cola de "${this.colaReasigDesde}" a "${this.colaReasigHasta}"?`)) return;
    this.reasignandoCola = true;
    this.colaReasigResultado = -1;
    this.cdr.detectChanges();
    try {
      const n = await this.fs.reasignarCasosDe(this.colaReasigDesde, this.colaReasigHasta);
      this.colaReasigResultado = n;
      await this.cargarDatosCola();
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
    } finally {
      this.reasignandoCola = false;
      this.cdr.detectChanges();
    }
  }

  async liberarCasosApodo(apodo: string): Promise<void> {
    this.liberandoApodo[apodo] = true;
    this.liberadosMensaje[apodo] = '';
    this.cdr.detectChanges();
    try {
      const n = await this.fs.liberarTodosCasosDeApodo(apodo);
      this.liberadosMensaje[apodo] = `✓ ${n} liberados`;
      await this.cargarDatosCola();
    } catch {
      this.liberadosMensaje[apodo] = 'Error';
    } finally {
      this.liberandoApodo[apodo] = false;
      this.cdr.detectChanges();
    }
  }

  async setSeccionCola(): Promise<void> {
    this.seccionActiva = 'cola';
    await this.cargarDatosCola();
  }

  async buscarLocalidades(): Promise<void> {
    this.buscandoLocalidades = true;
    this.localidadesEncontradas = [];
    this.cdr.detectChanges();
    try {
      this.localidadesEncontradas = await this.fs.buscarLocalidades(this.buscarLocalidadTermino);
    } finally {
      this.buscandoLocalidades = false;
      this.cdr.detectChanges();
    }
  }

  usarLocalidad(loc: string): void {
    this.nuevaReglaLocalidad = loc;
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

  // ── Llamadoras Propias ────────────────────────────────────

  readonly LLAMADORAS_PROPIAS = [
    { label: 'Nanci',  apodo: 'nanci',  email: '' },
    { label: 'CR',     apodo: 'cami',   email: 'cr4361990@gmail.com' },
    { label: 'Daiana', apodo: 'daiana', email: 'daianadagostino18@gmail.com' },
    { label: 'Iara',   apodo: 'iara',   email: '' },
  ];
  readonly PAGO_POR_ACEPTO = 40_000;

  semanaOffset = 0; // 0 = semana actual, negativo = semanas pasadas

  get semanaInfo(): { inicio: Date; fin: Date; dias: Date[] } {
    const hoy = new Date();
    const dow = hoy.getDay(); // 0=dom
    const diffLun = dow === 0 ? -6 : 1 - dow;
    const lun = new Date(hoy);
    lun.setDate(hoy.getDate() + diffLun + this.semanaOffset * 7);
    lun.setHours(0, 0, 0, 0);
    const dias: Date[] = Array.from({ length: 5 }, (_, i) => {
      const d = new Date(lun); d.setDate(lun.getDate() + i); return d;
    });
    const fin = new Date(dias[4]); fin.setHours(23, 59, 59, 999);
    return { inicio: lun, fin, dias };
  }

  get semanaLabel(): string {
    const { inicio, fin } = this.semanaInfo;
    const fmt = (d: Date) => d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
    return `${fmt(inicio)} — ${fmt(fin)}`;
  }

  private matchLlamadora(c: CasoModel, ll: { apodo: string; email: string }): boolean {
    const em = (c.procesadoPor || '').toLowerCase();
    const ap = (c.ASGINADO   || '').toLowerCase();
    if (ll.email && em === ll.email.toLowerCase()) return true;
    if (ll.apodo && ap === ll.apodo.toLowerCase()) return true;
    return false;
  }

  private tsToMs(raw: any): number {
    if (!raw) return 0;
    if (typeof raw.toDate === 'function') return raw.toDate().getTime();
    const ms = new Date(raw).getTime();
    return isNaN(ms) ? 0 : ms;
  }

  get statsLlamadoras() {
    const { inicio, fin, dias } = this.semanaInfo;
    const t0 = inicio.getTime(), t1 = fin.getTime();
    return this.LLAMADORAS_PROPIAS.map(ll => {
      const casos = this.historial.filter(c => {
        if (c.estado !== 'acepto') return false;
        if (!this.matchLlamadora(c, ll)) return false;
        const ts = this.tsToMs(c.procesadoTimestamp);
        return ts >= t0 && ts <= t1;
      });
      const porDia: Record<string, number> = {};
      const nombresPorDia: Record<string, string[]> = {};
      dias.forEach(d => { const k = d.toISOString().slice(0, 10); porDia[k] = 0; nombresPorDia[k] = []; });
      casos.forEach(c => {
        const ms = this.tsToMs(c.procesadoTimestamp);
        if (ms) {
          const k = new Date(ms).toISOString().slice(0, 10);
          if (k in porDia) { porDia[k]++; nombresPorDia[k].push(c.Trabajador ?? c.CUIL ?? '—'); }
        }
      });
      return { label: ll.label, aceptos: casos.length, totalPagar: casos.length * this.PAGO_POR_ACEPTO, porDia, nombresPorDia, casos };
    });
  }

  get resumenCasosSemana(): Array<{ llamadora: string; trabajador: string; cuil: string; art: string; diasIlt: string; fecha: string }> {
    const rows: Array<{ llamadora: string; trabajador: string; cuil: string; art: string; diasIlt: string; fecha: string }> = [];
    for (const ll of this.statsLlamadoras) {
      for (const c of ll.casos) {
        const ms = this.tsToMs(c.procesadoTimestamp);
        const fecha = ms ? new Date(ms).toLocaleDateString('es-AR') : '—';
        rows.push({
          llamadora: ll.label,
          trabajador: c.Trabajador ?? '—',
          cuil: c.CUIL ?? '—',
          art: c.ART ?? '—',
          diasIlt: c.Dias_ILT ?? '—',
          fecha,
        });
      }
    }
    return rows;
  }

  exportarExcelSemana(): void {
    const XLSX = (window as any)['XLSX'];
    if (!XLSX) {
      import('xlsx').then(mod => {
        (window as any)['XLSX'] = mod;
        this._generarExcel(mod);
      });
    } else {
      this._generarExcel(XLSX);
    }
  }

  private _generarExcel(XLSX: any): void {
    const filas = this.resumenCasosSemana.map(r => ({
      Llamadora: r.llamadora,
      Trabajador: r.trabajador,
      CUIL: r.cuil,
      ART: r.art,
      'Días ILT': r.diasIlt,
      'Fecha Acepto': r.fecha,
      Pago: this.PAGO_POR_ACEPTO,
    }));
    const totalRow = { Llamadora: 'TOTAL', Trabajador: '', CUIL: '', ART: '', 'Días ILT': '', 'Fecha Acepto': '', Pago: filas.reduce((s, r) => s + r.Pago, 0) };
    filas.push(totalRow);
    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Resumen Semana');
    XLSX.writeFile(wb, `Llamadoras_${this.semanaLabel.replace(/\s/g, '_')}.xlsx`);
  }

  heatColor(n: number): string {
    if (n === 0) return '#e2e8f0';
    if (n === 1) return '#86efac';
    if (n === 2) return '#22c55e';
    return '#15803d';
  }

  diasSemana(dias: Date[]): Array<{ iso: string; label: string }> {
    const nombres = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];
    return dias.map((d, i) => ({ iso: d.toISOString().slice(0, 10), label: nombres[i] }));
  }

  get esSemanaActual(): boolean { return this.semanaOffset === 0; }

  // ── Nav ──────────────────────────────────────────────────

  irACrearUsuario(): void {
    this.router.navigate(['/crear-usuario']);
  }

  async cerrarSesion(): Promise<void> {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }
}

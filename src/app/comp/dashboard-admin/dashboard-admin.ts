import { Component, NgZone, OnInit, OnDestroy, ChangeDetectorRef, PLATFORM_ID, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirestoreService, UploadResult, LlamadorStats, NoticiaItem } from '../../services/firestore.service';
import { EmailService } from '../../services/email.service';
import { CasoModel } from '../dashboard-llamador/caso.model';
import * as XLSX from 'xlsx';

type SeccionActiva = 'estadisticas' | 'acepto' | 'interesado' | 'sincontacto' | 'conabogado' | 'nointeresado' | 'cargar' | 'historial' | 'duplicados' | 'noticias';

type EstadoUpload = 'idle' | 'preview' | 'subiendo' | 'done' | 'error';

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
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

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
  cargandoHistorial = false;
  historialFiltroLlamador = '';
  historialFiltroEstado = '';

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

  get uploadPct(): number {
    if (this.uploadTotal === 0) return 0;
    return Math.round((this.uploadSubidos / this.uploadTotal) * 100);
  }

  // ─────────────────────────────────────────────────────────

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;
    await this.cargarEstadisticas();
    this.fs.getCantidadEnCola().then(n => this.zone.run(() => { this.casosEnCola = n; }));
    this.fs.getHistorialCompleto().then(h => this.zone.run(() => { this.historial = h; }));
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

  async buscarYEliminarDuplicados() {
    this.estadoDupli = 'buscando';
    this.dupliEliminados = 0;
    this.dupliError = '';
    this.cdr.detectChanges();
    try {
      // Paso 1: eliminar venta = si (columna BQ del Excel)
      await this.fs.eliminarVentaSi((n) => {
        this.dupliEliminados = n;
        this.cdr.detectChanges();
      });
      // Paso 2: eliminar duplicados por nombre + fecha accidente
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
    return this.historial.filter(c => {
      const okLlamador = !this.historialFiltroLlamador || c.procesadoPor === this.historialFiltroLlamador;
      const okEstado = !this.historialFiltroEstado
        || (this.historialFiltroEstado === 'interesado' ? this.esPendiente(c.estado) : c.estado === this.historialFiltroEstado);
      return okLlamador && okEstado;
    });
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
        this.historial = await this.fs.getHistorialCompleto();
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

  async enviarEmail(caso: CasoModel) {
    const id = caso.id ?? caso.CUIL ?? Math.random().toString();
    this.enviandoEmail[id] = true;
    this.emailError[id] = '';
    this.cdr.detectChanges();
    try {
      await this.emailSvc.enviarEmailSinContacto(caso, 'ema-ber2011@live.com.ar');
      this.emailEnviado[id] = true;
      if (caso.id) {
        await this.fs.marcarEmailEnviado(caso.id);
        // Actualizar localmente el objeto del caso para que persista
        const idx = this.casosEstado.findIndex(c => c.id === caso.id);
        if (idx >= 0) this.casosEstado[idx] = { ...this.casosEstado[idx], emailEnviado: true };
      }
    } catch (e: any) {
      this.emailError[id] = 'Error al enviar';
      console.error('EmailJS error:', e);
    } finally {
      this.enviandoEmail[id] = false;
      this.cdr.detectChanges();
    }
  }

  generarMailto(caso: CasoModel): string {
    const nombreCompleto = caso.Trabajador || 'usted';
    // Extraer apellido: formato puede ser "APELLIDO, NOMBRE" o "APELLIDO NOMBRE"
    let apellido = nombreCompleto.includes(',')
      ? nombreCompleto.split(',')[0].trim()
      : nombreCompleto.split(' ')[0].trim();
    apellido = apellido.charAt(0).toUpperCase() + apellido.slice(1).toLowerCase();

    const lesion     = caso.Lesion_1        || 'la lesión sufrida';
    const ocupacion  = caso.Ocupacion       || 'su actividad laboral';
    const empresa    = caso.Emp_Denominacion|| 'su empleador';
    const diasILT    = caso.Dias_ILT        ? `${caso.Dias_ILT} días` : 'un período de baja laboral';
    const tipoAcc    = caso.Tipo_Accidente  || 'accidente laboral';

    const subject = 'Consulta sobre su accidente laboral';
    const body =
`Estimado/a Sr./Sra. ${apellido},

Me dirijo a usted en mi carácter de abogado especializado en accidentes laborales y enfermedades profesionales.

He tomado conocimiento de que usted sufrió un ${tipoAcc} en el marco de su actividad como ${ocupacion} en ${empresa}. En ese contexto, y dado que este tipo de lesiones —particularmente ${lesion}— pueden generar secuelas que no siempre son evaluadas en toda su extensión durante el tratamiento inicial, me permito acercarme para ofrecerle una consulta sin cargo.

Cabe destacar que usted atravesó ${diasILT} de incapacidad laboral temporaria. Es importante que sepa que, una vez cerrado el expediente ante la aseguradora, los plazos para reclamar una justa indemnización son limitados. Por eso, es conveniente revisar con tiempo si la incapacidad reconocida refleja realmente el daño que usted sufrió.

Si lo desea, puede contactarme para coordinar una reunión o llamada, sin ningún compromiso de su parte.

Quedo a su disposición.

Saludos cordiales,

Capeletti Abogados`;

    return `mailto:ema-ber2011@live.com.ar?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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

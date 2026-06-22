import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule, registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

registerLocaleData(localeEs);
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirestoreService } from '../../services/firestore.service';
import { Expediente, EtapaExpediente } from './expediente.model';
import { EXPEDIENTES_SEED } from '../../services/expedientes.seed';

interface ExpArca {
  docId: string;
  nroExpediente: string;
  tipoTramite: string;
  delegacion: string;
  cuil: string;
  apellidoNombre: string;
  fechaNacimiento: string;
  sexo: string;
  fechaAccidente: string;
  tipoAccidente: string;
  artCodigo: string;
  artNombre: string;
  cuitEmpleador: string;
  empleador: string;
  provincia: string;
  localidad: string;
  patroCuil: string;
  patroNombre: string;
  patroMatricula: string;
}

interface CalEvento {
  id: string;
  titulo: string;
  fecha: string;
  hora: string;
  tipo: string;
  expedienteNro: string;
  descripcion?: string;
}

@Component({
  selector: 'app-dashboard-abogado',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard-abogado.html',
  styleUrl: './dashboard-abogado.css',
})
export class DashboardAbogado implements OnInit {
  nombreUsuario = '';
  email = '';
  busqueda = '';
  mostrarModalNuevo = false;
  nuevoExpCuil = '';
  nuevoExpNro = '';

  seccion: 'dashboard' | 'expedientes' | 'calculadoras' | 'escritos' | 'facturacion' | 'agenda' | 'configuracion' = 'expedientes';

  readonly NAV = [
    { key: 'dashboard',     label: 'Dashboard'     },
    { key: 'expedientes',   label: 'Expedientes'   },
    { key: 'calculadoras',  label: 'Calculadoras'  },
    { key: 'escritos',      label: 'Escritos'      },
    { key: 'facturacion',   label: 'Facturación'   },
    { key: 'agenda',        label: 'Agenda'        },
    { key: 'configuracion', label: 'Configuración' },
  ] as const;

  readonly ETAPAS: EtapaExpediente[] = ['Judicial', 'Prejudicial', 'Homologación', 'Cerrado'];

  private readonly SEED = EXPEDIENTES_SEED;

  expedientes: Expediente[] = [];

  get totalJudiciales(): number { return this.expedientes.filter(e => e.etapa === 'Judicial').length; }
  get totalConPagare(): number  { return this.expedientes.filter(e => e.pagare).length; }
  get totalSinCertFirmas(): number { return this.expedientes.filter(e => !e.certFirmas).length; }

  get expedientesFiltrados(): Expediente[] {
    const q = this.busqueda.trim().toLowerCase();
    if (!q) return this.expedientes;
    return this.expedientes.filter(e =>
      e.cuil.includes(q) ||
      e.nombre.toLowerCase().includes(q) ||
      e.nroExpediente.toLowerCase().includes(q) ||
      e.llamador.toLowerCase().includes(q) ||
      e.art.toLowerCase().includes(q) ||
      e.localidad.toLowerCase().includes(q)
    );
  }

  // ── ARCA ────────────────────────────────────────────────────
  fuenteExpedientes: 'sisfe' | 'arca' = 'sisfe';
  arcaExpedientes: ExpArca[] = [];
  arcaBusqueda = '';
  arcaCargando = false;
  arcaCargado  = false;

  get arcaFiltrados(): ExpArca[] {
    const q = this.arcaBusqueda.trim().toLowerCase();
    if (!q) return this.arcaExpedientes;
    return this.arcaExpedientes.filter(e =>
      (e.cuil ?? '').includes(q) ||
      (e.apellidoNombre ?? '').toLowerCase().includes(q) ||
      (e.nroExpediente ?? '').toLowerCase().includes(q) ||
      (e.artNombre ?? '').toLowerCase().includes(q) ||
      (e.empleador ?? '').toLowerCase().includes(q) ||
      (e.localidad ?? '').toLowerCase().includes(q) ||
      (e.tipoTramite ?? '').toLowerCase().includes(q)
    );
  }

  async seleccionarFuente(fuente: 'sisfe' | 'arca') {
    this.fuenteExpedientes = fuente;
    if (fuente === 'arca' && !this.arcaCargado) {
      this.arcaCargando = true;
      try {
        const raw = await this.fs.getExpedientesArca();
        this.arcaExpedientes = raw as unknown as ExpArca[];
        this.arcaCargado = true;
      } finally {
        this.arcaCargando = false;
        this.cdr.detectChanges();
      }
    }
  }

  // ── Agenda / Calendario ─────────────────────────────────────────
  readonly CAL_MESES   = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  readonly CAL_DIAS    = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

  calMes  = new Date().getMonth();
  calAnio = new Date().getFullYear();
  calDiaSeleccionado: string | null = null;
  mostrarModalEvento = false;
  nuevoEvento: { titulo: string; fecha: string; hora: string; tipo: string; expedienteNro: string; descripcion: string } = {
    titulo: '', fecha: '', hora: '', tipo: 'audiencia', expedienteNro: '', descripcion: '',
  };

  calEventos: CalEvento[] = [];

  private toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  get calNombreMes(): string { return `${this.CAL_MESES[this.calMes]} ${this.calAnio}`; }

  get calCeldas(): { fecha: string; dia: number; esActual: boolean; esHoy: boolean; eventos: CalEvento[] }[] {
    const primerDia  = new Date(this.calAnio, this.calMes, 1);
    const ultimoDia  = new Date(this.calAnio, this.calMes + 1, 0);
    const hoyStr     = this.toDateStr(new Date());
    let offset       = primerDia.getDay() - 1; // lun=0
    if (offset < 0) offset = 6;

    const celdas: any[] = [];
    for (let i = offset; i > 0; i--) {
      const d = new Date(this.calAnio, this.calMes, 1 - i);
      const f = this.toDateStr(d);
      celdas.push({ fecha: f, dia: d.getDate(), esActual: false, esHoy: false, eventos: this.calEventos.filter(e => e.fecha === f) });
    }
    for (let d = 1; d <= ultimoDia.getDate(); d++) {
      const date = new Date(this.calAnio, this.calMes, d);
      const f    = this.toDateStr(date);
      celdas.push({ fecha: f, dia: d, esActual: true, esHoy: f === hoyStr, eventos: this.calEventos.filter(e => e.fecha === f) });
    }
    const resto = 42 - celdas.length;
    for (let i = 1; i <= resto; i++) {
      const d = new Date(this.calAnio, this.calMes + 1, i);
      const f = this.toDateStr(d);
      celdas.push({ fecha: f, dia: d.getDate(), esActual: false, esHoy: false, eventos: this.calEventos.filter(e => e.fecha === f) });
    }
    return celdas;
  }

  get calEventosDia(): CalEvento[] {
    if (!this.calDiaSeleccionado) return [];
    return this.calEventos.filter(e => e.fecha === this.calDiaSeleccionado);
  }

  get calProxEventos(): CalEvento[] {
    const hoy = this.toDateStr(new Date());
    return [...this.calEventos]
      .filter(e => e.fecha >= hoy)
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
      .slice(0, 5);
  }

  irMesPrev() { if (this.calMes === 0) { this.calMes = 11; this.calAnio--; } else this.calMes--; }
  irMesSig()  { if (this.calMes === 11) { this.calMes = 0;  this.calAnio++; } else this.calMes++; }
  irHoy()     { this.calMes = new Date().getMonth(); this.calAnio = new Date().getFullYear(); this.calDiaSeleccionado = this.toDateStr(new Date()); }

  abrirModalEvento(fecha?: string) {
    this.nuevoEvento = { titulo: '', fecha: fecha ?? this.calDiaSeleccionado ?? '', hora: '', tipo: 'audiencia', expedienteNro: '', descripcion: '' };
    this.mostrarModalEvento = true;
  }

  async agregarEvento() {
    if (!this.nuevoEvento.titulo || !this.nuevoEvento.fecha) return;
    const id = await this.fs.agregarCalEvento(this.email, this.nuevoEvento);
    this.calEventos = [...this.calEventos, { ...this.nuevoEvento, id }];
    this.mostrarModalEvento = false;
    this.cdr.detectChanges();
  }

  async eliminarEvento(id: string) {
    await this.fs.eliminarCalEvento(id);
    this.calEventos = this.calEventos.filter(e => e.id !== id);
    this.cdr.detectChanges();
  }

  tipoColor(tipo: string): string {
    return ({ audiencia: 'bg-rose-500', vencimiento: 'bg-amber-500', cita: 'bg-blue-500', otro: 'bg-gray-400' } as any)[tipo] ?? 'bg-gray-400';
  }
  tipoLabel(tipo: string): string {
    return ({ audiencia: 'Audiencia', vencimiento: 'Vencimiento', cita: 'Cita', otro: 'Otro' } as any)[tipo] ?? tipo;
  }
  tipoTextColor(tipo: string): string {
    return ({ audiencia: 'text-rose-600 bg-rose-50', vencimiento: 'text-amber-600 bg-amber-50', cita: 'text-blue-600 bg-blue-50', otro: 'text-gray-600 bg-gray-100' } as any)[tipo] ?? 'text-gray-600 bg-gray-100';
  }

  // ── Calculadora ──────────────────────────────────────────────────
  readonly RIPTE_VALORES = [
    { label: 'Marzo 2026 — $202.963,20',      valor: 202963.20 },
    { label: 'Febrero 2026 — $195.148,50',    valor: 195148.50 },
    { label: 'Enero 2026 — $188.321,40',      valor: 188321.40 },
    { label: 'Diciembre 2025 — $181.270,10',  valor: 181270.10 },
    { label: 'Noviembre 2025 — $175.860,30',  valor: 175860.30 },
    { label: 'Octubre 2025 — $168.420,80',    valor: 168420.80 },
    { label: 'Septiembre 2025 — $163.154,60', valor: 163154.60 },
    { label: 'Agosto 2025 — $157.820,30',     valor: 157820.30 },
  ];

  calcLey: 'ley24577' | 'ley27348' | 'dnu669' = 'ley27348';
  calcFechaAccidente = '';
  calcEdad: number | null = null;
  calcFechaHasta = '';
  calcRipte = 202963.20;
  calcIbmTipo: 'mensual' | 'quincenal' | 'semanal' = 'mensual';
  calcIncapacidad: number | null = null;
  calcAdicional20 = true;
  calcMuerte = false;
  calcCapu = false;
  calcIncluirAdicional20Capu = false;
  calcCaratula = '';
  calcRems: (number | null)[] = Array(12).fill(null);
  calcDnuDesde = '';
  calcDnuHasta = '';
  calcTasaInteres: number | null = null;
  calcResultado: {
    ibm: number; ibmEfectivo: number; t: number;
    base: number; adicional20: number; capu: number;
    total: number; conIntereses: number;
  } | null = null;

  get calcIbm(): number {
    const rems = this.calcRems.filter(r => r !== null && (r as number) > 0) as number[];
    if (!rems.length) return 0;
    const avg = rems.reduce((a, b) => a + b, 0) / rems.length;
    if (this.calcIbmTipo === 'quincenal') return avg * 2;
    if (this.calcIbmTipo === 'semanal')   return avg * (52 / 12);
    return avg;
  }

  calcular() {
    const edad = this.calcEdad ?? 0;
    const t    = this.calcMuerte ? 0.65 : (this.calcIncapacidad ?? 0) / 100;
    const ibm  = this.calcIbm;

    // Ley 27.348 / DNU 669: IBM no puede ser menor al RIPTE vigente
    const ibmEfectivo =
      (this.calcLey === 'ley27348' || this.calcLey === 'dnu669')
        ? Math.max(ibm, this.calcRipte)
        : ibm;

    // Fórmula base: 53 × IBM × t × (65 − edad) / 65
    const base = 53 * ibmEfectivo * t * (65 - edad) / 65;

    // Art. 3 Ley 26.773: +20% cuando el daño ocurrió en lugar de trabajo
    const adicional20 = this.calcAdicional20 ? base * 0.20 : 0;

    // CAPU Art. 11: piso mínimo = 55 × RIPTE × t
    // Si base < piso, se abona la diferencia. Opcional +20% sobre el piso.
    let capu = 0;
    if (this.calcCapu) {
      const pisoCapu = 55 * this.calcRipte * t;
      const diferencia = Math.max(0, pisoCapu - base);
      capu = diferencia + (this.calcIncluirAdicional20Capu ? pisoCapu * 0.20 : 0);
    }

    const total = base + adicional20 + capu;

    // DNU 669/19: intereses simples desde accidente hasta fecha de pago
    let conIntereses = total;
    if (this.calcLey === 'dnu669' && this.calcTasaInteres && this.calcFechaAccidente && this.calcFechaHasta) {
      const dias = Math.max(0,
        (new Date(this.calcFechaHasta).getTime() - new Date(this.calcFechaAccidente).getTime())
        / (1000 * 60 * 60 * 24));
      conIntereses = total * (1 + (this.calcTasaInteres / 100) * dias / 365);
    }

    this.calcResultado = { ibm, ibmEfectivo, t, base, adicional20, capu, total, conIntereses };
  }

  limpiarCalc() {
    this.calcFechaAccidente = '';
    this.calcEdad           = null;
    this.calcFechaHasta     = '';
    this.calcRipte          = 202963.20;
    this.calcIbmTipo        = 'mensual';
    this.calcIncapacidad    = null;
    this.calcAdicional20    = true;
    this.calcMuerte         = false;
    this.calcCapu           = false;
    this.calcIncluirAdicional20Capu = false;
    this.calcCaratula       = '';
    this.calcRems           = Array(12).fill(null);
    this.calcDnuDesde       = '';
    this.calcDnuHasta       = '';
    this.calcTasaInteres    = null;
    this.calcResultado      = null;
  }

  formatPeso(n: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: 'ARS', maximumFractionDigits: 2,
    }).format(n);
  }

  constructor(
    private auth: AuthService,
    private fs: FirestoreService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
  ) {}

  volver() { this.router.navigate(['/modulos']); }

  async ngOnInit() {
    // Si viene con ?seccion=X desde el selector de módulos, ir directo a esa sección
    const seccionParam = this.route.snapshot.queryParams['seccion'];
    if (seccionParam) this.seccion = seccionParam as any;

    this.email = this.auth.getCurrentEmail();
    const [apodo, eventos, fromFirestore] = await Promise.all([
      this.fs.getApodoPorEmail(this.email),
      this.fs.getCalEventos(this.email),
      this.fs.getExpedientesAbogado(),
    ]);
    this.nombreUsuario = apodo;
    this.calEventos = eventos;

    this.expedientes = fromFirestore; // getExpedientesAbogado auto-seedea si está vacío
    this.cdr.detectChanges();
  }

  async toggleCheck(exp: Expediente, campo: keyof Expediente) {
    (exp as any)[campo] = !(exp as any)[campo];
    if (exp.id) {
      await this.fs.actualizarExpedienteAbogado(exp.id, { [campo]: (exp as any)[campo] });
    }
  }

  async cerrarSesion() {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }
}

import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule, registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirestoreService } from '../../services/firestore.service';
import { StorageService } from '../../services/storage.service';
import { CasoModel } from '../dashboard-llamador/caso.model';
import { Expediente } from '../dashboard-abogado/expediente.model';
import { ETAPAS_ARCA } from '../dashboard-arca/dashboard-arca';
import { CalculadoraArt } from '../shared/calculadora-art/calculadora-art';

registerLocaleData(localeEs);

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
  selector: 'app-dashboard-josefina',
  standalone: true,
  imports: [CommonModule, FormsModule, CalculadoraArt],
  templateUrl: './dashboard-josefina.html',
})
export class DashboardJosefina implements OnInit {
  seccion: 'casos' | 'expedientes' | 'calculadoras' | 'agenda' | 'llamadoras' | 'cargar' = 'casos';
  readonly ETAPAS_ARCA = ETAPAS_ARCA;

  // ── Casos ─────────────────────────────────────────────────────────────────
  casos: CasoModel[] = [];
  cargando = true;
  busqueda = '';

  // ── Expedientes ───────────────────────────────────────────────────────────
  expedientes: Expediente[] = [];
  busquedaExp = '';

  get expedientesFiltrados(): Expediente[] {
    const q = this.busquedaExp.trim().toLowerCase();
    if (!q) return this.expedientes;
    return this.expedientes.filter(e =>
      e.nombre.toLowerCase().includes(q) ||
      e.cuil.includes(q) ||
      e.nroExpediente.toLowerCase().includes(q) ||
      e.art.toLowerCase().includes(q) ||
      (e.llamador ?? '').toLowerCase().includes(q)
    );
  }

  etapaArcaLabel(etapa: string | undefined): string {
    return this.ETAPAS_ARCA.find(e => e.key === (etapa ?? 'iniciados'))?.label ?? 'Iniciados';
  }
  etapaArcaPill(etapa: string | undefined): string {
    return this.ETAPAS_ARCA.find(e => e.key === (etapa ?? 'iniciados'))?.pill ?? 'bg-blue-100 text-blue-700';
  }

  modalCaso: CasoModel | null = null;
  expedienteInput = '';
  expedienteError = '';
  guardando = false;

  // ── Agenda / Calendario ────────────────────────────────────────────────────
  readonly CAL_MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  readonly CAL_DIAS  = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

  calMes  = new Date().getMonth();
  calAnio = new Date().getFullYear();
  calDiaSeleccionado: string | null = null;
  mostrarModalEvento = false;
  nuevoEvento: { titulo: string; fecha: string; hora: string; tipo: string; expedienteNro: string; descripcion: string } = {
    titulo: '', fecha: '', hora: '', tipo: 'audiencia', expedienteNro: '', descripcion: '',
  };

  calEventos: CalEvento[] = [];

  // ── Cargar Caso ────────────────────────────────────────────────────────────
  nuevoCaso = {
    tipo: 'accidente' as 'accidente' | 'enfermedad',
    trabajador: '', cuil: '', art: '', empresa: '',
    tipoAccidente: '', localidad: '', provincia: '',
    fechaAccidente: '', diasIlt: '', diagnostico: '',
    descripcion: '',
  };
  ncAnexo: File | null = null;
  ncDni: File | null = null;
  ncAlta: File | null = null;
  ncSecuelas: File[] = [];
  ncSubiendo = false;
  ncProgreso = 0;
  ncError = '';
  ncExito = '';

  resetNuevoCaso() {
    this.nuevoCaso = {
      tipo: 'accidente', trabajador: '', cuil: '', art: '', empresa: '',
      tipoAccidente: '', localidad: '', provincia: '',
      fechaAccidente: '', diasIlt: '', diagnostico: '', descripcion: '',
    };
    this.ncAnexo = null; this.ncDni = null; this.ncAlta = null;
    this.ncSecuelas = []; this.ncError = ''; this.ncExito = '';
    this.ncSubiendo = false; this.ncProgreso = 0;
  }

  onNcFile(event: Event, campo: 'anexo' | 'dni' | 'alta') {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    if (campo === 'anexo') this.ncAnexo = file;
    if (campo === 'dni') this.ncDni = file;
    if (campo === 'alta') this.ncAlta = file;
  }

  onNcSecuelas(event: Event) {
    const files = (event.target as HTMLInputElement).files;
    if (files) this.ncSecuelas = [...this.ncSecuelas, ...Array.from(files)];
  }

  quitarSecuela(i: number) { this.ncSecuelas = this.ncSecuelas.filter((_, idx) => idx !== i); }

  async guardarNuevoCaso() {
    const nc = this.nuevoCaso;
    if (!nc.trabajador.trim()) { this.ncError = 'El nombre del trabajador es obligatorio.'; return; }
    if (!nc.cuil.trim()) { this.ncError = 'El CUIL es obligatorio.'; return; }

    this.ncSubiendo = true;
    this.ncError = '';
    this.ncExito = '';
    this.ncProgreso = 0;
    this.cdr.detectChanges();

    try {
      const casoId = await this.fs.crearCasoManual({
        Trabajador: nc.trabajador.trim(),
        CUIL: nc.cuil.replace(/\D/g, ''),
        ART: nc.art.trim(),
        Emp_Denominacion: nc.empresa.trim(),
        Tipo_Accidente: nc.tipo === 'enfermedad' ? 'Enfermedad Profesional' : (nc.tipoAccidente.trim() || 'Accidente Laboral'),
        Localidad_Ocurrencia: nc.localidad.trim(),
        Provincia_Ocurrencia: nc.provincia.trim(),
        Fecha_Accidente: nc.fechaAccidente,
        Dias_ILT: nc.diasIlt,
        Diag_1: nc.diagnostico.trim(),
        Descripcion_Siniestro: nc.descripcion.trim(),
        ASGINADO: 'josefina',
        procesadoPor: this.auth.getCurrentEmail(),
      });

      if (this.ncAnexo || this.ncDni) {
        const docs = await this.storage.subirDocumentacion(
          casoId,
          {
            anexo: this.ncAnexo!,
            dni: this.ncDni!,
            ...(this.ncAlta ? { altaMedica: this.ncAlta } : {}),
            ...(this.ncSecuelas.length > 0 ? { secuela: this.ncSecuelas } : {}),
          },
          'josefina',
          pct => { this.ncProgreso = pct; this.cdr.detectChanges(); }
        );
        await this.fs.guardarDocumentacionCaso(casoId, docs);
      }

      this.ncExito = `Caso de ${nc.trabajador} cargado correctamente.`;
      this.resetNuevoCaso();
      this.ncExito = `Caso cargado correctamente.`;
      const casos = await this.fs.getCasosParaJosefina();
      this.casos = casos;
    } catch (e: any) {
      this.ncError = 'Error: ' + (e.message ?? 'Intentá de nuevo.');
    } finally {
      this.ncSubiendo = false;
      this.cdr.detectChanges();
    }
  }

  constructor(
    private fs: FirestoreService,
    private storage: StorageService,
    private auth: AuthService,
    public router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit() {
    try {
      const email = this.auth.getCurrentEmail();

      // Cargar casos y agenda juntos; expedientes por separado para no bloquear si falla
      const [casos, eventosGuardados] = await Promise.all([
        this.fs.getCasosParaJosefina(),
        this.fs.getCalEventos(email),
      ]);
      this.casos = casos;

      // Auto-generar eventos desde proximaAccion de cada caso
      const autoEventos: CalEvento[] = casos
        .filter(c => c.proximaAccion?.fecha)
        .map(c => ({
          id: `auto-${c.id}`,
          titulo: `${c.proximaAccion!.tipo || 'Seguimiento'}: ${c.Trabajador || c.CUIL || '—'}`,
          fecha: c.proximaAccion!.fecha,
          hora: c.proximaAccion!.hora ?? '',
          tipo: 'cita',
          expedienteNro: c.nroExpediente ?? '',
        }));

      const idsGuardados = new Set(eventosGuardados.map(e => e.id));
      this.calEventos = [
        ...autoEventos.filter(e => !idsGuardados.has(e.id)),
        ...eventosGuardados,
      ];
    } finally {
      this.cargando = false;
      this.cdr.detectChanges();
    }

    // Cargar expedientes independientemente (incluye auto-seed si Firestore vacío)
    try {
      this.expedientes = await this.fs.getExpedientesAbogado();
      this.cdr.detectChanges();
    } catch { /* no bloquear si falla */ }
  }

  // ── Casos ──────────────────────────────────────────────────────────────────

  get casosFiltrados(): CasoModel[] {
    const q = this.busqueda.trim().toLowerCase();
    if (!q) return this.casos;
    return this.casos.filter(c =>
      c.Trabajador?.toLowerCase().includes(q) ||
      c.CUIL?.includes(q) ||
      c.ART?.toLowerCase().includes(q) ||
      c.ASGINADO?.toLowerCase().includes(q) ||
      c.Localidad_Ocurrencia?.toLowerCase().includes(q)
    );
  }

  get pendientes(): number { return this.casos.filter(c => !c.nroExpediente).length; }
  get iniciados():  number { return this.casos.filter(c =>  c.nroExpediente).length; }

  telefonoDe(caso: CasoModel): string {
    if (caso.telefonoContacto) return caso.telefonoContacto;
    const celulares = caso.certeroData?.['celulares'];
    if (Array.isArray(celulares) && celulares[0]?.numCompleto) return celulares[0].numCompleto;
    return '';
  }

  abrirModal(caso: CasoModel) {
    this.modalCaso = caso;
    this.expedienteInput = caso.nroExpediente ?? '';
    this.expedienteError = '';
  }

  cerrarModal() {
    this.modalCaso = null;
    this.expedienteInput = '';
    this.expedienteError = '';
  }

  async guardarExpediente() {
    if (!this.expedienteInput.trim()) {
      this.expedienteError = 'El número de expediente es obligatorio.';
      return;
    }
    if (!this.modalCaso?.id) return;
    this.guardando = true;
    try {
      await this.fs.guardarExpediente(this.modalCaso.id, this.expedienteInput.trim(), this.modalCaso);
      const idx = this.casos.findIndex(c => c.id === this.modalCaso!.id);
      if (idx >= 0) this.casos[idx] = { ...this.casos[idx], nroExpediente: this.expedienteInput.trim() };
      this.cerrarModal();
      this.cdr.detectChanges();
    } catch (e: any) {
      this.expedienteError = 'Error al guardar: ' + e.message;
    } finally {
      this.guardando = false;
    }
  }

  // ── Calendario ─────────────────────────────────────────────────────────────

  private toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  get calNombreMes(): string { return `${this.CAL_MESES[this.calMes]} ${this.calAnio}`; }

  get calCeldas(): { fecha: string; dia: number; esActual: boolean; esHoy: boolean; eventos: CalEvento[] }[] {
    const primerDia = new Date(this.calAnio, this.calMes, 1);
    const ultimoDia = new Date(this.calAnio, this.calMes + 1, 0);
    const hoyStr    = this.toDateStr(new Date());
    let offset      = primerDia.getDay() - 1;
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

  abrirModalEventoParaExp(exp: Expediente) {
    this.nuevoEvento = {
      titulo: exp.nombre,
      fecha: this.calDiaSeleccionado ?? '',
      hora: '',
      tipo: 'audiencia',
      expedienteNro: exp.nroExpediente,
      descripcion: exp.art ? `ART: ${exp.art}` : '',
    };
    this.mostrarModalEvento = true;
  }

  async agregarEvento() {
    if (!this.nuevoEvento.titulo || !this.nuevoEvento.fecha) return;
    const email = this.auth.getCurrentEmail();
    const id = await this.fs.agregarCalEvento(email, this.nuevoEvento);
    this.calEventos = [...this.calEventos, { ...this.nuevoEvento, id }];
    this.mostrarModalEvento = false;
    this.cdr.detectChanges();
  }

  async eliminarEvento(id: string) {
    if (!id.startsWith('auto-')) {
      await this.fs.eliminarCalEvento(id);
    }
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

  // ── No Va ──────────────────────────────────────────────────────────────────
  confirmNoVa: string | null = null;
  marcandoNoVa: Record<string, boolean> = {};

  async marcarNoVa(caso: CasoModel): Promise<void> {
    if (!caso.id) return;
    this.marcandoNoVa[caso.id] = true;
    this.cdr.detectChanges();
    try {
      await this.fs.marcarCasoNoVa(caso.id);
      this.casos = this.casos.filter(c => c.id !== caso.id);
      this.confirmNoVa = null;
    } finally {
      delete this.marcandoNoVa[caso.id!];
      this.cdr.detectChanges();
    }
  }

  // ── Llamadoras Propias ──────────────────────────────────────────────────────

  readonly LLAMADORAS_PROPIAS = [
    { label: 'Nanci',     apodo: 'nanci',     email: '' },
    { label: 'CR',        apodo: 'cami',      email: 'cr4361990@gmail.com' },
    { label: 'Daiana',    apodo: 'daiana',     email: 'daianadagostino18@gmail.com' },
    { label: 'Iara',      apodo: 'iara',       email: '' },
    { label: 'Antoo',     apodo: 'ANTOO',      email: 'antofontana1960@gmail.com' },
    { label: 'Georgina',  apodo: 'GEORGINA',   email: 'georginachitarroni30@hotmail.com' },
    { label: 'Merce',     apodo: 'merce',      email: 'mercedesfretes7@gmail.com' },
    { label: 'Ana',       apodo: 'ana',        email: 'anamorelli21@gmail.com' },
    { label: 'Florencia', apodo: 'FLORENCIA',  email: 'pistochinif@gmail.com' },
    { label: 'Jorgelina', apodo: 'JORGELINA',  email: 'kuki.8.jr@gmail.com' },
  ];
  readonly PAGO_POR_ACEPTO = 40_000;
  semanaOffset = 0;

  historialLlamadoras: CasoModel[] = [];
  cargandoLlamadoras = false;

  get semanaInfo(): { inicio: Date; fin: Date; dias: Date[] } {
    const hoy = new Date();
    const dow = hoy.getDay();
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

  get esSemanaActual(): boolean { return this.semanaOffset === 0; }

  private matchLlamadora(c: CasoModel, ll: { apodo: string; email: string }): boolean {
    const em = (c.procesadoPor || '').toLowerCase();
    const ap = (c.ASGINADO || '').toLowerCase();
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
      const casosAcepto = this.historialLlamadoras.filter(c => {
        if (c.estado !== 'acepto') return false;
        if (!this.matchLlamadora(c, ll)) return false;
        const ts = this.tsToMs(c.procesadoTimestamp);
        return ts >= t0 && ts <= t1;
      });
      const casosNoVa = this.historialLlamadoras.filter(c => {
        if (c.estado !== 'nova') return false;
        if (!this.matchLlamadora(c, ll)) return false;
        const ts = this.tsToMs(c.novaTimestamp ?? c.procesadoTimestamp);
        return ts >= t0 && ts <= t1;
      });
      const porDia: Record<string, number> = {};
      const nombresPorDia: Record<string, string[]> = {};
      dias.forEach(d => { const k = d.toISOString().slice(0, 10); porDia[k] = 0; nombresPorDia[k] = []; });
      casosAcepto.forEach(c => {
        const ms = this.tsToMs(c.procesadoTimestamp);
        if (ms) {
          const k = new Date(ms).toISOString().slice(0, 10);
          if (k in porDia) { porDia[k]++; nombresPorDia[k].push(c.Trabajador ?? c.CUIL ?? '—'); }
        }
      });
      const netos = casosAcepto.length - casosNoVa.length;
      return {
        label: ll.label,
        aceptos: casosAcepto.length,
        noVa: casosNoVa.length,
        netos: Math.max(0, netos),
        totalPagar: Math.max(0, netos) * this.PAGO_POR_ACEPTO,
        porDia, nombresPorDia,
        casos: casosAcepto,
        casosNoVa,
      };
    });
  }

  get resumenCasosSemana(): Array<{ llamadora: string; trabajador: string; cuil: string; art: string; diasIlt: string; fecha: string; noVa: boolean }> {
    const rows: Array<{ llamadora: string; trabajador: string; cuil: string; art: string; diasIlt: string; fecha: string; noVa: boolean }> = [];
    for (const ll of this.statsLlamadoras) {
      for (const c of ll.casos) {
        const ms = this.tsToMs(c.procesadoTimestamp);
        const fecha = ms ? new Date(ms).toLocaleDateString('es-AR') : '—';
        rows.push({ llamadora: ll.label, trabajador: c.Trabajador ?? '—', cuil: c.CUIL ?? '—', art: c.ART ?? '—', diasIlt: c.Dias_ILT ?? '—', fecha, noVa: false });
      }
      for (const c of ll.casosNoVa) {
        const ms = this.tsToMs(c.novaTimestamp ?? c.procesadoTimestamp);
        const fecha = ms ? new Date(ms).toLocaleDateString('es-AR') : '—';
        rows.push({ llamadora: ll.label, trabajador: c.Trabajador ?? '—', cuil: c.CUIL ?? '—', art: c.ART ?? '—', diasIlt: c.Dias_ILT ?? '—', fecha, noVa: true });
      }
    }
    return rows;
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

  async cargarLlamadoras() {
    if (this.historialLlamadoras.length > 0) return;
    this.cargandoLlamadoras = true;
    try {
      this.historialLlamadoras = await this.fs.getHistorialCompleto();
    } finally {
      this.cargandoLlamadoras = false;
      this.cdr.detectChanges();
    }
  }

  exportarExcelSemana(): void {
    import('xlsx').then(XLSX => {
      const filas = this.resumenCasosSemana.map(r => ({
        Llamadora: r.llamadora, Trabajador: r.trabajador, CUIL: r.cuil, ART: r.art,
        'Días ILT': r.diasIlt, 'Fecha Acepto': r.fecha, Pago: this.PAGO_POR_ACEPTO,
      }));
      filas.push({ Llamadora: 'TOTAL', Trabajador: '', CUIL: '', ART: '', 'Días ILT': '', 'Fecha Acepto': '', Pago: filas.reduce((s, r) => s + (r as any).Pago, 0) } as any);
      const ws = XLSX.utils.json_to_sheet(filas);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Resumen Semana');
      XLSX.writeFile(wb, `Llamadoras_${this.semanaLabel.replace(/\s/g, '_')}.xlsx`);
    });
  }

  // ── General ────────────────────────────────────────────────────────────────

  async cerrarSesion() {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }
}

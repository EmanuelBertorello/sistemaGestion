import { Component, OnInit, ChangeDetectorRef, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { FirestoreService } from '../../services/firestore.service';
import { NvidiaIaService } from '../../services/nvidia-ia.service';
import { EtapaArca, Expediente } from '../dashboard-abogado/expediente.model';

export const ETAPAS_ARCA: Array<{ key: EtapaArca; label: string; bg: string; text: string; border: string; bar: string; pill: string }> = [
  { key: 'iniciados',         label: 'Iniciados',      bg: 'bg-blue-50',    text: 'text-blue-700',   border: 'border-blue-200',   bar: '#3b82f6', pill: 'bg-blue-100 text-blue-700' },
  { key: 'documentacion_art', label: 'Doc. ART',        bg: 'bg-orange-50',  text: 'text-orange-700', border: 'border-orange-200', bar: '#f97316', pill: 'bg-orange-100 text-orange-700' },
  { key: 'citacion',          label: 'Citación',        bg: 'bg-amber-50',   text: 'text-amber-700',  border: 'border-amber-200',  bar: '#f59e0b', pill: 'bg-amber-100 text-amber-700' },
  { key: 'dictamen',          label: 'Dictamen',        bg: 'bg-purple-50',  text: 'text-purple-700', border: 'border-purple-200', bar: '#a855f7', pill: 'bg-purple-100 text-purple-700' },
  { key: 'homologacion',      label: 'Homologación',    bg: 'bg-emerald-50', text: 'text-emerald-700',border: 'border-emerald-200',bar: '#10b981', pill: 'bg-emerald-100 text-emerald-700' },
  { key: 'apelacion',         label: 'Apelación',       bg: 'bg-rose-50',    text: 'text-rose-700',   border: 'border-rose-200',   bar: '#f43f5e', pill: 'bg-rose-100 text-rose-700' },
  { key: 'cierre_xpete',      label: 'Cierre Xpete',   bg: 'bg-teal-50',    text: 'text-teal-700',   border: 'border-teal-200',   bar: '#14b8a6', pill: 'bg-teal-100 text-teal-700' },
  { key: 'demanda',           label: 'Demanda',         bg: 'bg-gray-100',   text: 'text-gray-700',   border: 'border-gray-300',   bar: '#6b7280', pill: 'bg-gray-200 text-gray-600' },
];

@Component({
  selector: 'app-dashboard-arca',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './dashboard-arca.html',
  styleUrls: ['./dashboard-arca.css'],
})
export class DashboardArca implements OnInit {
  modulo: 'srt' | 'sisfe' = 'srt';
  titulo = 'SRT';
  expedientes: Expediente[] = [];
  cargando = true;

  readonly ETAPAS = ETAPAS_ARCA;

  // ── Modal crear/editar ────────────────────────────────────────────────────
  mostrarModal = false;
  modalEtapa: EtapaArca = 'iniciados';
  modalNombre = '';
  modalNroExpediente = '';
  modalCuil = '';
  modalArt = '';
  modalNotas = '';
  modalGuardando = false;
  modalError = '';
  editandoId: string | null = null;
  confirmEliminarId: string | null = null;

  // ── Vista detalle (estilo Odoo) ───────────────────────────────────────────
  mostrarDetalle = false;
  detalleExp: Expediente = {} as Expediente;
  detalleGuardando = false;
  detalleError = '';

  readonly CHECKS: Array<{ campo: keyof Expediente; label: string }> = [
    { campo: 'certificadoMed', label: 'Cert. Médica'    },
    { campo: 'informeMed',     label: 'Inf. Médico'     },
    { campo: 'certFirmas',     label: 'Cert. de Firmas' },
    { campo: 'ratificacion',   label: 'Ratificación'    },
    { campo: 'pagare',         label: 'Pagaré'          },
    { campo: 'boleta',         label: 'Boleta'          },
  ];

  get detalleEtapa() {
    return ETAPAS_ARCA.find(e => e.key === (this.detalleExp.etapaArca ?? 'iniciados'))!;
  }

  // ── Drag & drop ───────────────────────────────────────────────────────────
  draggingId: string | null = null;
  dragOverEtapa: EtapaArca | null = null;
  dragOverSisfe = false;

  // ── Análisis IA ───────────────────────────────────────────────────────────
  iaAnalizando = false;
  iaTexto      = '';   // respuesta en streaming
  iaError      = '';

  // ── Pasar a módulo contrario ──────────────────────────────────────────────
  confirmPasarModuloId: string | null = null;

  get moduloDestino(): 'srt' | 'sisfe' { return this.modulo === 'srt' ? 'sisfe' : 'srt'; }
  get tituloDestino(): string           { return this.modulo === 'srt' ? 'SISFE' : 'SRT'; }

  constructor(
    private auth: AuthService,
    private fs: FirestoreService,
    private ia: NvidiaIaService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) { this.cargando = false; return; }
    const data = this.route.snapshot.data;
    this.modulo = data['modulo'] ?? 'srt';
    this.titulo = data['titulo'] ?? 'SRT';
    await this.cargar();
  }

  async cargar() {
    this.cargando = true;
    this.cdr.detectChanges();
    try {
      const all = await this.fs.getExpedientesAbogado();
      // Mostrar solo los expedientes del módulo actual (undefined default = srt)
      this.expedientes = all.filter(e => (e.modulo ?? 'srt') === this.modulo);
    } finally {
      this.cargando = false;
      this.cdr.detectChanges();
    }
  }

  columna(etapa: EtapaArca): Expediente[] {
    return this.expedientes.filter(e => (e.etapaArca ?? 'iniciados') === etapa);
  }

  etapaIdx(etapa: EtapaArca | undefined): number {
    return ETAPAS_ARCA.findIndex(e => e.key === (etapa ?? 'iniciados'));
  }

  /** Días transcurridos desde fechaIngreso (formato DD/MM/YYYY). -1 si no se puede parsear. */
  private _diasDesde(fecha: string): number {
    const p = fecha.split('/');
    if (p.length !== 3) return -1;
    const d = new Date(+p[2], +p[1] - 1, +p[0]);
    if (isNaN(d.getTime())) return -1;
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    return Math.floor((hoy.getTime() - d.getTime()) / 86_400_000);
  }

  /** Card roja con shake: etapa iniciados/doc_art Y día 61+ desde el acepto */
  esProntoUrgente(exp: Expediente): boolean {
    const etapa = exp.etapaArca ?? 'iniciados';
    if (etapa !== 'iniciados' && etapa !== 'documentacion_art') return false;
    const fecha = exp.fechaAcepto || exp.fechaIngreso;
    if (!fecha) return false;
    return this._diasDesde(fecha) >= 61;
  }

  diasTranscurridos(exp: Expediente): number {
    const fecha = exp.fechaAcepto || exp.fechaIngreso;
    return fecha ? this._diasDesde(fecha) : -1;
  }

  // ── Drag & drop normal ────────────────────────────────────────────────────

  onDragStart(event: DragEvent, exp: Expediente) {
    this.draggingId = exp.id!;
    event.dataTransfer?.setData('text/plain', exp.id!);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onDragEnd() {
    this.draggingId = null;
    this.dragOverEtapa = null;
    this.dragOverSisfe = false;
    this.cdr.detectChanges();
  }

  onDragOver(event: DragEvent, etapa: EtapaArca) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (this.dragOverEtapa !== etapa) { this.dragOverEtapa = etapa; this.cdr.detectChanges(); }
  }

  onDragLeave(event: DragEvent) {
    const target = event.currentTarget as HTMLElement;
    const related = event.relatedTarget as Node | null;
    if (!related || !target.contains(related)) { this.dragOverEtapa = null; this.cdr.detectChanges(); }
  }

  async onDrop(event: DragEvent, etapa: EtapaArca) {
    event.preventDefault();
    const id = event.dataTransfer?.getData('text/plain');
    this.dragOverEtapa = null;
    if (!id) { this.draggingId = null; return; }
    const exp = this.expedientes.find(e => e.id === id);
    if (!exp || (exp.etapaArca ?? 'iniciados') === etapa) { this.draggingId = null; return; }
    await this.fs.actualizarExpedienteAbogado(id, { etapaArca: etapa });
    const i = this.expedientes.findIndex(e => e.id === id);
    if (i >= 0) { this.expedientes[i] = { ...this.expedientes[i], etapaArca: etapa }; this.expedientes = [...this.expedientes]; }
    this.draggingId = null;
    this.cdr.detectChanges();
  }

  // ── Drag sobre zona SISFE ─────────────────────────────────────────────────

  onDragOverSisfe(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (!this.dragOverSisfe) { this.dragOverSisfe = true; this.cdr.detectChanges(); }
  }

  onDragLeaveSisfe(event: DragEvent) {
    const target = event.currentTarget as HTMLElement;
    const related = event.relatedTarget as Node | null;
    if (!related || !target.contains(related)) { this.dragOverSisfe = false; this.cdr.detectChanges(); }
  }

  async onDropSisfe(event: DragEvent) {
    event.preventDefault();
    this.dragOverSisfe = false;
    const id = event.dataTransfer?.getData('text/plain');
    if (!id) { this.draggingId = null; return; }
    this.confirmPasarModuloId = id;
    this.draggingId = null;
    this.cdr.detectChanges();
  }

  // ── Pasar al módulo contrario ─────────────────────────────────────────────

  iniciarPasarModulo(id: string) {
    this.confirmPasarModuloId = id;
  }

  async confirmarPasarModulo() {
    const id = this.confirmPasarModuloId;
    if (!id) return;
    await this.fs.actualizarExpedienteAbogado(id, {
      modulo: this.moduloDestino,
      etapaArca: 'iniciados',
    });
    this.expedientes = this.expedientes.filter(e => e.id !== id);
    this.confirmPasarModuloId = null;
    this.cdr.detectChanges();
  }

  cancelarPasarModulo() { this.confirmPasarModuloId = null; }

  get expParaPasar(): Expediente | undefined {
    return this.expedientes.find(e => e.id === this.confirmPasarModuloId);
  }

  // ── Vista detalle ─────────────────────────────────────────────────────────

  abrirDetalle(exp: Expediente) {
    this.detalleExp    = { ...exp };
    this.detalleError  = '';
    this.iaTexto       = '';
    this.iaError       = '';
    this.mostrarDetalle = true;
  }

  cerrarDetalle() { this.mostrarDetalle = false; }

  moverEtapaDetalle(etapa: EtapaArca) {
    const entrada = { fecha: this._hoy(), etapa, nota: '' };
    const historial = [...(this.detalleExp.historialMovimientos ?? []), entrada];
    this.detalleExp = { ...this.detalleExp, etapaArca: etapa, historialMovimientos: historial };
  }

  private _hoy(): string {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }

  toggleCheckDetalle(campo: keyof Expediente) {
    this.detalleExp = { ...this.detalleExp, [campo]: !(this.detalleExp as any)[campo] };
  }

  etapaDetalleStyle(key: EtapaArca): object {
    const current = this.detalleExp.etapaArca ?? 'iniciados';
    if (key === current)                                  return { background: '#875A7B', color: '#fff' };
    if (this.etapaIdx(key) < this.etapaIdx(current))     return { background: 'rgba(135,90,123,.12)', color: '#875A7B' };
    return {};
  }

  async guardarDetalle() {
    const original = this.expedientes.find(e => e.id === this.detalleExp.id);
    if (!original) return;
    const cambios: Partial<Expediente> = {};
    for (const key of Object.keys(this.detalleExp) as (keyof Expediente)[]) {
      if (JSON.stringify((this.detalleExp as any)[key]) !== JSON.stringify((original as any)[key]))
        (cambios as any)[key] = (this.detalleExp as any)[key];
    }
    if (!Object.keys(cambios).length) { this.cerrarDetalle(); return; }
    this.detalleGuardando = true;
    this.detalleError = '';
    try {
      await this.fs.actualizarExpedienteAbogado(this.detalleExp.id!, cambios);
      const i = this.expedientes.findIndex(e => e.id === this.detalleExp.id);
      if (i >= 0) { this.expedientes[i] = { ...this.detalleExp }; this.expedientes = [...this.expedientes]; }
      this.cerrarDetalle();
    } catch { this.detalleError = 'Error al guardar.'; }
    finally { this.detalleGuardando = false; this.cdr.detectChanges(); }
  }

  // ── Modal crear/editar ────────────────────────────────────────────────────

  abrirModalNuevo(etapa: EtapaArca) {
    this.editandoId = null; this.modalEtapa = etapa;
    this.modalNombre = this.modalNroExpediente = this.modalCuil = this.modalArt = this.modalNotas = this.modalError = '';
    this.mostrarModal = true;
  }

  abrirModalEditar(exp: Expediente) {
    this.editandoId = exp.id!; this.modalEtapa = exp.etapaArca ?? 'iniciados';
    this.modalNombre = exp.nombre; this.modalNroExpediente = exp.nroExpediente;
    this.modalCuil = exp.cuil; this.modalArt = exp.art; this.modalNotas = exp.notas ?? '';
    this.modalError = ''; this.mostrarModal = true;
  }

  async guardarModal() {
    if (!this.modalNombre.trim()) { this.modalError = 'El nombre es obligatorio.'; return; }
    this.modalGuardando = true; this.modalError = '';
    try {
      if (this.editandoId) {
        await this.fs.actualizarExpedienteAbogado(this.editandoId, {
          nombre: this.modalNombre.trim(), nroExpediente: this.modalNroExpediente.trim(),
          cuil: this.modalCuil.trim(), art: this.modalArt.trim(),
          etapaArca: this.modalEtapa, notas: this.modalNotas.trim() || undefined,
        });
        const idx = this.expedientes.findIndex(e => e.id === this.editandoId);
        if (idx >= 0) {
          this.expedientes[idx] = { ...this.expedientes[idx], nombre: this.modalNombre.trim(), nroExpediente: this.modalNroExpediente.trim(), cuil: this.modalCuil.trim(), art: this.modalArt.trim(), etapaArca: this.modalEtapa, notas: this.modalNotas.trim() || undefined };
          this.expedientes = [...this.expedientes];
        }
      } else {
        const base = {
          modulo: this.modulo,
          nombre: this.modalNombre.trim(), nroExpediente: this.modalNroExpediente.trim(),
          cuil: this.modalCuil.trim(), art: this.modalArt.trim(),
          etapaArca: this.modalEtapa, notas: this.modalNotas.trim() || undefined,
          llamador: this.auth.getCurrentEmail(), etapa: 'Judicial' as const,
          accidente: '', localidad: '', poder: false,
          certificadoMed: false, informeMed: false, certFirmas: false,
          ratificacion: false, pagare: false, boleta: false,
        };
        const id = await this.fs.crearExpedienteAbogado(base);
        this.expedientes = [{ id, ...base }, ...this.expedientes];
      }
      this.mostrarModal = false;
    } catch { this.modalError = 'Error al guardar.'; }
    finally { this.modalGuardando = false; this.cdr.detectChanges(); }
  }

  async moverEtapa(exp: Expediente, delta: 1 | -1) {
    const idx = this.etapaIdx(exp.etapaArca ?? 'iniciados');
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= ETAPAS_ARCA.length) return;
    const nuevaEtapa = ETAPAS_ARCA[newIdx].key;
    const entrada = { fecha: this._hoy(), etapa: nuevaEtapa };
    const historial = [...(exp.historialMovimientos ?? []), entrada];
    await this.fs.actualizarExpedienteAbogado(exp.id!, { etapaArca: nuevaEtapa, historialMovimientos: historial });
    const i = this.expedientes.findIndex(e => e.id === exp.id);
    if (i >= 0) { this.expedientes[i] = { ...this.expedientes[i], etapaArca: nuevaEtapa, historialMovimientos: historial }; this.expedientes = [...this.expedientes]; }
    this.cdr.detectChanges();
  }

  confirmarEliminar(id: string) { this.confirmEliminarId = id; }

  async eliminar(id: string) {
    await this.fs.eliminarExpedienteAbogadoById(id);
    this.expedientes = this.expedientes.filter(e => e.id !== id);
    this.confirmEliminarId = null;
    this.cdr.detectChanges();
  }

  /** Generación de escritos (hardcodeado por ahora) */
  generarDocumento(tipo: 'pronto_despacho' | 'demanda' | 'alegato') {
    const labels = {
      pronto_despacho: 'Pronto Despacho',
      demanda:         'Demanda',
      alegato:         'Alegato',
    };
    alert(`🚧 Generación de ${labels[tipo]} en desarrollo.\nExpediente: ${this.detalleExp.nroExpediente}`);
  }

  /** Analiza el expediente con IA en streaming */
  async analizarConIA() {
    if (this.iaAnalizando || !this.detalleExp.nroExpediente) return;
    this.iaAnalizando = true;
    this.iaTexto      = '';
    this.iaError      = '';
    this.cdr.detectChanges();
    try {
      const texto = await this.ia.extraerTextoPdf(this.detalleExp.nroExpediente);
      for await (const chunk of this.ia.analizarExpediente(texto)) {
        this.iaTexto += chunk;
        this.cdr.detectChanges();
      }
    } catch(e: any) {
      this.iaError = e.message ?? 'Error al analizar';
    } finally {
      this.iaAnalizando = false;
      this.cdr.detectChanges();
    }
  }

  /** Convierte "116066/25" → "http://localhost:8765/expediente_116066_25.pdf" */
  pdfUrl(nroExpediente: string): string | null {
    if (!nroExpediente?.trim()) return null;
    const nombre = 'expediente_' + nroExpediente.trim().replace('/', '_') + '.pdf';
    return `http://localhost:8765/${nombre}`;
  }

  abrirPdf(event: Event, nroExpediente: string) {
    event.stopPropagation();
    const url = this.pdfUrl(nroExpediente);
    if (url) window.open(url, '_blank');
  }

  volver() { this.router.navigate(['/modulos']); }
  cerrarSesion() { this.auth.logout().then(() => this.router.navigate(['/login'])); }
}

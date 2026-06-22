import { Component, OnInit, OnDestroy, ChangeDetectorRef, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirestoreService } from '../../services/firestore.service';
import { StorageService, MAX_FILE_MB } from '../../services/storage.service';
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
  // Modal de documentación
  mostrarModalDocs = false;
  docAnexo: File | null = null;
  docDni: File | null = null;
  docAltaMedica: File | null = null;
  docSecuela: File[] = [];           // fotos/PDFs de secuela (múltiples, opcional)
  docTelefono = '';
  docSubiendo = false;
  docProgreso = 0;
  docArchivoActual = '';
  docError = '';
  readonly DOC_MAX_MB = MAX_FILE_MB;

  // Configuración por llamador (definida desde el dashboard de administrador)
  requiereDocs = true;
  requiereExpediente = false;
  expedienteInput = '';

  // Modal "Iniciar Caso Fuera del Sistema"
  mostrarModalExterno = false;
  extPaso: 1 | 2 = 1;
  extTipo: 'enfermedad_profesional' | 'accidente_rechazado' | 'accidente_laboral' | '' = '';
  extDni: File | null = null;
  extAnexo: File | null = null;
  extTelefono = '';
  extSubiendo = false;
  extProgreso = 0;
  extError = '';

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
  limiteDiario = 0;     // 0 = sin límite; se sobreescribe desde Firestore

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

  perfilLlamador = ''; // '' | 'volumen' | 'highticket'
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
    private storageService: StorageService,
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

      // Cargar config personal (límite de pendientes, perfil, límite diario)
      const config = await this.firestoreService.getConfigLlamador(this.apodoUsuario);
      this.limitePendientes = config.limitePendientes;
      this.perfilLlamador  = config.perfil ?? '';
      this.limiteDiario    = config.limiteDiario ?? 0;
      this.requiereDocs       = config.requiereDocs ?? true;
      this.requiereExpediente = config.requiereExpediente ?? false;

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

  /** true cuando el llamador superó su límite diario de contactos */
  get limiteDiarioAlcanzado(): boolean {
    return this.limiteDiario > 0 && this.contactosHoy >= this.limiteDiario;
  }

  get aceptos(): CasoModel[] {
    return this.historial.filter(c => c.estado === 'acepto');
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
    return String(val);
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
      if (this.buscando || this.caso) { this.detenerPolling(); return; }
      try {
        const identificador = this.apodoUsuario || this.auth.getCurrentEmail();
        const siguiente = await this.firestoreService.getSiguienteCaso(this.apodoUsuario, this.auth.getCurrentEmail(), this.perfilLlamador);
        if (siguiente) {
          if (siguiente.id) await this.firestoreService.reservarCaso(siguiente.id, identificador);
          this.caso = siguiente;
          this.sinDatos = false;
          this.detenerPolling();
          this.cargarSumario(siguiente.CUIL);
          this.cdr.detectChanges();
        }
      } catch { /* silencioso */ }
    }, 8000); // cada 8s — getSiguienteCaso es pesado, no martillar Firestore
  }

  private detenerPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  sinDatosError = '';

  private async cargarSiguienteCaso(buscarNuevo = false) {
    this.sinDatos = false;
    this.sinDatosError = '';
    this.sumario = null;
    this.relacionContactos = {};
    this.cargandoRelacion = {};
    const identificador = this.apodoUsuario || this.auth.getCurrentEmail();

    const casoAnteriorId = buscarNuevo ? this.caso?.id : undefined;

    try {
      // Siempre chequear casos pre-asignados primero (no filtra por perfil, no devuelve el anterior)
      const yaAsignado = await this.firestoreService.getCasoAsignadoA(identificador, this.auth.getCurrentEmail());
      if (yaAsignado && yaAsignado.id !== casoAnteriorId) {
        if (yaAsignado.id && yaAsignado.ASGINADO !== identificador) {
          this.firestoreService.reservarCaso(yaAsignado.id!, identificador);
        }
        this.caso = yaAsignado;
        this.cargarSumario(yaAsignado.CUIL);
        return;
      }

      const siguiente = await this.firestoreService.getSiguienteCaso(this.apodoUsuario, this.auth.getCurrentEmail(), this.perfilLlamador);
      if (siguiente) {
        if (siguiente.id) await this.firestoreService.reservarCaso(siguiente.id, identificador);
        this.caso = siguiente;
        this.cargarSumario(siguiente.CUIL);
        return;
      }
    } catch (e: any) {
      this.sinDatosError = e?.message ?? String(e);
    }

    this.caso = null;
    this.sinDatos = true;
    this.firestoreService.debugCola(this.apodoUsuario, this.auth.getCurrentEmail())
      .then((info: { libres: number; asignados: number; variantesUsadas: string[] }) => { this.debugInfo = info; this.cdr.detectChanges(); });
  }

  debugInfo: { libres: number; asignados: number; variantesUsadas: string[] } | null = null;

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

  private _resetDocModal(): void {
    this.docAnexo = null;
    this.docDni = null;
    this.docAltaMedica = null;
    this.docSecuela = [];
    this.docTelefono = '';
    this.docError = '';
    this.docProgreso = 0;
    this.docArchivoActual = '';
    this.expedienteInput = '';
  }

  /** true si hay que mostrar el modal de "Caso Aceptado" (pide PDFs y/o número de expediente) */
  get requiereModalAcepto(): boolean {
    return this.requiereDocs || this.requiereExpediente;
  }

  /** true si todavía faltan datos obligatorios para confirmar el modal de "Caso Aceptado" */
  get confirmarDocsDisabled(): boolean {
    if (this.docSubiendo) return true;
    if (this.requiereDocs && (!this.docAnexo || !this.docDni)) return true;
    if (this.requiereExpediente && !this.expedienteInput.trim()) return true;
    return false;
  }

  setEstado(estado: EstadoCaso): void {
    if (estado === 'acepto') {
      if (!this.requiereModalAcepto) {
        this.estadoActivo = 'acepto';
        this.mostrarDescartarOpciones = false;
        return;
      }
      this._resetDocModal();
      this.mostrarModalDocs = true;
      return;
    }
    if (estado === 'pendiente') {
      this.abrirModalSeguimiento(null);
      return;
    }
    this.estadoActivo = estado;
    this.mostrarDescartarOpciones = false;
  }

  setDocFile(event: Event, campo: 'anexo' | 'dni' | 'altaMedica'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.docError = '';
    if (file) {
      const esPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (!esPdf) { this.docError = `"${file.name}" no es un PDF válido.`; input.value = ''; return; }
      if (file.size > this.DOC_MAX_MB * 1024 * 1024) { this.docError = `"${file.name}" supera el límite de ${this.DOC_MAX_MB} MB.`; input.value = ''; return; }
    }
    if (campo === 'anexo')      this.docAnexo      = file;
    if (campo === 'dni')        this.docDni        = file;
    if (campo === 'altaMedica') this.docAltaMedica = file;
  }

  addSecuelaFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const nuevos = Array.from(input.files ?? []);
    this.docError = '';
    const MAX = this.DOC_MAX_MB * 1024 * 1024;
    for (const f of nuevos) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      const valido = ['pdf','jpg','jpeg','png','webp'].includes(ext);
      if (!valido) { this.docError = `"${f.name}" debe ser PDF, JPG o PNG.`; input.value = ''; return; }
      if (f.size > MAX) { this.docError = `"${f.name}" supera el límite de ${this.DOC_MAX_MB} MB.`; input.value = ''; return; }
    }
    this.docSecuela = [...this.docSecuela, ...nuevos];
    input.value = '';
  }

  removeSecuela(i: number): void {
    this.docSecuela = this.docSecuela.filter((_, idx) => idx !== i);
  }

  abrirModalExterno() {
    this.mostrarModalExterno = true;
    this.extPaso = 1;
    this.extTipo = '';
    this.extDni = null;
    this.extAnexo = null;
    this.extTelefono = '';
    this.extError = '';
    this.extProgreso = 0;
  }

  cancelarExterno() { this.mostrarModalExterno = false; }

  seleccionarTipoExterno(tipo: 'enfermedad_profesional' | 'accidente_rechazado' | 'accidente_laboral') {
    this.extTipo = tipo;
    this.extPaso = 2;
    this.extError = '';
  }

  setExtFile(event: Event, campo: 'dni' | 'anexo'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file && file.type !== 'application/pdf') {
      this.extError = 'Solo se aceptan archivos PDF.';
      input.value = '';
      return;
    }
    this.extError = '';
    if (campo === 'dni')   this.extDni   = file;
    if (campo === 'anexo') this.extAnexo = file;
  }

  async confirmarExterno(): Promise<void> {
    if (!this.extDni)             { this.extError = 'El DNI (PDF) es obligatorio.'; return; }
    if (!this.extAnexo)           { this.extError = 'El Anexo (PDF) es obligatorio.'; return; }
    if (!this.extTelefono.trim()) { this.extError = 'El número de teléfono es obligatorio.'; return; }

    this.extSubiendo = true;
    this.extError = '';
    try {
      const id = Date.now().toString();
      const dniUrl   = await this.storageService.uploadFile(`casos_externos/${id}/dni.pdf`,   this.extDni!,   p => { this.extProgreso = Math.round(p / 2); this.cdr.detectChanges(); });
      const anexoUrl = await this.storageService.uploadFile(`casos_externos/${id}/anexo.pdf`, this.extAnexo!, p => { this.extProgreso = 50 + Math.round(p / 2); this.cdr.detectChanges(); });
      await this.firestoreService.guardarCasoExterno({
        tipo: this.extTipo,
        telefono: this.extTelefono.trim(),
        dniUrl,
        anexoUrl,
        creadoPor: this.apodoUsuario,
        creadoEmail: this.auth.getCurrentEmail(),
      });
      this.mostrarModalExterno = false;
    } catch (e: any) {
      this.extError = 'Error al subir: ' + (e.message ?? 'Intentá de nuevo.');
    } finally {
      this.extSubiendo = false;
      this.cdr.detectChanges();
    }
  }

  async confirmarDocs(): Promise<void> {
    if (this.requiereDocs) {
      if (!this.docAnexo) { this.docError = 'El anexo (PDF) es obligatorio.'; return; }
      if (!this.docDni)   { this.docError = 'El DNI frente (PDF) es obligatorio.'; return; }
    }
    if (this.requiereExpediente && !this.expedienteInput.trim()) {
      this.docError = 'El número de expediente es obligatorio.';
      return;
    }

    const casoActivo = this.pendingCambioEstado?.caso ?? this.caso;
    const casoId = casoActivo?.id;
    if (!casoId) { this.docError = 'No hay caso activo. Recargá la página.'; return; }

    this.docSubiendo = true;
    this.docError = '';
    this.docProgreso = 0;
    this.docArchivoActual = this.requiereDocs ? 'Preparando archivos...' : '';
    this.cdr.detectChanges();

    try {
      let docs: any = undefined;
      if (this.requiereDocs) {
        docs = await this.storageService.subirDocumentacion(
          casoId,
          {
            anexo: this.docAnexo!,
            dni:   this.docDni!,
            ...(this.docAltaMedica             ? { altaMedica: this.docAltaMedica } : {}),
            ...(this.docSecuela.length > 0     ? { secuela:    this.docSecuela    } : {}),
          },
          this.apodoUsuario,
          pct => {
            this.docProgreso = pct;
            const total = 2 + (this.docAltaMedica ? 1 : 0) + this.docSecuela.length;
            const names = ['Anexo', 'DNI', ...(this.docAltaMedica ? ['Alta Médica'] : []), ...this.docSecuela.map((f, i) => `Secuela ${i + 1}`)];
            const fileIdx = Math.min(Math.floor(pct / (100 / total)), names.length - 1);
            this.docArchivoActual = `Subiendo ${names[fileIdx]}...`;
            this.cdr.detectChanges();
          }
        );

        // Solo guarda en Firestore si TODOS los archivos subieron OK
        await this.firestoreService.guardarDocumentacionCaso(casoId, docs, this.docTelefono.trim());
      }

      if (this.requiereExpediente) {
        await this.firestoreService.guardarExpediente(casoId, this.expedienteInput.trim(), casoActivo);
      }

      this.mostrarModalDocs = false;

      if (this.pendingCambioEstado) {
        // Caso del historial → abrir modal de comentario para confirmar
        this.comentarioInput = '';
        this.mostrarModalComentario = true;
      } else {
        // Caso actual: marcar como acepto en Firestore YA (sin esperar "Siguiente caso")
        // así Josefina lo ve inmediatamente
        await this.firestoreService.marcarProcesado(
          casoId,
          'acepto',
          this.auth.getCurrentEmail().trim(),
          this.apodoUsuario.trim(),
          this.caso,
          ''
        );
        this.estadoActivo = 'acepto';
        this.mostrarDescartarOpciones = false;
        if (this.caso) {
          this.caso = {
            ...this.caso,
            procesado: true,
            estado: 'acepto',
            ...(docs ? { documentacion: docs } : {}),
            ...(this.requiereExpediente ? { nroExpediente: this.expedienteInput.trim() } : {}),
          };
        }
      }
    } catch (e: any) {
      const msg: string = e?.message ?? String(e);
      if (msg.includes('storage/unauthorized') || msg.includes('permission-denied')) {
        this.docError = 'Sin permisos para subir archivos. Contactá al administrador.';
      } else if (msg.includes('storage/canceled')) {
        this.docError = 'Subida cancelada.';
      } else if (msg.includes('network') || msg.includes('fetch')) {
        this.docError = 'Error de red. Verificá tu conexión e intentá de nuevo.';
      } else {
        this.docError = 'Error al subir: ' + msg;
      }
    } finally {
      this.docSubiendo = false;
      this.docArchivoActual = '';
      this.cdr.detectChanges();
    }
  }

  cancelarDocs(): void {
    this._resetDocModal();
    this.mostrarModalDocs = false;
    if (this.pendingCambioEstado) {
      const { caso } = this.pendingCambioEstado;
      const idx = this.historial.findIndex(c => c.id === caso.id);
      if (idx >= 0) this.historial[idx] = { ...this.historial[idx] }; // fuerza re-render del select
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
    const nombre = encodeURIComponent(`Hola ${caso.Trabajador || ''}`);
    window.open(`https://wa.me/54${tel}?text=${nombre}`, '_blank');
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

    // Acepto: pedir documentación y/o número de expediente, si corresponde
    if (nuevoEstado === 'acepto') {
      if (!this.requiereModalAcepto) {
        this.cambiarEstadoCaso(caso, nuevoEstado, '');
        return;
      }
      this.pendingCambioEstado = { caso, estado: nuevoEstado };
      this._resetDocModal();
      this.mostrarModalDocs = true;
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

  abrirWaNumero(codigoArea: string, numero: string, nombre?: string): void {
    const tel = (codigoArea + numero).replace(/\D/g, '');
    const txt = encodeURIComponent(`Hola ${nombre || ''}`);
    window.open(`https://wa.me/54${tel}?text=${txt}`, '_blank');
  }

  abrirWhatsappVinculo(documento: string, nombre?: string): void {
    const telefono = documento.replace(/\D/g, '');
    const txt = encodeURIComponent(`Hola ${nombre || ''}`);
    window.open(`https://wa.me/54${telefono}?text=${txt}`, '_blank');
  }

  async reintentar(): Promise<void> {
    this.sinDatos = false;
    this.detenerPolling();
    await this.cargarSiguienteCaso(true);
    if (this.sinDatos) this.iniciarPolling();
    this.cdr.detectChanges();
  }

  async solicitarDatoNuevo(): Promise<void> {
    if (this.buscando || !this.caso || !this.estadoActivo || this.limitePendientesAlcanzado) return;
    // Recargar límite desde Firestore en cada intento — efecto inmediato sin recargar página
    const cfg = await this.firestoreService.getConfigLlamador(this.apodoUsuario);
    this.limiteDiario = cfg.limiteDiario ?? 0;
    if (this.limiteDiarioAlcanzado) { this.cdr.detectChanges(); return; }

    if (this.caso.id) {
      // Si ya fue procesado (ej: acepto marcado al subir docs), no llamar de nuevo
      // para evitar duplicar notificaciones y estadísticas
      if (!this.caso.procesado) {
        await this.firestoreService.marcarProcesado(
          this.caso.id,
          this.estadoActivo,
          this.auth.getCurrentEmail().trim(),
          this.apodoUsuario.trim(),
          this.caso,
          this.comentarioCasoActual
        );
      }
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

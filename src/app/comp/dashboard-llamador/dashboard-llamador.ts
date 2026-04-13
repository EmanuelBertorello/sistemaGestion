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
  buscando = false;
  cargandoInicial = true;
  seccionActiva: 'caso' | 'acepto' | 'pendientes' | 'historial' = 'caso';
  casoModal: CasoModel | null = null;
  mostrarModalMatricula = false;
  mostrarModalPerfil = false;
  perfilApodo = '';
  perfilPassword = '';
  perfilPasswordActual = '';
  perfilGuardando = false;
  perfilMensaje = '';
  perfilError = '';

  readonly LIMITE_PENDIENTES = 35;

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
    private auth: AuthService,
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

  get limitePendientesAlcanzado(): boolean { return this.pendientesCount >= this.LIMITE_PENDIENTES; }

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
        const siguiente = await this.firestoreService.getSiguienteCaso();
        if (siguiente) {
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
      const yaAsignado = await this.firestoreService.getCasoAsignadoA(identificador);
      if (yaAsignado) {
        this.caso = yaAsignado;
        this.cargarSumario(yaAsignado.CUIL);
        return;
      }
    }

    const siguiente = await this.firestoreService.getSiguienteCaso();
    if (siguiente) {
      if (siguiente.id) {
        await this.firestoreService.reservarCaso(siguiente.id, identificador);
      }
      this.caso = siguiente;
      this.cargarSumario(siguiente.CUIL);
    } else {
      this.caso = null;
      this.sinDatos = true;
    }
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
    this.historial = await this.firestoreService.getHistorialPor(email);
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
    this.estadoActivo = estado;
    this.mostrarDescartarOpciones = false;
  }

  confirmarExpediente(): void {
    if (!this.expedienteInput.trim()) {
      this.expedienteError = 'El número de expediente es obligatorio.';
      return;
    }
    this.estadoActivo = 'acepto';
    this.mostrarDescartarOpciones = false;
    this.mostrarModalExpediente = false;
    // Guardar expediente en Firestore si ya hay un caso asignado
    if (this.caso?.id) {
      this.firestoreService.guardarExpediente(this.caso.id, this.expedienteInput.trim());
      this.caso = { ...this.caso, nroExpediente: this.expedienteInput.trim() };
    }
  }

  cancelarExpediente(): void {
    this.mostrarModalExpediente = false;
    this.expedienteInput = '';
    this.expedienteError = '';
  }

  abrirDescartar(): void {
    this.mostrarDescartarOpciones = !this.mostrarDescartarOpciones;
    if (this.mostrarDescartarOpciones) this.estadoActivo = '';
  }

  elegirDescartar(estado: EstadoCaso): void {
    this.estadoActivo = estado;
    this.mostrarDescartarOpciones = false;
  }

  setSeccion(seccion: 'caso' | 'acepto' | 'pendientes' | 'historial'): void {
    this.seccionActiva = seccion;
  }

  limpiarFiltros(): void {
    this.busquedaHistorial = '';
    this.filtroEstado = '';
    this.filtroDias = '';
    this.filtroZona = '';
    this.filtroDiag = '';
  }

  async cambiarEstadoCaso(caso: CasoModel, nuevoEstado: EstadoCaso): Promise<void> {
    if (!caso.id || !nuevoEstado) return;
    this.cambiandoEstado = { ...this.cambiandoEstado, [caso.id]: true };
    this.cdr.detectChanges();
    try {
      await this.firestoreService.cambiarEstadoCaso(
        caso.id, nuevoEstado,
        this.auth.getCurrentEmail(),
        this.apodoUsuario,
        caso
      );
      // Actualizar localmente
      const idx = this.historial.findIndex(c => c.id === caso.id);
      if (idx >= 0) this.historial[idx] = { ...this.historial[idx], estado: nuevoEstado };
    } finally {
      this.cambiandoEstado = { ...this.cambiandoEstado, [caso.id]: false };
      this.cdr.detectChanges();
    }
  }

  abrirWaNumero(codigoArea: string, numero: string): void {
    const tel = (codigoArea + numero).replace(/\D/g, '');
    window.open(`https://wa.me/54${tel}`, '_blank');
  }

  abrirWhatsappVinculo(documento: string): void {
    const telefono = documento.replace(/\D/g, '');
    window.open(`https://wa.me/54${telefono}`, '_blank');
  }

  async solicitarDatoNuevo(): Promise<void> {
    if (this.buscando || !this.caso || !this.estadoActivo || this.limitePendientesAlcanzado) return;

    if (this.caso.id) {
      await this.firestoreService.marcarProcesado(
        this.caso.id,
        this.estadoActivo,
        this.auth.getCurrentEmail(),
        this.apodoUsuario,
        this.caso
      );
      // Actualizar historial con referencia nueva para forzar CD
      this.historial = [{ ...this.caso, estado: this.estadoActivo, procesado: true }, ...this.historial];
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

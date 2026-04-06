import { Component, OnInit, OnDestroy, ChangeDetectorRef, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirestoreService } from '../../services/firestore.service';
import { CerteroService, SumarioCertero } from '../../services/certero.service';
import { CasoModel, EstadoCaso } from './caso.model';

@Component({
  selector: 'app-dashboard-llamador',
  standalone: true,
  imports: [],
  templateUrl: './dashboard-llamador.html',
  styleUrls: ['./dashboard-llamador.css']
})
export class DashboardLlamador implements OnInit, OnDestroy {
  estadoActivo: EstadoCaso = '';
  buscando = false;
  cargandoInicial = true;
  seccionActiva: 'caso' | 'historial' | 'interesados' = 'caso';

  caso: CasoModel | null = null;
  historial: CasoModel[] = [];
  sinDatos = false;
  sumario: SumarioCertero | null = null;
  cargandoSumario = false;

  private apodoUsuario = '';
  private pollingInterval: any = null;

  constructor(
    private auth: AuthService,
    private firestoreService: FirestoreService,
    private certero: CerteroService,
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
      this.apodoUsuario = await this.firestoreService.getApodoPorEmail(email);
      await this.cargarSiguienteCaso();
      await this.cargarHistorial();
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

  get interesados(): CasoModel[] {
    return this.historial.filter(c => c.estado === 'interesado');
  }

  ngOnDestroy() {
    this.detenerPolling();
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
        // silencioso, reintenta en 2s
      }
    }, 2000);
  }

  private detenerPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private async cargarSiguienteCaso() {
    this.sinDatos = false;
    this.sumario = null;
    const siguiente = await this.firestoreService.getSiguienteCaso();
    if (siguiente) {
      this.caso = siguiente;
      this.cargarSumario(siguiente.CUIL);
    } else {
      this.caso = null;
      this.sinDatos = true;
    }
  }

  private async cargarSumario(cuil?: string) {
    if (!cuil) return;
    this.cargandoSumario = true;
    this.cdr.detectChanges();
    this.sumario = await this.certero.getSumario(cuil);
    this.cargandoSumario = false;
    this.cdr.detectChanges();
  }

  private async cargarHistorial() {
    const email = this.auth.getCurrentEmail();
    if (!email) return;
    this.historial = await this.firestoreService.getHistorialPor(email);
  }

  get estadoActivoLabel(): string {
    const estados: Record<Exclude<EstadoCaso, ''>, string> = {
      acepto: 'Acepto',
      interesado: 'Interesado',
      sincontacto: 'Sin Contacto',
      conabogado: 'Con Abogado',
      nointeresado: 'No interesado'
    };
    return this.estadoActivo ? estados[this.estadoActivo] : '';
  }

  getEstadoColor(estado: string): string {
    const colores: Record<string, string> = {
      acepto: 'bg-green-100 text-green-700',
      interesado: 'bg-yellow-100 text-yellow-700',
      sincontacto: 'bg-red-100 text-red-700',
      conabogado: 'bg-red-100 text-red-700',
      nointeresado: 'bg-gray-100 text-gray-600'
    };
    return colores[estado] || 'bg-gray-100 text-gray-700';
  }

  countEstado(tipo: 'acepto' | 'interesado' | 'sincontacto' | 'otros'): number {
    if (tipo === 'otros') {
      return this.historial.filter(
        h => h.estado !== 'acepto' && h.estado !== 'interesado' && h.estado !== 'sincontacto'
      ).length;
    }
    return this.historial.filter(h => h.estado === tipo).length;
  }

  setEstado(estado: EstadoCaso): void {
    this.estadoActivo = estado;
  }

  setSeccion(seccion: 'caso' | 'historial' | 'interesados'): void {
    this.seccionActiva = seccion;
  }

  abrirWhatsapp(): void {
    // No hay campo teléfono en la BD actual
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
    if (this.buscando || !this.caso) return;

    if (this.estadoActivo && this.caso.id) {
      await this.firestoreService.marcarProcesado(
        this.caso.id,
        this.estadoActivo,
        this.auth.getCurrentEmail(),
        this.apodoUsuario
      );
      this.historial.unshift({ ...this.caso, estado: this.estadoActivo, procesado: true });
    }

    this.buscando = true;
    this.estadoActivo = '';
    this.seccionActiva = 'caso';

    await this.cargarSiguienteCaso();

    this.buscando = false;
    this.cdr.detectChanges();

    if (this.sinDatos) {
      this.iniciarPolling();
    }
  }

  async cerrarSesion(): Promise<void> {
    this.detenerPolling();
    await this.auth.logout();
    this.router.navigate(['/login']);
  }

  generarAnexo(): void {
    const pdfContent = `%PDF-1.1
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] >> endobj
xref
0 4
0000000000 65535 f
0000000010 00000 n
0000000062 00000 n
0000000117 00000 n
trailer << /Root 1 0 R /Size 4 >>
startxref
178
%%EOF`;
    const blob = new Blob([pdfContent], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'anexo.pdf';
    link.click();
    URL.revokeObjectURL(url);
  }
}

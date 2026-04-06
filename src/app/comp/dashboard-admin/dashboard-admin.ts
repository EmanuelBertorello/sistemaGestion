import { Component, NgZone, OnInit, ChangeDetectorRef, PLATFORM_ID, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirestoreService, UploadResult, LlamadorStats } from '../../services/firestore.service';
import { CasoModel } from '../dashboard-llamador/caso.model';
import * as XLSX from 'xlsx';

type SeccionActiva = 'estadisticas' | 'acepto' | 'interesado' | 'sincontacto' | 'conabogado' | 'nointeresado' | 'cargar' | 'historial';

type EstadoUpload = 'idle' | 'preview' | 'subiendo' | 'done' | 'error';

@Component({
  selector: 'app-dashboard-admin',
  imports: [FormsModule, DatePipe],
  templateUrl: './dashboard-admin.html',
  styleUrl: './dashboard-admin.css',
})
export class DashboardAdmin implements OnInit {
  constructor(
    private auth: AuthService,
    private router: Router,
    private fs: FirestoreService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  seccionActiva: SeccionActiva = 'estadisticas';

  llamadores: LlamadorStats[] = [];
  cargandoStats = false;

  // ── Historial ─────────────────────────────────────────────
  historial: CasoModel[] = [];
  cargandoHistorial = false;
  historialFiltroLlamador = '';
  historialFiltroEstado = '';

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
  }

  async cargarEstadisticas() {
    this.cargandoStats = true;
    try {
      this.llamadores = await this.fs.getEstadisticasAdmin();
    } catch (e) {
      console.error('Error cargando estadísticas:', e);
    } finally {
      this.cargandoStats = false;
      this.cdr.detectChanges();
    }
  }

  setSeccion(s: SeccionActiva) {
    this.seccionActiva = s;
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

  get esCargar(): boolean {
    return this.seccionActiva === 'cargar';
  }

  get esHistorial(): boolean {
    return this.seccionActiva === 'historial';
  }

  get historialFiltrado(): CasoModel[] {
    return this.historial.filter(c => {
      const okLlamador = !this.historialFiltroLlamador || c.procesadoPor === this.historialFiltroLlamador;
      const okEstado = !this.historialFiltroEstado || c.estado === this.historialFiltroEstado;
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
      try {
        this.historial = await this.fs.getHistorialCompleto();
      } catch (e) {
        console.error('Error cargando historial:', e);
      } finally {
        this.cargandoHistorial = false;
        this.cdr.detectChanges();
      }
    }
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
        const filas: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        if (filas.length === 0) {
          this.uploadError = 'El archivo no contiene datos.';
          this.estadoUpload = 'error';
        } else {
          this.datosParaSubir = filas;
          this.totalFilas = filas.length;
          this.columnas = Object.keys(filas[0]);
          this.filaPreview = filas.slice(0, 5);
          this.estadoUpload = 'preview';
        }
      } catch {
        this.uploadError = 'No se pudo leer el archivo. Asegurate de que sea un Excel válido (.xlsx / .xls).';
        this.estadoUpload = 'error';
      }
      this.cdr.detectChanges();
    };
    reader.readAsArrayBuffer(file);
    // Reset input para permitir re-seleccionar el mismo archivo
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

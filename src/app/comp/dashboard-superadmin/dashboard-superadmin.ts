import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirestoreService, Estudio, ReglaDistribucion, UsuarioApp } from '../../services/firestore.service';
import { CasoModel } from '../dashboard-llamador/caso.model';
import * as XLSX from 'xlsx';

type Seccion = 'estudios' | 'distribuir' | 'usuarios' | 'cargar';

@Component({
  selector: 'app-dashboard-superadmin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard-superadmin.html',
})
export class DashboardSuperadmin implements OnInit {
  seccion: Seccion = 'estudios';
  cargando = true;

  // ── Estudios ──────────────────────────────────────────────
  estudios: Estudio[] = [];
  estudioForm = { nombre: '', adminEmail: '', pagoPorAcepto: 40000, letradoNombre: '', letradoCuit: '', letradoEmail: '', letradoMatricula: '' };
  estudioGuardando = false;
  estudioError = '';

  // ── Reglas ────────────────────────────────────────────────
  reglasDistribucion: ReglaDistribucion[] = [];
  reglaForm = { estudioId: '', provincia: '', artFiltro: '', minDiasILT: 0, tipoCaso: '', prioridad: 1 };
  reglaGuardando = false;
  reglaError = '';

  // ── Distribución ──────────────────────────────────────────
  distribucionPreview: Array<{ caso: CasoModel; estudioId: string; estudioNombre: string; reglaDesc: string }> = [];
  distribuyendo = false;
  distribucionResultado: { distribuidos: number; sinMatch: number } | null = null;
  ventaSiTotal = 0;
  ventaSiSinAsignar = 0;

  // ── Usuarios ──────────────────────────────────────────────
  usuarios: UsuarioApp[] = [];
  cargandoUsuarios = false;

  // ── Cargar BD ─────────────────────────────────────────────
  readonly EXCEL_COLS: Record<number, string> = {
    0: 'Trabajador', 1: 'zona', 2: 'Registrado_Por', 3: 'CUIL', 4: 'Tipo_Accidente',
    5: 'Fecha_Accidente', 6: 'Dias_ILT', 7: 'Lesion_1', 8: 'Diag_1', 9: 'Secuelas',
    10: 'Localidad_Ocurrencia', 11: 'Provincia_Ocurrencia', 12: 'CUIT_Empleador',
  };
  archivoNombre = '';
  datosParaSubir: Record<string, any>[] = [];
  totalFilas = 0;
  estadoUpload: 'idle' | 'preview' | 'subiendo' | 'done' | 'error' = 'idle';
  uploadSubidos = 0;
  uploadTotal = 0;
  uploadError = '';
  resumenVentaSi = 0;
  resumenVentaNo = 0;

  constructor(
    private auth: AuthService,
    private fs: FirestoreService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit() {
    try {
      await this.cargarEstudios();
    } finally {
      this.cargando = false;
      this.cdr.detectChanges();
    }
  }

  // ── Estudios CRUD ─────────────────────────────────────────

  async cargarEstudios() {
    const [estudios, reglas] = await Promise.all([
      this.fs.getEstudios(),
      this.fs.getReglasDistribucion(),
    ]);
    this.estudios = estudios;
    this.reglasDistribucion = reglas;
    this.cdr.detectChanges();
  }

  async crearEstudio() {
    if (!this.estudioForm.nombre.trim() || !this.estudioForm.adminEmail.trim()) {
      this.estudioError = 'Nombre y email son obligatorios.';
      return;
    }
    this.estudioGuardando = true;
    this.estudioError = '';
    try {
      await this.fs.crearEstudio({
        nombre: this.estudioForm.nombre.trim(),
        slug: this.estudioForm.nombre.trim().toLowerCase().replace(/\s+/g, '-'),
        adminEmail: this.estudioForm.adminEmail.trim(),
        activo: true,
        pagoPorAcepto: this.estudioForm.pagoPorAcepto,
        letradoNombre: this.estudioForm.letradoNombre.trim() || undefined,
        letradoCuit: this.estudioForm.letradoCuit.trim() || undefined,
        letradoEmail: this.estudioForm.letradoEmail.trim() || undefined,
        letradoMatricula: this.estudioForm.letradoMatricula.trim() || undefined,
      });
      this.estudioForm = { nombre: '', adminEmail: '', pagoPorAcepto: 40000, letradoNombre: '', letradoCuit: '', letradoEmail: '', letradoMatricula: '' };
      await this.cargarEstudios();
    } catch (e: any) {
      this.estudioError = e.message;
    } finally {
      this.estudioGuardando = false;
      this.cdr.detectChanges();
    }
  }

  async toggleEstudio(e: Estudio) {
    await this.fs.actualizarEstudio(e.id!, { activo: !e.activo });
    e.activo = !e.activo;
    this.cdr.detectChanges();
  }

  nombreEstudio(id: string): string {
    return this.estudios.find(e => e.id === id)?.nombre ?? '?';
  }

  // ── Reglas CRUD ───────────────────────────────────────────

  async agregarRegla() {
    if (!this.reglaForm.estudioId || !this.reglaForm.provincia.trim()) {
      this.reglaError = 'Estudio y provincia son obligatorios.';
      return;
    }
    this.reglaGuardando = true;
    this.reglaError = '';
    try {
      const artFiltro = this.reglaForm.artFiltro.trim() ? this.reglaForm.artFiltro.split(',').map(a => a.trim()) : [];
      await this.fs.crearReglaDistribucion({
        estudioId: this.reglaForm.estudioId,
        provincia: this.reglaForm.provincia.trim(),
        artFiltro: artFiltro.length > 0 ? artFiltro : undefined,
        minDiasILT: this.reglaForm.minDiasILT || undefined,
        tipoCaso: this.reglaForm.tipoCaso || undefined,
        prioridad: this.reglaForm.prioridad,
        activa: true,
      });
      this.reglaForm = { estudioId: '', provincia: '', artFiltro: '', minDiasILT: 0, tipoCaso: '', prioridad: 1 };
      await this.cargarEstudios();
    } catch (e: any) {
      this.reglaError = e.message;
    } finally {
      this.reglaGuardando = false;
      this.cdr.detectChanges();
    }
  }

  async eliminarRegla(id: string) {
    await this.fs.eliminarReglaDistribucion(id);
    this.reglasDistribucion = this.reglasDistribucion.filter(r => r.id !== id);
    this.cdr.detectChanges();
  }

  // ── Distribución ──────────────────────────────────────────

  async previsualizarDist() {
    this.distribuyendo = true;
    this.distribucionResultado = null;
    this.cdr.detectChanges();
    try {
      this.distribucionPreview = await this.fs.previsualizarDistribucion();
    } finally {
      this.distribuyendo = false;
      this.cdr.detectChanges();
    }
  }

  async ejecutarDistribucion() {
    this.distribuyendo = true;
    this.cdr.detectChanges();
    try {
      this.distribucionResultado = await this.fs.distribuirCasosVentaSi();
      this.distribucionPreview = [];
    } finally {
      this.distribuyendo = false;
      this.cdr.detectChanges();
    }
  }

  // ── Usuarios ──────────────────────────────────────────────

  async cargarUsuarios() {
    this.cargandoUsuarios = true;
    this.cdr.detectChanges();
    try {
      this.usuarios = await this.fs.getUsuarios();
    } finally {
      this.cargandoUsuarios = false;
      this.cdr.detectChanges();
    }
  }

  editandoUid: string | null = null;
  editApodo = '';
  editEstudioId = '';
  editRol = '';
  guardandoUsuario: Record<string, boolean> = {};

  editarUsuario(u: UsuarioApp) {
    this.editandoUid = u.uid;
    this.editApodo = u.apodo || '';
    this.editEstudioId = u.estudioId || '';
    this.editRol = u.esAdminEstudio ? 'admin_estudio' : (u.rol || 'llamador');
  }

  cancelarEdicion() {
    this.editandoUid = null;
  }

  async guardarUsuarioEdit(u: UsuarioApp) {
    this.guardandoUsuario[u.uid] = true;
    this.cdr.detectChanges();
    try {
      const updates: Record<string, any> = { apodo: this.editApodo.trim() };
      if (this.editEstudioId) updates['estudioId'] = this.editEstudioId;
      else updates['estudioId'] = '';
      updates['esAdminEstudio'] = this.editRol === 'admin_estudio';
      if (this.editRol !== 'admin_estudio') updates['rol'] = this.editRol;
      else updates['rol'] = 'admin_estudio';
      await this.fs.actualizarUsuarioPorUid(u.uid, updates);
      u.apodo = this.editApodo.trim();
      u.estudioId = this.editEstudioId || undefined;
      u.esAdminEstudio = this.editRol === 'admin_estudio';
      u.rol = updates['rol'] as any;
      this.editandoUid = null;
    } finally {
      this.guardandoUsuario[u.uid] = false;
      this.cdr.detectChanges();
    }
  }

  estudioDeUsuario(u: UsuarioApp): string {
    if (!u.estudioId) return 'Capeletti';
    return this.estudios.find(e => e.id === u.estudioId)?.nombre ?? u.estudioId;
  }

  rolLabel(u: UsuarioApp): string {
    if (u.esAdminEstudio) return 'Admin Estudio';
    return u.rol ?? 'llamador';
  }

  // ── Cargar BD ─────────────────────────────────────────────

  onArchivoSeleccionado(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.archivoNombre = file.name;
    this.uploadError = '';
    this.estadoUpload = 'idle';

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(sheet);

        this.datosParaSubir = rows.filter((r: any) => r['Trabajador']);
        this.totalFilas = this.datosParaSubir.length;
        this.resumenVentaSi = this.datosParaSubir.filter(f => {
          const v = (f['VENTA'] ?? '').toString().toLowerCase().trim();
          return v === 'si' || v === 'sí';
        }).length;
        this.resumenVentaNo = this.totalFilas - this.resumenVentaSi;
        this.estadoUpload = this.totalFilas > 0 ? 'preview' : 'error';
        if (this.totalFilas === 0) this.uploadError = 'Sin datos válidos.';
      } catch {
        this.uploadError = 'No se pudo leer el archivo.';
        this.estadoUpload = 'error';
      }
      this.cdr.detectChanges();
    };
    reader.readAsArrayBuffer(file);
    input.value = '';
  }

  async confirmarUpload() {
    this.estadoUpload = 'subiendo';
    this.uploadSubidos = 0;
    this.uploadTotal = this.datosParaSubir.length;
    this.cdr.detectChanges();
    try {
      await this.fs.uploadCasos(this.datosParaSubir, (s, t) => {
        this.uploadSubidos = s;
        this.uploadTotal = t;
        this.cdr.detectChanges();
      });
      this.estadoUpload = 'done';
    } catch (e: any) {
      this.uploadError = e.message;
      this.estadoUpload = 'error';
    }
    this.cdr.detectChanges();
  }

  get uploadPct(): number {
    return this.uploadTotal > 0 ? Math.round((this.uploadSubidos / this.uploadTotal) * 100) : 0;
  }

  // ── Nav ───────────────────────────────────────────────────

  async cerrarSesion() {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }
}

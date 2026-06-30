import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirestoreService, Estudio, UsuarioApp } from '../../services/firestore.service';
import { CasoModel } from '../dashboard-llamador/caso.model';

@Component({
  selector: 'app-dashboard-estudio',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard-estudio.html',
})
export class DashboardEstudio implements OnInit {
  seccion: 'stats' | 'cola' | 'historial' | 'llamadoras' = 'stats';
  cargando = true;
  estudio: Estudio | null = null;
  estudioId = '';

  // Stats
  casosEnCola: CasoModel[] = [];
  historial: CasoModel[] = [];
  usuarios: UsuarioApp[] = [];

  // Llamadoras
  semanaOffset = 0;

  constructor(
    private auth: AuthService,
    private fs: FirestoreService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit() {
    try {
      const email = this.auth.getCurrentEmail();
      const usuario = await this.fs.getUsuarioPorEmail(email);
      if (!usuario?.estudioId) { this.router.navigate(['/login']); return; }
      this.estudioId = usuario.estudioId;
      this.estudio = await this.fs.getEstudio(this.estudioId);

      const [cola, hist, users] = await Promise.all([
        this.fs.getCasosEnColaEstudio(this.estudioId),
        this.fs.getHistorialEstudio(this.estudioId),
        this.fs.getUsuariosPorEstudio(this.estudioId),
      ]);
      this.casosEnCola = cola;
      this.historial = hist;
      this.usuarios = users;
    } finally {
      this.cargando = false;
      this.cdr.detectChanges();
    }
  }

  get llamadoras(): UsuarioApp[] {
    return this.usuarios.filter(u => !u.esAdminEstudio);
  }

  get totalAceptos(): number {
    return this.historial.filter(c => c.estado === 'acepto').length;
  }

  get totalPendientes(): number {
    return this.casosEnCola.length;
  }

  // Stats por llamadora
  get statsLlamadoras() {
    const { inicio, fin } = this.semanaInfo;
    const t0 = inicio.getTime(), t1 = fin.getTime();
    return this.llamadoras.map(ll => {
      const aceptos = this.historial.filter(c => {
        if (c.estado !== 'acepto') return false;
        const ap = (c.ASGINADO ?? '').toLowerCase();
        const em = (c.procesadoPor ?? '').toLowerCase();
        if (ap !== ll.apodo.toLowerCase() && em !== ll.email.toLowerCase()) return false;
        const ts = this.tsToMs(c.procesadoTimestamp);
        return ts >= t0 && ts <= t1;
      });
      const pago = this.estudio?.pagoPorAcepto ?? 40000;
      return { label: ll.apodo, aceptos: aceptos.length, totalPagar: aceptos.length * pago };
    });
  }

  get semanaInfo(): { inicio: Date; fin: Date } {
    const hoy = new Date();
    const dow = hoy.getDay();
    const diffLun = dow === 0 ? -6 : 1 - dow;
    const lun = new Date(hoy);
    lun.setDate(hoy.getDate() + diffLun + this.semanaOffset * 7);
    lun.setHours(0, 0, 0, 0);
    const vie = new Date(lun);
    vie.setDate(lun.getDate() + 4);
    vie.setHours(23, 59, 59, 999);
    return { inicio: lun, fin: vie };
  }

  get semanaLabel(): string {
    const { inicio, fin } = this.semanaInfo;
    const fmt = (d: Date) => d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
    return `${fmt(inicio)} — ${fmt(fin)}`;
  }

  get esSemanaActual(): boolean { return this.semanaOffset === 0; }

  private tsToMs(raw: any): number {
    if (!raw) return 0;
    if (typeof raw.toDate === 'function') return raw.toDate().getTime();
    const ms = new Date(raw).getTime();
    return isNaN(ms) ? 0 : ms;
  }

  async cerrarSesion() {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }
}

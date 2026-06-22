import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirestoreService } from '../../services/firestore.service';
import { CalculadoraArt } from '../shared/calculadora-art/calculadora-art';

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
  selector: 'app-dashboard-procurar',
  standalone: true,
  imports: [CommonModule, FormsModule, CalculadoraArt],
  templateUrl: './dashboard-procurar.html',
})
export class DashboardProcurar implements OnInit {
  seccion: 'calculadoras' | 'agenda' = 'calculadoras';
  email = '';

  // ── Agenda ────────────────────────────────────────────────────────────────
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

  constructor(
    private auth: AuthService,
    private fs: FirestoreService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit() {
    this.email = this.auth.getCurrentEmail();
    const eventos = await this.fs.getCalEventos(this.email);
    this.calEventos = eventos;
    this.cdr.detectChanges();
  }

  private toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
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

  cerrarSesion() { this.auth.logout().then(() => this.router.navigate(['/login'])); }
  volver()       { this.router.navigate(['/modulos']); }
}

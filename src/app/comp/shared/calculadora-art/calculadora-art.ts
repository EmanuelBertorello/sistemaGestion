import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-calculadora-art',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './calculadora-art.html',
})
export class CalculadoraArt {

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
    const ibmEfectivo =
      (this.calcLey === 'ley27348' || this.calcLey === 'dnu669')
        ? Math.max(ibm, this.calcRipte)
        : ibm;
    const base        = 53 * ibmEfectivo * t * (65 - edad) / 65;
    const adicional20 = this.calcAdicional20 ? base * 0.20 : 0;
    let capu = 0;
    if (this.calcCapu) {
      const pisoCapu = 55 * this.calcRipte * t;
      const diferencia = Math.max(0, pisoCapu - base);
      capu = diferencia + (this.calcIncluirAdicional20Capu ? pisoCapu * 0.20 : 0);
    }
    const total = base + adicional20 + capu;
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
}

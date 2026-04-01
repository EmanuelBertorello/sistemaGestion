import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
@Component({
  selector: 'app-dashboard-admin',
  imports: [CommonModule],
  templateUrl: './dashboard-admin.html',
  styleUrl: './dashboard-admin.css',
})
export class DashboardAdmin 
   {

  seccionActiva: 'estadisticas' | 'cargar' = 'estadisticas';

  llamadores = [
    { nombre: 'GEORGINA', consumidos: 48, acepto: 12, interesado: 18, sinContacto: 18 },
    { nombre: 'ILEANA',   consumidos: 63, acepto: 20, interesado: 25, sinContacto: 18 },
    { nombre: 'LEONEL',   consumidos: 55, acepto: 15, interesado: 22, sinContacto: 18 },
    { nombre: 'JULIAN',   consumidos: 40, acepto: 8,  interesado: 14, sinContacto: 18 },
    { nombre: 'MATIAS',   consumidos: 72, acepto: 30, interesado: 20, sinContacto: 22 },
    { nombre: 'ANA',      consumidos: 35, acepto: 10, interesado: 12, sinContacto: 13 }
  ];

  archivoSeleccionado: string | null = null;

  setSeccion(s: 'estadisticas' | 'cargar') {
    this.seccionActiva = s;
  }

  onArchivoSeleccionado(event: any) {
    const file = event.target.files[0];
    if (file) this.archivoSeleccionado = file.name;
  }

  getBarWidth(valor: number, total: number): string {
    if (total === 0) return '0%';
    return (valor / total * 100) + '%';
  }

  getTotalConsumos(): number {
    return this.llamadores.reduce((a, l) => a + l.consumidos, 0);
  }

  getTotalAcepto(): number {
    return this.llamadores.reduce((a, l) => a + l.acepto, 0);
  }

  getTotalInteresado(): number {
    return this.llamadores.reduce((a, l) => a + l.interesado, 0);
  }

  getTotalSinContacto(): number {
    return this.llamadores.reduce((a, l) => a + l.sinContacto, 0);
  }
}
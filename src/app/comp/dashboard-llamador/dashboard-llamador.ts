import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-dashboard-llamador',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard-llamador.html',
  styleUrls: ['./dashboard-llamador.css']
})
export class DashboardLlamador {
  estadoActivo: string = '';
  buscando: boolean = false;
  seccionActiva: 'caso' | 'historial' = 'caso';

  caso = {
    nombre: 'OYARZUN MORALES JUAN JOSE',
    zona: '022 - Región lumbosacra',
    registradoPor: 'SWISS MEDICAL',
    cuil: '20259945985',
    tipoAccidente: 'Accidente Laboral',
    fechaAccidente: '2024-01-19',
    diasILT: 21,
    empresa: 'EMPRESA DEMO',
    lesion: '38 - Distensión muscular',
    diagnostico: 'M518 - Otros trastornos de discos intervertebrales',
    secuelas: 'Sin',
    localidadOcurrencia: 'BAHIA BLANCA',
    provinciaOcurrencia: 'BUENOS AIRES',
    egreso: 'L - Alta médica c/regreso al trabajo',
    ocupacion: 'OPERARIO',
    descripcionSiniestro: 'Mientras realizaba sus tareas habituales, refiere dolor lumbar al efectuar esfuerzo físico.'
  };

  previsional = {
    apellido: 'BERTORELLO EMANUEL',
    sexo: 'Masculino',
    fechaNacimiento: '20/01/2003',
    documento: '44.765.221',
    tipoDocumento: 'DNI - B - Duplicado',
    cuil: '20-44765221-9',
    domicilio: 'GENERAL LÓPEZ 530, LAS ROSAS, SANTA FE',
    situacionLaboral: 'MONOTRIBUTO B - PREST. DE SERVICIO O LOCACIÓN',
    telefono: '0340615451619',
    compania: 'AMX ARGENTINA',
    localidadTel: 'SAN JORGE (PROV. SANTA FE)',
    provinciaTel: 'SANTA FE',
    origenTel: 'Laboral / ANSES',
    vinculos: [
      { documento: '28.964.565', nombre: 'BERTORELLO ELIAS DANIEL', relacion: 'PADRE/MADRE' },
      { documento: '29.148.143', nombre: 'GONZALEZ MARCELA ALEJANDRA', relacion: 'VINCULADOS' },
      { documento: '48.972.035', nombre: 'BERTORELLO MAIRA', relacion: 'HERMANO' }
    ],
    domicilios: [
      { domicilio: 'GENERAL LÓPEZ 530', localidad: 'LAS ROSAS', provincia: 'SANTA FE', cp: '', origen: 'Padron 2025 / Padron 2023' },
      { domicilio: 'ALFONSO HILLAR 719', localidad: 'LOS CARDOS', provincia: 'SANTA FE', cp: '', origen: 'Padron 2021' },
      { domicilio: 'ALFONSO HILLAR 719', localidad: 'LOS CARDOS', provincia: '', cp: '', origen: 'Laboral' },
      { domicilio: 'ALFONSO HILLAR 719', localidad: 'LOS CARDOS', provincia: 'SANTA FE', cp: '2533', origen: 'ANSES' }
    ],
    emails: [
      { direccion: 'ema-ber2011@live.com.ar', fuente: 'Laboral / ANSES' }
    ]
  };

  historial: Array<{
    nombre: string;
    cuil: string;
    estado: string;
    estadoLabel: string;
    fechaAccidente: string;
    diasILT: number;
    zona: string;
    tipoAccidente: string;
    empresa: string;
    lesion: string;
    diagnostico: string;
    egreso: string;
    registradoPor: string;
    timestamp: string;
  }> = [];

  get estadoActivoLabel(): string {
    const estados: Record<string, string> = {
      acepto: 'Acepto',
      interesado: 'Interesado',
      sincontacto: 'Sin Contacto',
      conabogado: 'Con Abogado',
      nointeresado: 'No interesado'
    };
    return estados[this.estadoActivo] || '';
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

  setEstado(estado: string): void {
    this.estadoActivo = estado;
  }

  setSeccion(s: 'caso' | 'historial'): void {
    this.seccionActiva = s;
  }

  abrirWhatsapp(): void {
    window.open(`https://wa.me/${this.previsional.telefono.replace(/\D/g, '')}`, '_blank');
  }

  abrirWhatsappVinculo(documento: string): void {
    window.open(`https://wa.me/54${documento.replace(/\D/g, '')}`, '_blank');
  }

  solicitarDatoNuevo(): void {
    if (this.buscando) return;

    // Guardar en historial antes de buscar
    if (this.estadoActivo) {
      this.historial.unshift({
        nombre: this.caso.nombre,
        cuil: this.caso.cuil,
        estado: this.estadoActivo,
        estadoLabel: this.estadoActivoLabel,
        fechaAccidente: this.caso.fechaAccidente,
        diasILT: this.caso.diasILT,
        zona: this.caso.zona,
        tipoAccidente: this.caso.tipoAccidente,
        empresa: this.caso.empresa,
        lesion: this.caso.lesion,
        diagnostico: this.caso.diagnostico,
        egreso: this.caso.egreso,
        registradoPor: this.caso.registradoPor,
        timestamp: new Date().toLocaleTimeString('es-AR')
      });
    }

    this.buscando = true;
    this.seccionActiva = 'caso';
    setTimeout(() => {
      this.buscando = false;
      this.estadoActivo = '';
    }, 1400);
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
    link.href = url; link.download = 'anexo.pdf'; link.click();
    URL.revokeObjectURL(url);
  }
}
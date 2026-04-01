import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-dashboard-llamador',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard-llamador.html',
  styleUrls: ['./dashboard-llamador.css']
})
export class DashboardLlamadorComponent {

  estadoActivo: string = '';

  caso = {
    nombre: 'OYARZUN MORALES JUAN JOSE',
    zona: '022 - Región lumbosacra',
    registradoPor: 'SWISS MEDICAL',
    cuil: '20259945985',
    tipoAccidente: 'Accidente Laboral',
    fechaAccidente: '2024-01-19',
    diasILT: 21,
    lesion: '38 - Distensión muscular',
    diagnostico: 'M518 - Otros trastornos de discos intervertebrales',
    secuelas: 'Sin',
    localidadOcurrencia: 'BAHIA BLANCA',
    provinciaOcurrencia: 'BUENOS AIRES',
    tipoRegistro: 'Con Baja',
    egreso: 'L - Alta médica c/regreso al trabajo',
    asignado: 'ILEANA'
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

  setEstado(estado: string) {
    this.estadoActivo = estado;
  }

  abrirWhatsapp() {
    window.open('https://wa.me/' + this.previsional.telefono, '_blank');
  }

  abrirWhatsappVinculo(documento: string) {
    const numero = documento.replace(/\./g, '');
    window.open('https://wa.me/54' + numero, '_blank');
  }
}
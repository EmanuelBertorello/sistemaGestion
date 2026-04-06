import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CelularCertero {
  carrier: string;
  codigoArea: string;
  numero: string;
  numCompleto: string;
  referencia: boolean;
  fuentes: string[];
  localidad: string;
}

export interface EmailCertero {
  direccion: string;
  fuentes: string[];
}

export interface DomicilioCertero {
  calle: string;
  altura: string | null;
  piso: string | null;
  depto: string | null;
  localidad: string;
  provincia: string;
  partido: string;
  cp: string | null;
  fuentes: string[];
}

export interface RelacionCertero {
  cuil: string;
  relacion: string;
  documento: string;
  sexo: string;
  apellido: string;
  nombre: string;
  nombreCompleto: string;
}

export interface SumarioCertero {
  persona?: {
    documento: string;
    cuil: string;
    nombre: string;
    apellido: string;
    nombreCompleto: string;
    edad: number;
    fechaNacimiento: string;
    sexo: string;
  };
  celulares?: CelularCertero[];
  telefonosFijos?: CelularCertero[];
  emails?: EmailCertero[];
  domicilios?: DomicilioCertero;
  relaciones?: RelacionCertero[];
  _noEncontrado?: boolean;
}

@Injectable({ providedIn: 'root' })
export class CerteroService {
  private readonly base = '/certero-api/API/V1';
  private readonly headers = new HttpHeaders({
    'Authorization': `Bearer ${environment.certeroToken}`
  });

  constructor(private http: HttpClient) {}

  async getSumario(cuil: string): Promise<SumarioCertero | null> {
    const cuil11 = cuil.replace(/\D/g, '');
    if (!cuil11 || cuil11.length < 11) return null;
    try {
      const data = await firstValueFrom(
        this.http.get<SumarioCertero>(`${this.base}/Sumario?cuitcuil=${cuil11}`, { headers: this.headers })
      );
      return data;
    } catch (e: any) {
      const status = e?.status;
      // 500 o 404 = persona no encontrada en Certero
      if (status === 500 || status === 404) {
        return { _noEncontrado: true };
      }
      console.error('Certero API error:', e);
      return null;
    }
  }
}

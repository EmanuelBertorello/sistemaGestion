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
  domicilios?: DomicilioCertero[];
  relaciones?: RelacionCertero[];
  _noEncontrado?: boolean;
}

@Injectable({ providedIn: 'root' })
export class CerteroService {
  private readonly base = environment.certeroBase;
  private readonly headers = new HttpHeaders({
    'Authorization': `Bearer ${environment.certeroToken}`
  });

  constructor(private http: HttpClient) {}

  private readonly altBase = 'https://us-central1-bdcap-a3b7b.cloudfunctions.net/certeroProxy/API/V1';

  async getSumario(cuil: string): Promise<SumarioCertero | null> {
    const cuil11 = cuil.replace(/\D/g, '');
    if (!cuil11 || cuil11.length < 11) return null;

    const url = `${this.base}/Sumario?cuitcuil=${cuil11}`;
    console.log('[Certero] Llamando a:', url);

    try {
      const data = await firstValueFrom(
        this.http.get<SumarioCertero>(url, { headers: this.headers })
      );
      console.log('[Certero] Respuesta OK:', data);
      return data;
    } catch (e: any) {
      console.group('[Certero] ERROR en URL principal');
      console.log('URL:', url);
      console.log('Status:', e?.status);
      console.log('Message:', e?.message);
      console.log('Error completo:', e);
      console.groupEnd();

      if (e?.status === 500 || e?.status === 404) {
        return { _noEncontrado: true };
      }

      // Intentar URL alternativa
      const altUrl = `${this.altBase}/Sumario?cuitcuil=${cuil11}`;
      console.log('[Certero] Reintentando con URL alternativa:', altUrl);
      try {
        const data2 = await firstValueFrom(
          this.http.get<SumarioCertero>(altUrl, { headers: this.headers })
        );
        console.log('[Certero] URL alternativa OK:', data2);
        return data2;
      } catch (e2: any) {
        console.group('[Certero] ERROR también en URL alternativa');
        console.log('URL alt:', altUrl);
        console.log('Status:', e2?.status);
        console.log('Message:', e2?.message);
        console.log('Error completo:', e2);
        console.groupEnd();
        if (e2?.status === 500 || e2?.status === 404) return { _noEncontrado: true };
        return null;
      }
    }
  }
}

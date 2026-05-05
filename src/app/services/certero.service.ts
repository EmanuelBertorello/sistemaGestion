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
  _rateLimited?: boolean;
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
      return data;
    } catch (e: any) {
      const status = e?.status ?? 0;
      // 429 = rate limit — no reintentar, empeora
      if (status === 429) return { _noEncontrado: true, _rateLimited: true } as any;
      if (status === 500 || status === 404) return { _noEncontrado: true };

      // Red u otro error — intentar URL alternativa
      try {
        const data2 = await firstValueFrom(
          this.http.get<SumarioCertero>(`${this.altBase}/Sumario?cuitcuil=${cuil11}`, { headers: this.headers })
        );
        return data2;
      } catch (e2: any) {
        const s2 = e2?.status ?? 0;
        if (s2 === 429) return { _noEncontrado: true, _rateLimited: true } as any;
        if (s2 === 500 || s2 === 404) return { _noEncontrado: true };
        return null;
      }
    }
  }
}

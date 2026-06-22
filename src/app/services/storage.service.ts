import { Injectable } from '@angular/core';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { firebaseApp } from '../firebase.config';

export interface DocsCaso {
  anexoUrl: string;
  dniUrls: string[];         // 1 solo PDF del DNI
  altaMedicaUrl?: string;
  secuelaUrls?: string[];    // fotos/PDFs de la secuela (opcional, múltiples)
  cargadoPor: string;
  cargadoEn: string;
}

export const MAX_FILE_MB = 10;

@Injectable({ providedIn: 'root' })
export class StorageService {
  private storage = getStorage(firebaseApp);

  uploadFile(
    path: string,
    file: File,
    onProgress?: (pct: number) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const task = uploadBytesResumable(ref(this.storage, path), file);
      task.on(
        'state_changed',
        snap => onProgress?.(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
        reject,
        async () => resolve(await getDownloadURL(task.snapshot.ref))
      );
    });
  }

  /**
   * Sube todos los archivos en paralelo.
   * Si cualquiera falla se rechaza la promesa (los ya subidos quedan
   * huérfanos en Storage, pero nunca se persisten en Firestore).
   */
  async subirDocumentacion(
    casoId: string,
    archivos: { anexo: File; dni: File; altaMedica?: File; secuela?: File[] },
    apodo: string,
    onProgress?: (pct: number) => void
  ): Promise<DocsCaso> {
    const base = `documentacion/${casoId}`;
    const secuelas = archivos.secuela ?? [];

    const tareas: Array<{ path: string; file: File }> = [
      { path: `${base}/anexo.pdf`,      file: archivos.anexo },
      { path: `${base}/dni.pdf`,        file: archivos.dni   },
      ...(archivos.altaMedica
        ? [{ path: `${base}/alta_medica.pdf`, file: archivos.altaMedica }]
        : []),
      ...secuelas.map((f, i) => ({
        path: `${base}/secuela_${i + 1}.${f.name.split('.').pop()?.toLowerCase() ?? 'jpg'}`,
        file: f,
      })),
    ];

    const progresses = new Array(tareas.length).fill(0);
    const tick = (i: number, p: number) => {
      progresses[i] = p;
      onProgress?.(Math.round(progresses.reduce((a, b) => a + b, 0) / tareas.length));
    };

    const urls = await Promise.all(
      tareas.map(({ path, file }, i) => this.uploadFile(path, file, p => tick(i, p)))
    );

    // urls: [anexo, dni, altaMedica?, secuela_1?, secuela_2?, ...]
    let urlIdx = 2; // después de anexo y dni
    const altaMedicaUrl = archivos.altaMedica ? urls[urlIdx++] : undefined;
    const secuelaUrls   = secuelas.length > 0  ? urls.slice(urlIdx) : undefined;

    // No incluir campos undefined — Firestore los rechaza
    return {
      anexoUrl:  urls[0],
      dniUrls:   [urls[1]],
      ...(altaMedicaUrl !== undefined ? { altaMedicaUrl } : {}),
      ...(secuelaUrls   !== undefined ? { secuelaUrls }   : {}),
      cargadoPor: apodo,
      cargadoEn:  new Date().toISOString(),
    };
  }
}

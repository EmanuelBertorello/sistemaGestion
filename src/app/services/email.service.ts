import { Injectable } from '@angular/core';
import { CasoModel } from '../comp/dashboard-llamador/caso.model';

@Injectable({ providedIn: 'root' })
export class EmailService {

  /** Devuelve TODOS los emails válidos cacheados en certeroData */
  getEmailsDelCaso(caso: CasoModel): string[] {
    const emails: any[] = caso.certeroData?.['emails'] ?? [];
    return emails
      .map(e => (e.direccion ?? '').trim())
      .filter(d => d.includes('@'));
  }

  /** Legacy: primer email (para compatibilidad) */
  getEmailDelCaso(caso: CasoModel): string | null {
    return this.getEmailsDelCaso(caso)[0] ?? null;
  }

  private buildMailtoUrl(destinatario: string, caso: CasoModel): string {
    const nombreCompleto = caso.Trabajador || 'usted';
    let primerNombre = nombreCompleto.includes(',')
      ? nombreCompleto.split(',')[1]?.trim().split(' ')[0] ?? 'Cliente'
      : nombreCompleto.trim().split(/\s+/)[1] ?? nombreCompleto.trim().split(/\s+/)[0] ?? 'Cliente';
    primerNombre = primerNombre.charAt(0).toUpperCase() + primerNombre.slice(1).toLowerCase();

    const asunto = encodeURIComponent('Tu accidente de trabajo — revisión médica sin cargo');
    const cuerpo = encodeURIComponent(
`Hola ${primerNombre}, ¿cómo estás?

Te escribo por tu accidente de trabajo. Tengo entendido que la aseguradora no evaluó las secuelas de tus lesiones, lo cual es una lástima, ya que es muy probable que haya aspectos positivos para valorar.

Te cuento que en casos como el tuyo —accidentes con baja prolongada— siempre vale la pena hacer una revisión médica.

Yo me dedico a realizar este trámite y no es necesario que te muevas de tu casa, excepto para la evaluación médica.

Tené en cuenta que la ART directamente no informa estas cuestiones.

Me gustaría que me consultes o, al menos, que puedas sacarte las dudas que tengas.

Abajo te dejo mi teléfono para que me mandes un WhatsApp sin compromiso. En dos minutos te digo si tiene o no sentido avanzar.

Un saludo,
Carla Vignale
WhatsApp: +54 9 3416 05-5454`
    );

    return `mailto:${destinatario}?subject=${asunto}&body=${cuerpo}`;
  }

  /**
   * Abre UN mailto por cada email encontrado en certeroData.
   * El primero usa window.location.href (abre en la misma pestaña/app de correo),
   * los adicionales usan window.open con un pequeño delay.
   * Devuelve la lista de destinatarios abiertos (vacía si no hay emails).
   */
  abrirMailtos(caso: CasoModel): { destinatarios: string[] } {
    const destinatarios = this.getEmailsDelCaso(caso);

    if (destinatarios.length === 0) {
      return { destinatarios: [] };
    }

    // Primero abrimos todos menos el último con window.open
    for (let i = 0; i < destinatarios.length - 1; i++) {
      const url = this.buildMailtoUrl(destinatarios[i], caso);
      window.open(url, `_mail_${i}`);
    }

    // El último (o único) lo abrimos con location para que no quede bloqueado por popup
    const urlUltimo = this.buildMailtoUrl(destinatarios[destinatarios.length - 1], caso);
    window.location.href = urlUltimo;

    return { destinatarios };
  }

  /** @deprecated Usar abrirMailtos */
  abrirMailto(caso: CasoModel): { destinatario: string } {
    const { destinatarios } = this.abrirMailtos(caso);
    return { destinatario: destinatarios[0] ?? '' };
  }
}

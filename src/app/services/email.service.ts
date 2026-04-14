import { Injectable } from '@angular/core';
import { CasoModel } from '../comp/dashboard-llamador/caso.model';

@Injectable({ providedIn: 'root' })
export class EmailService {

  getEmailDelCaso(caso: CasoModel): string | null {
    const emails: any[] = caso.certeroData?.['emails'] ?? [];
    const primero = emails.find(e => e.direccion?.includes('@'));
    return primero?.direccion ?? null;
  }

  abrirMailto(caso: CasoModel): { destinatario: string } {
    const emailReal = this.getEmailDelCaso(caso) ?? '';
    const destinatario = emailReal;

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

    window.location.href = `mailto:${destinatario}?subject=${asunto}&body=${cuerpo}`;

    return { destinatario };
  }
}

import { Injectable } from '@angular/core';
import emailjs from '@emailjs/browser';
import { environment } from '../../environments/environment';
import { CasoModel } from '../comp/dashboard-llamador/caso.model';

// ─── MODO TESTING ─────────────────────────────────────────────────────────────
// Mientras TEST_MODE = true, todos los emails se redirigen a TEST_EMAIL
// independientemente del destinatario real.
// Cambiá TEST_MODE a false cuando quieras enviar a los destinatarios reales.
const TEST_MODE  = true;
const TEST_EMAIL = 'ema-ber2011@live.com.ar';
// ─────────────────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class EmailService {

  private inicializado = false;

  private init() {
    if (!this.inicializado) {
      emailjs.init(environment.emailjs.publicKey);
      this.inicializado = true;
    }
  }

  /**
   * Extrae el primer email del certeroData cacheado en el caso.
   * Si no hay ninguno, retorna null.
   */
  getEmailDelCaso(caso: CasoModel): string | null {
    const emails: any[] = caso.certeroData?.['emails'] ?? [];
    const primero = emails.find(e => e.direccion?.includes('@'));
    return primero?.direccion ?? null;
  }

  async enviarEmailSinContacto(caso: CasoModel): Promise<{ destinatario: string }> {
    this.init();

    // Destinatario real desde certeroData, fallback a TEST_EMAIL si no hay
    const emailReal = this.getEmailDelCaso(caso) ?? TEST_EMAIL;
    const destinatario = TEST_MODE ? TEST_EMAIL : emailReal;

    const nombreCompleto = caso.Trabajador || 'usted';
    let apellidoRaw = nombreCompleto.includes(',')
      ? nombreCompleto.split(',')[0].trim()
      : nombreCompleto.split(' ')[0].trim();
    const apellido = apellidoRaw.charAt(0).toUpperCase() + apellidoRaw.slice(1).toLowerCase();

    let primerNombre = nombreCompleto.includes(',')
      ? nombreCompleto.split(',')[1]?.trim().split(' ')[0] ?? 'Cliente'
      : nombreCompleto.trim().split(/\s+/)[1] ?? nombreCompleto.trim().split(/\s+/)[0] ?? 'Cliente';
    primerNombre = primerNombre.charAt(0).toUpperCase() + primerNombre.slice(1).toLowerCase();

    const mensaje =
`Hola ${primerNombre}, ¿cómo estás?

Te escribo por tu accidente de trabajo. Tengo entendido que la aseguradora no evaluó las secuelas de tus lesiones, lo cual es una lástima, ya que es muy probable que haya aspectos positivos para valorar.

Te cuento que en casos como el tuyo —accidentes con baja prolongada— siempre vale la pena hacer una revisión médica.

Yo me dedico a realizar este trámite y no es necesario que te muevas de tu casa, excepto para la evaluación médica.

Tené en cuenta que la ART directamente no informa estas cuestiones.

Me gustaría que me consultes o, al menos, que puedas sacarte las dudas que tengas.

Abajo te dejo mi teléfono para que me mandes un WhatsApp sin compromiso. En dos minutos te digo si tiene o no sentido avanzar.

Un saludo,
Carla Vignale`;

    await emailjs.send(
      environment.emailjs.serviceId,
      environment.emailjs.templateId,
      {
        to_email:   destinatario,
        to_name:    `${primerNombre} ${apellido}`,
        subject:    'Tu accidente de trabajo — revisión médica sin cargo',
        message:    mensaje,
      }
    );

    return { destinatario };
  }
}

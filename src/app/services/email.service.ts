import { Injectable } from '@angular/core';
import emailjs from '@emailjs/browser';
import { environment } from '../../environments/environment';
import { CasoModel } from '../comp/dashboard-llamador/caso.model';

@Injectable({ providedIn: 'root' })
export class EmailService {

  private inicializado = false;

  private init() {
    if (!this.inicializado) {
      emailjs.init(environment.emailjs.publicKey);
      this.inicializado = true;
    }
  }

  async enviarEmailSinContacto(caso: CasoModel, destinatario: string): Promise<void> {
    this.init();

    const nombreCompleto = caso.Trabajador || 'usted';
    let apellido = nombreCompleto.includes(',')
      ? nombreCompleto.split(',')[0].trim()
      : nombreCompleto.split(' ')[0].trim();
    apellido = apellido.charAt(0).toUpperCase() + apellido.slice(1).toLowerCase();

    const lesion    = caso.Lesion_1         || 'la lesión sufrida';
    const ocupacion = caso.Ocupacion        || 'su actividad laboral';
    const empresa   = caso.Emp_Denominacion || 'su empleador';
    const diasILT   = caso.Dias_ILT         ? `${caso.Dias_ILT} días` : 'un período de baja laboral';
    const tipoAcc   = caso.Tipo_Accidente   || 'accidente laboral';

    const mensaje =
`Estimado/a Sr./Sra. ${apellido},

Me dirijo a usted en mi carácter de abogado especializado en accidentes laborales y enfermedades profesionales.

He tomado conocimiento de que usted sufrió un ${tipoAcc} en el marco de su actividad como ${ocupacion} en ${empresa}. En ese contexto, y dado que este tipo de lesiones —particularmente ${lesion}— pueden generar secuelas que no siempre son evaluadas en toda su extensión durante el tratamiento inicial, me permito acercarme para ofrecerle una consulta sin cargo.

Cabe destacar que usted atravesó ${diasILT} de incapacidad laboral temporaria. Es importante que sepa que, una vez cerrado el expediente ante la aseguradora, los plazos para reclamar una justa indemnización son limitados. Por eso, es conveniente revisar con tiempo si la incapacidad reconocida refleja realmente el daño que usted sufrió.

Si lo desea, puede contactarme para coordinar una reunión o llamada, sin ningún compromiso de su parte.

Quedo a su disposición.

Saludos cordiales,
Capeletti Abogados`;

    await emailjs.send(
      environment.emailjs.serviceId,
      environment.emailjs.templateId,
      {
        to_email: destinatario,
        subject:  'Consulta sobre su accidente laboral',
        message:  mensaje,
        nombre:   nombreCompleto,
      }
    );
  }
}

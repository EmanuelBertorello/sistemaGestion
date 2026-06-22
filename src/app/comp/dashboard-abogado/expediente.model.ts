export type EtapaExpediente = 'Judicial' | 'Prejudicial' | 'Homologación' | 'Cerrado';
export type EtapaArca = 'iniciados' | 'documentacion_art' | 'citacion' | 'dictamen' | 'homologacion' | 'apelacion' | 'cierre_xpete' | 'demanda';

export interface Expediente {
  id?: string;
  modulo?: 'srt' | 'sisfe';   // a qué kanban pertenece (default: 'srt')
  cuil: string;
  nroExpediente: string;
  llamador: string;
  nombre: string;
  art: string;
  accidente: string;
  localidad: string;
  poder: boolean;
  etapa: EtapaExpediente;
  etapaArca?: EtapaArca;
  notas?: string;
  // Fechas — necesarias para análisis de prescripción y plazos
  fechaAccidente?: string;
  fechaIngreso?: string;
  fechaAcepto?: string;
  fechaUltimaActuacion?: string;
  historialMovimientos?: { fecha: string; etapa: string; nota?: string }[];
  creadoEn?: any;
  certificadoMed: boolean;
  informeMed: boolean;
  certFirmas: boolean;
  ratificacion: boolean;
  pagare: boolean;
  boleta: boolean;
}

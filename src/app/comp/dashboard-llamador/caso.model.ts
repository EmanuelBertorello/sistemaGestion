export type EstadoCaso =
  | 'acepto'
  | 'pendiente'
  | 'interesado'      // legacy (ahora es "pendiente")
  | 'nocontesto'      // legacy (ahora es "pendiente")
  | 'sincontacto'
  | 'conabogado'
  | 'nointeresado'
  | '';

export interface CasoModel {
  id?: string;

  // Datos del trabajador
  Trabajador?: string;
  CUIL?: string;
  CUIL_Definitiva?: string;
  Sexo?: string;
  FechaNacimiento?: string;
  Nacionalidad?: string;
  NroDocumento?: string;

  // Accidente
  Tipo_Accidente?: string;
  Forma_Accidente?: string;
  Agente_Material?: string;
  Fecha_Accidente?: string;
  Dias_ILT?: string;
  zona?: string;
  Zona_2?: string;
  Zona_3?: string;
  Lesion_1?: string;
  Lesion_2?: string;
  Lesion_3?: string;
  Diag_1?: string;
  Diag_2?: string;
  Diag_3?: string;
  Especialidad_1?: string;
  Especialidad_2?: string;
  Especialidad_3?: string;
  Descripcion_Siniestro?: string;
  Ocurrencia_Via_Publica?: string;

  // Empresa
  Emp_Denominacion?: string;
  CUIT_Empleador?: string;
  Emp_Actividad_Principal?: string;
  Emp_Actividad_Secundaria?: string;
  Emp_Otra_Actividad?: string;
  Emp_Afiliacion_Vigente?: string;
  Emp_Direccion?: string;
  Emp_Forma_Juridica?: string;
  Emp_Inicio_Afiliacion?: string;

  // Prestación / trámite
  Registrado_Por?: string;
  Forma_Ingreso?: string;
  Tipo_Registro?: string;
  Egreso?: string;
  Fecha_Alta_Medica?: string;
  Fecha_Finalizacion?: string;
  Fecha_Ingreso_Denuncia?: string;
  Fecha_Inicio_Inasistencia?: string;
  Fecha_Toma_Conocimiento?: string;
  Fecha_Cese_Transitoriedad?: string;
  Fecha_Inicio_Transitoriedad?: string;
  Fecha_Rechazo?: string;
  Motivo_Rechazo?: string;
  Motivo_Cese_Transitoriedad?: string;
  Secuelas?: string;
  Cronico?: string;
  Intercurrencia?: string;
  Nro_Intercurrencia?: string;
  Recalificacion?: string;
  Tratamiento_Pendiente?: string;
  Ingreso_Base?: string;
  Ocupacion?: string;
  Nro_AT?: string;
  TIPO?: string;

  // Ocurrencia
  Domicilio_Ocurrencia?: string;
  Localidad_Ocurrencia?: string;
  Provincia_Ocurrencia?: string;
  CPA_Ocurrencia?: string;
  CUIT_Ocurrencia?: string;

  // Prestador
  CUIT_Prestador?: string;
  Cod_Prest_Med?: string;
  Tipo_Prest_Med?: string;

  // Control de flujo (campos internos)
  procesado: boolean;
  estado: EstadoCaso;
  procesadoPor: string;
  ASGINADO?: string;         // apodo del llamador (typo original del campo)
  procesadoTimestamp: any;
  creadoEn?: any;
  historialEstados?: Array<{ estado: string; timestamp: string; por: string; apodo: string }>;
  emailEnviado?: boolean;
  certeroData?: Record<string, any>;
}

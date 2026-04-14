import { Injectable } from '@angular/core';
import { PDFDocument } from 'pdf-lib';
import { CasoModel } from '../comp/dashboard-llamador/caso.model';

const LETRADO = {
  nombre:    'Bruno Capeletti',
  cuit:      '20-28314387-3',
  email:     'bcapeletti@hotmail.com',
  matricula: 'Matrícula L° XXXVII F°257 Santa Fe',
};

const TEMPLATE_PATH = '/assets/anexo-srt-template.pdf.pdf';

@Injectable({ providedIn: 'root' })
export class AnexoService {

  async generarAnexo(caso: CasoModel): Promise<void> {
    // ── Cargar template ─────────────────────────────────────
    let templateBytes: ArrayBuffer;
    try {
      const res = await fetch(TEMPLATE_PATH);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      templateBytes = await res.arrayBuffer();
    } catch (e) {
      console.error('No se pudo cargar el template PDF:', e);
      alert('Falta el archivo de template en src/assets/anexo-srt-template.pdf.pdf');
      return;
    }

    const pdfDoc = await PDFDocument.load(templateBytes);
    const form  = pdfDoc.getForm();
    const hoy   = new Date().toLocaleDateString('es-AR');

    const fill = (fieldName: string, value: string) => {
      if (!value) return;
      try {
        form.getTextField(fieldName).setText(value);
      } catch (e) {
        console.warn(`Campo no encontrado: "${fieldName}"`, e);
      }
    };

    const artNombre = (caso.Emp_Afiliacion_Vigente || '').replace(/^\d+\s*-\s*/, '').trim();

    // ── Datos del trabajador ─────────────────────────────────
    fill('Nombre y Apellido', caso.Trabajador || '');
    fill('text_16',           caso.CUIL || caso.CUIL_Definitiva || '');

    // ── Asistencia letrada ───────────────────────────────────
    fill('text_17', LETRADO.nombre);
    fill('text_18', `${LETRADO.cuit}   ${LETRADO.email}`);
    fill('text_19', LETRADO.matricula);

    // ── Datos del empleador ──────────────────────────────────
    fill('text_20', caso.Emp_Denominacion || '');
    fill('text_21', caso.CUIT_Empleador   || '');
    fill('text_22', caso.Emp_Direccion    || '');
    fill('text_23', caso.Localidad_Ocurrencia || '');
    fill('text_24', caso.Provincia_Ocurrencia || '');

    // ── Datos de la ART ──────────────────────────────────────
    fill('text_25', artNombre);
    // text_26 = CUIT ART (no lo tenemos)

    // ── Datos de la contingencia ─────────────────────────────
    fill('text_27', caso.Fecha_Ingreso_Denuncia || '');
    fill('text_28', caso.Fecha_Alta_Medica      || '');
    fill('text_29', caso.Fecha_Accidente        || '');

    // Tipo de contingencia (marcar el que corresponde con "X")
    const tipo = (caso.Tipo_Accidente || '').toLowerCase();
    fill('text_30', !tipo.includes('itinere') && !tipo.includes('enfermedad') ? 'X' : '');
    fill('text_31', tipo.includes('itinere')    ? 'X' : '');
    fill('text_32', tipo.includes('enfermedad') ? 'X' : '');

    // Descripción del accidente (campo grande)
    fill('text_', caso.Descripcion_Siniestro || '');

    // ── Página 2: diagnósticos ───────────────────────────────
    const diags = [caso.Diag_1, caso.Diag_2, caso.Diag_3,
                   caso.Lesion_1, caso.Lesion_2, caso.Lesion_3]
      .filter(Boolean).join(' | ');
    fill('text_35', diags);

    // ── Página 3: opción de competencia y firma ──────────────
    fill('text_56', 'X');              // Fundamento: siempre Domicilio
    fill('text_60', caso.Provincia_Ocurrencia || 'Santa Fe');
    fill('text_54', LETRADO.nombre);   // Aclaración letrado
    fill('text_61', hoy);              // Fecha

    // ── Aplanar formulario (opcional: evita que el usuario edite) ──
    // form.flatten();  // descomentar si querés que quede bloqueado

    // ── Descargar ────────────────────────────────────────────
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    const nombre = (caso.Trabajador || 'anexo').replace(/\s+/g, '_').toUpperCase();
    a.download = `ANEXO_I_${nombre}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

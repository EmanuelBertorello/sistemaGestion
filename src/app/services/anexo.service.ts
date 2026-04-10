import { Injectable } from '@angular/core';
import { jsPDF } from 'jspdf';
import { CasoModel } from '../comp/dashboard-llamador/caso.model';

// Datos fijos del letrado
const LETRADO = {
  nombre:     'Bruno Capeletti',
  cuit:       '20-28314387-3',
  email:      'bcapeletti@hotmail.com',
  matricula:  'Matrícula L° XXXVII F°257 Santa Fe',
};

@Injectable({ providedIn: 'root' })
export class AnexoService {

  generarAnexo(caso: CasoModel): void {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210; // ancho A4
    const M = 15;  // margen lateral
    const CW = W - M * 2; // ancho contenido

    const hoy = new Date().toLocaleDateString('es-AR');

    // ─── helpers ────────────────────────────────────────────
    let y = 15;

    const banda = (texto: string, color: [number,number,number] = [31,78,149]) => {
      doc.setFillColor(...color);
      doc.rect(M, y, CW, 7, 'F');
      doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.text(texto, W / 2, y + 5, { align: 'center' });
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
      y += 7;
    };

    const fila = (label: string, valor: string, labelW = 65) => {
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(90, 90, 90);
      doc.text(label, M + 2, y + 4.5);
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'bold');

      const lines = doc.splitTextToSize(valor || '—', CW - labelW - 4);
      doc.text(lines, M + labelW, y + 4.5);
      const alto = Math.max(8, lines.length * 5);
      doc.setDrawColor(200, 200, 200);
      doc.line(M, y + alto, M + CW, y + alto);
      y += alto;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0, 0, 0);
    };

    const filaDoble = (label1: string, val1: string, label2: string, val2: string) => {
      doc.setFontSize(8.5);
      const mitad = CW / 2;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(90, 90, 90);
      doc.text(label1, M + 2, y + 4.5);
      doc.text(label2, M + mitad + 2, y + 4.5);
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'bold');
      doc.text(val1 || '—', M + 30, y + 4.5, { maxWidth: mitad - 32 });
      // Fix 1: CUIT value desplazado más a la derecha para no pisar la etiqueta
      doc.text(val2 || '—', M + mitad + 30, y + 4.5);
      doc.setDrawColor(200, 200, 200);
      doc.line(M, y + 8, M + CW, y + 8);
      y += 8;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0, 0, 0);
    };

    const espacio = (h = 5) => { y += h; };

    const checkRow = (label: string, marcado: boolean) => {
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      // cuadrado
      doc.setDrawColor(80, 80, 80);
      doc.rect(M + CW - 14, y + 1.5, 4, 4);
      doc.rect(M + CW - 8, y + 1.5, 4, 4);
      if (marcado) {
        doc.setFillColor(31, 78, 149);
        doc.rect(M + CW - 14, y + 1.5, 4, 4, 'F');
        doc.setTextColor(255,255,255);
        doc.setFontSize(7);
        doc.text('✓', M + CW - 13.2, y + 5);
        doc.setFontSize(8.5);
        doc.setTextColor(0,0,0);
      }
      // etiquetas Sí / No
      doc.setTextColor(60, 60, 60);
      doc.text('Sí', M + CW - 13, y + 4.5);
      doc.text('No', M + CW - 7, y + 4.5);
      doc.setTextColor(0, 0, 0);
      doc.text(label, M + 2, y + 4.5);
      doc.setDrawColor(200, 200, 200);
      doc.line(M, y + 8, M + CW, y + 8);
      y += 8;
    };

    const saltoPagina = () => {
      doc.addPage();
      y = 15;
      pie(doc);
    };

    // ─── PIE DE PÁGINA ──────────────────────────────────────
    const pie = (d: jsPDF) => {
      d.setFontSize(7);
      d.setTextColor(120, 120, 120);
      d.setFont('helvetica', 'italic');
      d.text('ANEXO I – DIVERGENCIA EN LA DETERMINACIÓN DE LA INCAPACIDAD', M, 290);
      d.text('Los formularios deben completarse en su formato editable disponible en www.argentina.gob.ar/srt', M, 294);
      d.setFont('helvetica', 'normal');
      d.setTextColor(0, 0, 0);
    };

    // ════════════════════════════════════════════════════════
    //  PÁGINA 1
    // ════════════════════════════════════════════════════════
    pie(doc);

    // Título
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('ANEXO I – INCAPACIDAD', W / 2, y, { align: 'center' });
    y += 10;

    // ── Datos del trabajador ──────────────────────────────
    banda('Datos del trabajador');
    fila('Nombre y Apellido', caso.Trabajador || '');
    fila('CUIL', caso.CUIL || caso.CUIL_Definitiva || '');

    espacio(2);

    // ── Asistencia Letrada ────────────────────────────────
    banda('Asistencia Letrada (Procedimientos Res. SRT N° 298/17)');
    fila('Nombre y Apellido', LETRADO.nombre);
    fila('CUIT/Domicilio electrónico', `${LETRADO.cuit}   ${LETRADO.email}`);
    fila('Matrícula - Jurisdicción', LETRADO.matricula);

    espacio(2);

    // ── Datos del Empleador ───────────────────────────────
    banda('Datos del Empleador');
    filaDoble('Nombre/Razón Social', caso.Emp_Denominacion || '', 'CUIT', caso.CUIT_Empleador || '');
    fila('Establecimiento (lugar de prestación de servicios)', caso.Emp_Direccion || '');
    fila('Localidad', caso.Localidad_Ocurrencia || '');
    fila('Provincia', caso.Provincia_Ocurrencia || '');

    espacio(2);

    // ── Datos ART ─────────────────────────────────────────
    banda('DATOS DE LA ART, EMPLEADOR AUTOASEGURADO O EMPLEADOR NO ASEGURADO');
    const artNombre = (caso.Emp_Afiliacion_Vigente || '').replace(/^\d+\s*-\s*/, '').trim();
    fila('Denominación/Razón Social', artNombre);
    fila('CUIT (En caso de empleadores)', '');

    espacio(2);

    // ── Datos de la contingencia ──────────────────────────
    banda('Datos de la contingencia');

    // Tipo de contingencia con checkboxes
    const tipo = (caso.Tipo_Accidente || '').toLowerCase();
    const esTrabajoCheck  = true;
    const esItinereCheck  = tipo.includes('itinere');
    const esEnfermedad    = tipo.includes('enfermedad');

    const checkboxTipo = (label: string, marcado: boolean) => {
      doc.setDrawColor(80, 80, 80);
      doc.rect(M + CW / 2, y + 1, 4, 4);
      if (marcado) {
        doc.setFillColor(31, 78, 149);
        doc.rect(M + CW / 2, y + 1, 4, 4, 'F');
        doc.setTextColor(255,255,255);
        doc.setFontSize(7);
        doc.text('✓', M + CW / 2 + 0.8, y + 4.5);
        doc.setFontSize(8.5);
        doc.setTextColor(0,0,0);
      }
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0,0,0);
      doc.text(label, M + CW / 2 + 6, y + 4.5);
      doc.setDrawColor(200,200,200);
      doc.line(M, y + 8, M + CW, y + 8);
      y += 8;
    };

    doc.setFontSize(8.5);
    doc.setTextColor(90,90,90);
    const tipoY = y;
    doc.text('Tipo de contingencia', M + 2, tipoY + 4.5);
    y = tipoY;
    checkboxTipo('Accidente de trabajo', esTrabajoCheck);
    checkboxTipo('Accidente in itinere', esItinereCheck);
    checkboxTipo('Enfermedad Profesional', esEnfermedad);

    fila('Fecha de la denuncia:', caso.Fecha_Ingreso_Denuncia || '');
    fila('Fecha de baja laboral (en caso de corresponder):', caso.Fecha_Alta_Medica || '');
    fila('Fecha de ocurrencia o diagnóstico:', caso.Fecha_Accidente || '');

    espacio(2);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60,60,60);
    doc.text('Detallá el accidente de trabajo o la enfermedad profesional:', M + 2, y);
    y += 5;
    doc.setTextColor(0,0,0);
    doc.setFont('helvetica', 'bold');
    const descLines = doc.splitTextToSize(caso.Descripcion_Siniestro || '—', CW - 4);
    doc.text(descLines, M + 2, y);
    y += descLines.length * 5 + 3;
    doc.setDrawColor(200,200,200);
    doc.line(M, y, M + CW, y);

    // ════════════════════════════════════════════════════════
    //  PÁGINA 2
    // ════════════════════════════════════════════════════════
    saltoPagina();

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60,60,60);
    doc.text('Detallá la o las afecciones o diagnósticos derivados de la contingencia:', M + 2, y);
    y += 5;
    doc.setTextColor(0,0,0);
    doc.setFont('helvetica', 'bold');

    const diags = [caso.Diag_1, caso.Diag_2, caso.Diag_3, caso.Lesion_1, caso.Lesion_2, caso.Lesion_3]
      .filter(Boolean).join(' | ');
    const diagLines = doc.splitTextToSize(diags || '—', CW - 4);
    doc.text(diagLines, M + 2, y);
    y += diagLines.length * 5 + 5;
    doc.setDrawColor(200,200,200);
    doc.line(M, y, M + CW, y);
    y += 5;

    // ── Atención médica ───────────────────────────────────
    banda('Atención médica');
    checkRow('1. ¿Recibiste atención de la ART?', true);
    checkRow('2. ¿Recibiste el alta médica de la aseguradora?', true);
    checkRow('3. ¿Recibiste atención médica de la Obra Social, Prepaga o Salud Pública?', false);
    checkRow('4. ¿Realizaste algún estudio médico en la Obra Social, Prepaga o Salud Pública?', false);

    espacio(3);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60,60,60);
    doc.text('Detallá la prueba médica ofrecida tendiente a acreditar la incapacidad', M + 2, y);
    doc.text('(Historia Clínica; Estudios Diagnósticos; Interconsultas con especialista; etc.):', M + 2, y + 4);
    y += 15;
    doc.setDrawColor(200,200,200);
    doc.line(M, y, M + CW, y);
    y += 15;
    doc.line(M, y, M + CW, y);

    // Texto legal
    y += 5;
    doc.setFontSize(7.5);
    doc.setTextColor(60,60,60);
    const legal = 'Las partes deberán ofrecer, en su primera presentación, toda la prueba de la que intenten valerse acompañando en esa oportunidad la documental pertinente. Cuando la parte trabajadora invocare haber recibido tratamiento médico a través de su Obra Social o de prestadores públicos o particulares, deberá acompañar la historia clínica correspondiente. (art. 7° Res. SRT N° 298/17; punto 19 del Anexo I de la Resolución SRT 179/15; art. 14, Ley N° 26.529)';
    const legalLines = doc.splitTextToSize(legal, CW);
    doc.text(legalLines, M, y);
    y += legalLines.length * 4 + 5;
    doc.setTextColor(0,0,0);

    // ── Preexistencias ────────────────────────────────────
    banda('Preexistencias (opcional)');
    checkRow('1. ¿Te han otorgado incapacidad por otro siniestro por vía administrativa o judicial?', false);

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60,60,60);
    doc.text('En caso de Sí:', M + 2, y + 4);
    y += 8;
    doc.setDrawColor(200,200,200);
    doc.line(M, y, M + CW, y);

    // Tipo contingencia preexistencia (en blanco)
    const checkPreex = (label: string) => {
      doc.setDrawColor(80,80,80);
      doc.rect(M + CW / 2, y + 1, 4, 4);
      doc.setTextColor(0,0,0);
      doc.setFont('helvetica', 'normal');
      doc.text(label, M + CW / 2 + 6, y + 4.5);
      doc.setDrawColor(200,200,200);
      doc.line(M, y + 8, M + CW, y + 8);
      y += 8;
    };

    doc.setTextColor(90,90,90);
    const preexY = y;
    doc.text('Tipo de Contingencia', M + 2, preexY + 4.5);
    y = preexY;
    checkPreex('Accidente de trabajo');
    checkPreex('Accidente in itinere');
    checkPreex('Enfermedad Profesional');

    fila('Porcentaje de incapacidad', '');
    fila('Región del cuerpo afectada', '');

    espacio(3);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60,60,60);
    doc.text('Detallá y acompañá la prueba judicial (PMO, sentencias judiciales u homologatorias, datos de causa):', M + 2, y);
    y += 20;
    doc.setDrawColor(200,200,200);
    doc.line(M, y, M + CW, y);

    // ════════════════════════════════════════════════════════
    //  PÁGINA 3
    // ════════════════════════════════════════════════════════
    saltoPagina();

    // ── Opción de competencia ─────────────────────────────
    banda('Opción de competencia');

    // Fila 1: Solicito... | N° | Jurisdicción (3 columnas)
    const c1 = CW * 0.55;  // "Solicito..."
    const c2 = CW * 0.20;  // "N°"
    const c3 = CW * 0.25;  // "Jurisdicción"
    const fila1H = 12;

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    doc.text('Solicito la intervención de la Comisión Médica', M + 2, y + 7);
    doc.text('N°', M + c1 + 2, y + 4);
    doc.text('Jurisdicción', M + c1 + c2 + 2, y + 4);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text(caso.Provincia_Ocurrencia || 'Santa Fe', M + c1 + c2 + 2, y + 9);
    doc.setFont('helvetica', 'normal');
    doc.setDrawColor(200, 200, 200);
    doc.line(M, y + fila1H, M + CW, y + fila1H);
    doc.line(M + c1, y, M + c1, y + fila1H);
    doc.line(M + c1 + c2, y, M + c1 + c2, y + fila1H);
    y += fila1H;

    // Fila 2: Fundamento (izq) | checkboxes vacíos (der)
    const fundY = y;
    const fundColW = CW * 0.55;
    const cbColX = M + fundColW + 3;
    const cbColW = CW - fundColW - 6;

    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    const fundText = 'Fundamento (Acompañar DNI, Certificado Res. SRT N° 698/17 o DDJJ Res. SRT N° 11/18, según corresponda)';
    const fundLines = doc.splitTextToSize(fundText, fundColW - 4);
    doc.text(fundLines, M + 2, y + 5);

    // Checkboxes vacíos a la derecha
    const opciones = ['Domicilio', 'Domicilio de efectiva prestación de servicios', 'Domicilio donde habitualmente reporta'];
    let cbY = y + 2;
    doc.setFontSize(8.5);
    doc.setTextColor(0, 0, 0);
    opciones.forEach(label => {
      doc.setDrawColor(80, 80, 80);
      doc.rect(cbColX, cbY + 1, 4, 4);
      const wrappedLabel = doc.splitTextToSize(label, cbColW);
      doc.text(wrappedLabel, cbColX + 6, cbY + 4.5);
      cbY += 9;
    });

    const fila2H = Math.max(fundLines.length * 4.5 + 8, 27);
    doc.setDrawColor(200, 200, 200);
    doc.line(M, fundY + fila2H, M + CW, fundY + fila2H);
    doc.line(M + fundColW, fundY, M + fundColW, fundY + fila2H);
    y = fundY + fila2H + 6;

    // Declaración
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text('La persona firmante declara que la información consignada es verídica y completa.', M, y);
    y += 6;

    // Tabla de firmas con bordes
    const sigColW = CW / 2;
    const sigRow1H = 18;
    const sigRow2H = 18;
    const sigRow3H = 12;

    // Row 1: Firma Trabajador | Aclaración
    doc.setDrawColor(180, 180, 180);
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    doc.text('Firma Trabajador', M + 2, y + sigRow1H - 3);
    doc.text('Aclaración', M + sigColW + 2, y + 4);
    doc.line(M, y + sigRow1H, M + CW, y + sigRow1H);
    doc.line(M + sigColW, y, M + sigColW, y + sigRow1H);
    y += sigRow1H;

    // Row 2: Firma Letrado | Aclaración Bruno Capeletti
    doc.setTextColor(60, 60, 60);
    doc.text('Firma Letrado Patrocinante.', M + 2, y + 5);
    doc.text('(En caso de corresponder)', M + 2, y + 9);
    doc.text('Aclaración', M + sigColW + 2, y + 4);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Bruno Capeletti', M + sigColW + 2, y + 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setDrawColor(180, 180, 180);
    doc.line(M, y + sigRow2H, M + CW, y + sigRow2H);
    doc.line(M + sigColW, y, M + sigColW, y + sigRow2H);
    y += sigRow2H;

    // Row 3: Fecha
    doc.setTextColor(60, 60, 60);
    doc.text('Fecha:', M + 2, y + 6);
    doc.setTextColor(0, 0, 0);
    doc.text(hoy, M + 14, y + 6);
    doc.setDrawColor(180, 180, 180);
    doc.line(M, y + sigRow3H, M + CW, y + sigRow3H);
    doc.line(M + sigColW, y, M + sigColW, y + sigRow3H);
    y += sigRow3H + 5;

    // Aclaración final
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bolditalic');
    doc.setTextColor(0, 0, 0);
    doc.text('Aclaración: En caso de que los espacios no resulten suficientes, incorpore una hoja aparte debidamente firmada con la información adicional.', M, y, { maxWidth: CW });

    // ─── Guardar ─────────────────────────────────────────
    const nombre = (caso.Trabajador || 'anexo').replace(/\s+/g, '_').toUpperCase();
    doc.save(`ANEXO_I_${nombre}.pdf`);
  }
}

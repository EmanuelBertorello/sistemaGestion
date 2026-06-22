/**
 * arca-a-excel.mjs
 * Lee los 997 PDFs de ARCA desde C:\Users\ema\arca_arg\output\vistas,
 * extrae la info del FORMULARIO INICIO y genera un archivo Excel.
 *
 * Uso: node arca-a-excel.mjs
 * Salida: C:\Users\ema\arca_arg\expedientes_arca.xlsx
 *
 * Opciones:
 *   --limit N    (procesa solo N archivos, para prueba)
 *   --start N    (empieza desde el archivo N)
 */

import { PDFParse } from 'pdf-parse';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

// ─── Configuración ──────────────────────────────────────────────────────────
const VISTAS_DIR  = 'C:/Users/ema/arca_arg/output/vistas';
const SALIDA_XLSX = 'C:/Users/ema/arca_arg/expedientes_arca.xlsx';

const startArg = process.argv.indexOf('--start');
const startAt  = startArg >= 0 ? parseInt(process.argv[startArg + 1], 10) : 0;
const limitArg = process.argv.indexOf('--limit');
const limit    = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

// ─── Parser de campo ────────────────────────────────────────────────────────
function extr(text, pattern, group = 1) {
  const m = text.match(pattern);
  return m ? m[group].trim() : '';
}

function parsearPdf(text) {
  const patrIdx  = text.indexOf('Patrocinante');
  const damnText = patrIdx > 0 ? text.slice(0, patrIdx) : text;
  const patrText = patrIdx > 0 ? text.slice(patrIdx)    : '';

  // Localidad / Provincia
  let provincia = '', localidad = '';
  const domMatch = text.match(/Domicilio Notificaci[oó]n:\s*([\s\S]+?)(?:Solicitante|Domicilios)/);
  if (domMatch) {
    const domRaw   = domMatch[1].replace(/\n/g, ' ').replace(/\s+/g, ' ');
    const segments = domRaw.split(/\s*-\s*/);
    const cpIdx    = segments.findIndex(s => /^CP:/i.test(s.trim()));
    if (cpIdx >= 2) {
      provincia = segments[cpIdx - 2].trim();
      localidad = segments[cpIdx - 1].trim();
    }
  }

  // ART
  const artMatch  = text.match(/ART\/EA:\s*(\d+)\s*-\s*(.+)/);
  // Empleador
  const cuitMatch = text.match(/CUIT Ocurrencia:\s*(\d+)\s*-\s*(.+)/);

  return {
    'N° Expediente':    extr(text, /Expediente:\s*(\S+)/),
    'Tipo Trámite':     extr(text, /Tipo de Tr[aá]mite CM:\s*(.+)/),
    'Delegación':       extr(text, /Iniciado en:\s*(\d+\s*-\s*.+)/),
    'CUIL':             extr(damnText, /CUIL:\s*(\d{10,11})/),
    'Apellido y Nombre':extr(damnText, /Apellido Nombre:\s*(.+)/),
    'Fecha Nacimiento': extr(damnText, /Fecha Nacimiento:\s*(\d{2}\/\d{2}\/\d{4})/),
    'Sexo':             extr(damnText, /Sexo:\s*([MF])\b/),
    'Localidad':        localidad,
    'Provincia':        provincia,
    'Fecha Accidente':  extr(text, /Fecha Accidente\/PMI:\s*(\d{2}\/\d{2}\/\d{4})/),
    'Tipo Accidente':   extr(text, /Tipo Accidente:\s*(.+?)(?:\n|Intercurrencia)/),
    'Cód. ART':         artMatch  ? artMatch[1].trim()  : '',
    'ART':              artMatch  ? artMatch[2].trim()  : '',
    'CUIT Empleador':   cuitMatch ? cuitMatch[1].trim() : '',
    'Empleador':        extr(text, /Empleador:\s*\d+\s*-\s*(.+)/),
    'Patrocinante':     extr(patrText, /Apellido y Nombre:\s*(.+)/),
    'CUIL Patrocinante':extr(patrText, /CUIL:\s*(\d{10,11})/),
    'Matrícula':        extr(patrText, /Matricula:\s*(.+)/),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────
const allFiles = readdirSync(VISTAS_DIR)
  .filter(f => f.endsWith('.pdf'))
  .sort()
  .slice(startAt, startAt + limit);

console.log(`\n📂 Directorio : ${VISTAS_DIR}`);
console.log(`📄 Archivos   : ${allFiles.length}`);
console.log(`📊 Salida     : ${SALIDA_XLSX}\n`);

const filas = [];
let errores = 0;

for (let i = 0; i < allFiles.length; i++) {
  const filename = allFiles[i];
  try {
    const buf    = readFileSync(path.join(VISTAS_DIR, filename));
    const parser = new PDFParse({ data: buf, verbosity: 0 });
    const result = await parser.getText({ partial: [1, 2] });
    await parser.destroy();
    filas.push(parsearPdf(result.text));
  } catch (e) {
    console.error(`⚠️  ${filename}: ${e.message}`);
    errores++;
    filas.push({ 'N° Expediente': filename.replace(/^expediente_/, '').replace(/\.pdf$/, '') });
  }

  if ((i + 1) % 100 === 0 || i === allFiles.length - 1) {
    process.stdout.write(`  [${i + 1}/${allFiles.length}] procesados...\r`);
  }
}

console.log(`\n\n✅ Parseados: ${allFiles.length - errores}  ⚠️  Errores: ${errores}`);
console.log('📝 Generando Excel...');

// Crear workbook
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(filas);

// Ancho de columnas
ws['!cols'] = [
  { wch: 14 }, // N° Expediente
  { wch: 38 }, // Tipo Trámite
  { wch: 20 }, // Delegación
  { wch: 14 }, // CUIL
  { wch: 32 }, // Apellido y Nombre
  { wch: 14 }, // Fecha Nacimiento
  { wch: 5  }, // Sexo
  { wch: 18 }, // Localidad
  { wch: 16 }, // Provincia
  { wch: 14 }, // Fecha Accidente
  { wch: 18 }, // Tipo Accidente
  { wch: 8  }, // Cód. ART
  { wch: 22 }, // ART
  { wch: 14 }, // CUIT Empleador
  { wch: 42 }, // Empleador
  { wch: 28 }, // Patrocinante
  { wch: 14 }, // CUIL Patrocinante
  { wch: 18 }, // Matrícula
];

XLSX.utils.book_append_sheet(wb, ws, 'Expedientes ARCA');
XLSX.writeFile(wb, SALIDA_XLSX);

console.log(`\n🎉 Listo! Archivo guardado en:\n   ${SALIDA_XLSX}\n`);
console.log(`   Total filas: ${filas.length}`);

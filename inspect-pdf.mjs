import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'fs';

const bytes = readFileSync('src/assets/anexo-srt-template.pdf.pdf');
const pdfDoc = await PDFDocument.load(bytes);
const form = pdfDoc.getForm();
const fields = form.getFields();

if (fields.length === 0) {
  console.log('El PDF NO tiene campos de formulario AcroForm.');
} else {
  console.log(`Campos encontrados (${fields.length}):\n`);
  fields.forEach(f => {
    console.log(`  tipo: ${f.constructor.name.padEnd(20)}  nombre: "${f.getName()}"`);
  });
}

import { PDFDocument } from 'pdf-lib';
import { readFileSync, writeFileSync } from 'fs';

const bytes = readFileSync('src/assets/anexo-srt-template.pdf.pdf');
const pdfDoc = await PDFDocument.load(bytes);
const form = pdfDoc.getForm();

form.getFields().forEach(f => {
  const name = f.getName();
  try {
    const tf = form.getTextField(name);
    tf.setText(name);   // pone el nombre del campo dentro de la casilla
  } catch (_) {}
});

const out = await pdfDoc.save();
writeFileSync('campo-mapa.pdf', out);
console.log('Generado: campo-mapa.pdf');

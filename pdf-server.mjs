/**
 * pdf-server.mjs  —  servidor local de PDFs + extracción de texto para análisis IA
 * Uso: node pdf-server.mjs
 * Endpoints:
 *   GET /                           → lista archivos
 *   GET /{archivo}.pdf              → descarga/visualiza el PDF
 *   GET /texto/{archivo}.pdf        → extrae y devuelve el texto del PDF (para IA)
 */
import http   from 'http';
import fs     from 'fs';
import path   from 'path';
import { createRequire } from 'module';

const require  = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const PORT    = 8765;
const PDF_DIR = path.normalize('C:/Users/ema/arca_arg/output/2026-06-04/vistas');

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const reqPath   = decodeURIComponent(req.url.split('?')[0]);
  const segments  = reqPath.split('/').filter(Boolean); // ['texto','expediente_xxx.pdf'] o ['expediente_xxx.pdf']

  // GET / → listar archivos
  if (reqPath === '/') {
    try {
      const files = fs.readdirSync(PDF_DIR).filter(f => f.endsWith('.pdf'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ total: files.length, files }));
    } catch(e) { res.writeHead(500); res.end(e.message); }
    return;
  }

  // GET /texto/{archivo}.pdf → extrae texto del PDF
  if (segments[0] === 'texto' && segments[1]?.endsWith('.pdf')) {
    const fileName = path.basename(segments[1]);
    const filePath = path.join(PDF_DIR, fileName);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'PDF no encontrado: ' + fileName }));
      return;
    }

    try {
      const buffer = fs.readFileSync(filePath);
      const data   = await pdfParse(buffer);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        archivo: fileName,
        paginas: data.numpages,
        texto:   data.text.trim(),
      }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Error extrayendo texto: ' + e.message }));
    }
    return;
  }

  // GET /{archivo}.pdf → servir el PDF
  const fileName = path.basename(reqPath);
  if (!fileName.endsWith('.pdf')) { res.writeHead(400); res.end('Solo PDFs'); return; }

  const filePath = path.join(PDF_DIR, fileName);
  if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('No encontrado: ' + fileName); return; }

  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type':        'application/pdf',
    'Content-Length':      stat.size,
    'Content-Disposition': 'inline; filename="' + fileName + '"',
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`✅  PDF server → http://localhost:${PORT}`);
  console.log(`📁  Carpeta   → ${PDF_DIR}`);
  console.log(`📄  PDF       → http://localhost:${PORT}/expediente_116066_25.pdf`);
  console.log(`🔍  Texto     → http://localhost:${PORT}/texto/expediente_116066_25.pdf`);
});

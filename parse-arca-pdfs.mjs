/**
 * parse-arca-pdfs.mjs
 * Lee los PDFs de ARCA desde C:\Users\ema\arca_arg\output\vistas,
 * extrae los campos del FORMULARIO INICIO (página 2) y sube todo
 * a la colección `expedientesArca` en Firestore.
 *
 * Uso: node parse-arca-pdfs.mjs
 * Opciones: --dry-run   (solo parsea, no sube)
 *           --start N   (empieza desde el archivo N, para reanudar)
 *           --limit N   (procesa solo N archivos)
 */

import { PDFParse } from 'pdf-parse';
import { readFileSync, readdirSync } from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';

// ─── Configuración ─────────────────────────────────────────────────────────
const PROJECT   = 'bdcap-a3b7b';
const COLLECTION = 'expedientesArca';
const VISTAS_DIR = 'C:/Users/ema/arca_arg/output/vistas';
const BATCH_SIZE = 400;   // máx 500 en la API; usamos 400 por seguridad
const DELAY_MS   = 300;   // ms entre batches

const isDryRun = process.argv.includes('--dry-run');
const startArg = process.argv.indexOf('--start');
const startAt  = startArg >= 0 ? parseInt(process.argv[startArg + 1], 10) : 0;
const limitArg = process.argv.indexOf('--limit');
const limit    = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

// ─── Firebase token ─────────────────────────────────────────────────────────
const CFG_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

function readFirebaseCfg() {
  return JSON.parse(readFileSync(CFG_PATH, 'utf8'));
}

// Refresca el access_token usando el refresh_token de Firebase CLI
async function refreshToken(refreshToken) {
  return new Promise((resolve, reject) => {
    const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) resolve(json.access_token);
          else reject(new Error(`OAuth error: ${JSON.stringify(json)}`));
        } catch { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Firebase CLI registra el client_id/secret en el token endpoint
// Usamos el endpoint público de Google con el refresh_token del CLI
const GOOGLE_CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

async function refreshTokenWithClient(rt) {
  return new Promise((resolve, reject) => {
    const body = [
      `grant_type=refresh_token`,
      `refresh_token=${encodeURIComponent(rt)}`,
      `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}`,
      `client_secret=${encodeURIComponent(GOOGLE_CLIENT_SECRET)}`,
    ].join('&');
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) resolve(json.access_token);
          else reject(new Error(`OAuth error: ${JSON.stringify(json).slice(0, 200)}`));
        } catch { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

let TOKEN;
try {
  const cfg = readFirebaseCfg();
  if (!cfg.tokens?.refresh_token) throw new Error('No hay refresh_token en el config de Firebase CLI');
  console.log('🔑 Obteniendo access token...');
  TOKEN = await refreshTokenWithClient(cfg.tokens.refresh_token);
  console.log('✅ Token obtenido correctamente.\n');
} catch (e) {
  console.error('❌ No se pudo obtener el token de Firebase:', e.message);
  console.error('   Ejecutá: firebase login  y volvé a intentar.');
  process.exit(1);
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function extr(text, pattern, group = 1) {
  const m = text.match(pattern);
  return m ? m[group].trim() : null;
}

// Convierte una cadena de campos a formato Firestore REST
function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      fields[k] = { nullValue: null };
    } else {
      fields[k] = { stringValue: String(v) };
    }
  }
  return fields;
}

// POST a Firestore REST API
function firestoreRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'firestore.googleapis.com',
      path: apiPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── Parseo del PDF ─────────────────────────────────────────────────────────
function parsearPdf(text, docId) {
  // Separar sección del damnificado (antes de "Patrocinante")
  const patrIdx = text.indexOf('Patrocinante');
  const damnText = patrIdx > 0 ? text.slice(0, patrIdx) : text;
  const patrText = patrIdx > 0 ? text.slice(patrIdx)     : '';

  // ── Expediente ──
  const nroExpediente = extr(text, /Expediente:\s*(\S+)/);
  const tipoTramite   = extr(text, /Tipo de Tr[aá]mite CM:\s*(.+)/);
  const delegacion    = extr(text, /Iniciado en:\s*(\d+\s*-\s*.+)/);

  // ── Damnificado ──
  const cuil           = extr(damnText, /CUIL:\s*(\d{10,11})/);
  const apellidoNombre = extr(damnText, /Apellido Nombre:\s*(.+)/);
  const fechaNacimientoRaw = extr(damnText, /Fecha Nacimiento:\s*(\d{2}\/\d{2}\/\d{4})/);
  const sexo           = extr(damnText, /Sexo:\s*([MF])\b/);

  // ── Accidente ──
  const fechaAccidenteRaw = extr(text, /Fecha Accidente\/PMI:\s*(\d{2}\/\d{2}\/\d{4})/);
  const tipoAccidente  = extr(text, /Tipo Accidente:\s*(.+?)(?:\n|Intercurrencia)/);

  // ── ART ──
  const artMatch  = text.match(/ART\/EA:\s*(\d+)\s*-\s*(.+)/);
  const artCodigo = artMatch ? artMatch[1].trim() : null;
  const artNombre = artMatch ? artMatch[2].trim() : null;

  // ── Empleador ──
  const cuitOcurrMatch = text.match(/CUIT Ocurrencia:\s*(\d+)\s*-\s*(.+)/);
  const cuitEmpleador  = cuitOcurrMatch ? cuitOcurrMatch[1].trim() : null;
  const empleador      = extr(text, /Empleador:\s*\d+\s*-\s*(.+)/);

  // ── Localidad / Provincia ──
  // Formato: "CALLE NUM - PROVINCIA - CIUDAD - CP: NNNN"
  // (puede haber saltos de línea internos)
  let provincia = null;
  let localidad = null;
  const domMatch = text.match(/Domicilio Notificaci[oó]n:\s*([\s\S]+?)(?:Solicitante|Domicilios)/);
  if (domMatch) {
    const domRaw = domMatch[1].replace(/\n/g, ' ').replace(/\s+/g, ' ');
    // Buscamos los segmentos separados por " - "
    const segments = domRaw.split(/\s*-\s*/);
    // CP siempre empieza con "CP:"
    const cpIdx = segments.findIndex(s => /^CP:/i.test(s.trim()));
    if (cpIdx >= 2) {
      provincia = segments[cpIdx - 2].trim();
      localidad = segments[cpIdx - 1].trim();
    }
  }

  // ── Patrocinante ──
  const patroCuil   = extr(patrText, /CUIL:\s*(\d{10,11})/);
  const patroNombre = extr(patrText, /Apellido y Nombre:\s*(.+)/);
  const patroMat    = extr(patrText, /Matricula:\s*(.+)/);

  return {
    docId,
    nroExpediente,
    tipoTramite,
    delegacion,
    cuil,
    apellidoNombre,
    fechaNacimiento: fechaNacimientoRaw ?? null,
    sexo,
    fechaAccidente: fechaAccidenteRaw ?? null,
    tipoAccidente,
    artCodigo,
    artNombre,
    cuitEmpleador,
    empleador,
    provincia,
    localidad,
    patroCuil,
    patroNombre,
    patroMatricula: patroMat,
    importadoEn: new Date().toISOString(),
  };
}

// ─── Upload en batch ─────────────────────────────────────────────────────────
async function subirBatch(registros) {
  const writes = registros.map(r => ({
    update: {
      name: `projects/${PROJECT}/databases/(default)/documents/${COLLECTION}/${r.docId}`,
      fields: toFirestoreFields(r),
    },
  }));

  const result = await firestoreRequest(
    'POST',
    `/v1/projects/${PROJECT}/databases/(default)/documents:batchWrite`,
    { writes }
  );

  if (result.status !== 200) {
    throw new Error(`HTTP ${result.status}: ${JSON.stringify(result.body).slice(0, 200)}`);
  }
  // Verificar si hubo errores individuales en el batch
  const writeResults = result.body.writeResults ?? [];
  const errors = (result.body.status ?? []).filter(s => s && s.code && s.code !== 0);
  return { ok: writes.length - errors.length, errors: errors.length };
}

// ─── Main ────────────────────────────────────────────────────────────────────
const allFiles = readdirSync(VISTAS_DIR)
  .filter(f => f.endsWith('.pdf'))
  .sort()
  .slice(startAt, startAt + limit);

console.log(`\n📂 Directorio: ${VISTAS_DIR}`);
console.log(`📄 Archivos a procesar: ${allFiles.length} (desde índice ${startAt})`);
if (isDryRun) console.log('⚠️  DRY RUN — no se subirá nada a Firestore\n');
else          console.log(`🔥 Subiendo a Firestore → ${COLLECTION}\n`);

let totalOk = 0;
let totalErr = 0;
let parseErrors = 0;
const registros = [];
const batchErrors = [];

for (let i = 0; i < allFiles.length; i++) {
  const filename = allFiles[i];
  // docId: expediente_NNNNN_YY → NNNNN_YY
  const docId = filename.replace(/^expediente_/, '').replace(/\.pdf$/, '');

  try {
    const buf = readFileSync(path.join(VISTAS_DIR, filename));
    const parser = new PDFParse({ data: buf, verbosity: 0 });
    // Páginas 1 y 2 tienen toda la info necesaria
    const result = await parser.getText({ partial: [1, 2] });
    await parser.destroy();

    const reg = parsearPdf(result.text, docId);
    registros.push(reg);

    if ((i + 1) % 50 === 0) {
      process.stdout.write(`  [${i + 1}/${allFiles.length}] parseando... (${registros.length} en cola)\r`);
    }
  } catch (e) {
    console.error(`\n⚠️  Error parseando ${filename}: ${e.message}`);
    parseErrors++;
  }

  // Cuando acumulamos BATCH_SIZE o llegamos al final, subimos
  if (!isDryRun && (registros.length >= BATCH_SIZE || i === allFiles.length - 1)) {
    if (registros.length === 0) continue;
    try {
      const { ok, errors } = await subirBatch(registros);
      totalOk  += ok;
      totalErr += errors;
      console.log(`  ✅ Batch subido: ${ok} docs (${errors} errores) — total ${totalOk} OK`);
    } catch (e) {
      console.error(`  ❌ Error en batch: ${e.message}`);
      batchErrors.push({ desde: registros[0].docId, hasta: registros.at(-1).docId, error: e.message });
      totalErr += registros.length;

      // Si es 401, el token expiró
      if (e.message.includes('401') || e.message.includes('UNAUTHENTICATED')) {
        console.error('\n🔑 Token expirado. Ejecutá: firebase login  y volvé a ejecutar el script.');
        process.exit(1);
      }
    }
    registros.length = 0; // vaciar buffer
    await sleep(DELAY_MS);
  }
}

if (isDryRun) {
  // En dry-run, mostrar muestra de lo que se parseó
  console.log(`\n✅ Dry-run completado. ${allFiles.length - parseErrors} PDFs parseados correctamente.`);
  console.log('\n📋 Ejemplo del primer registro parseado:');
  const sample = registros[0];
  if (sample) console.log(JSON.stringify(sample, null, 2));
} else {
  console.log('\n─────────────────────────────────────────');
  console.log(`📊 Resumen final:`);
  console.log(`   ✅ Subidos OK : ${totalOk}`);
  console.log(`   ❌ Errores    : ${totalErr}`);
  console.log(`   ⚠️  Parse err : ${parseErrors}`);
  if (batchErrors.length > 0) {
    console.log('\n   Batches fallidos:');
    batchErrors.forEach(b => console.log(`     ${b.desde} → ${b.hasta}: ${b.error}`));
  }
}

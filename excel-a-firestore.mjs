/**
 * excel-a-firestore.mjs
 * Lee el archivo expedientes_arca.xlsx y sube (o actualiza) los datos
 * a la colección `expedientesArca` en Firestore.
 *
 * Uso: node excel-a-firestore.mjs
 * Opciones:
 *   --archivo <ruta>   (por defecto: C:\Users\ema\arca_arg\expedientes_arca.xlsx)
 *   --dry-run          (solo imprime lo que haría, sin subir)
 */

import { readFileSync } from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

// ─── Configuración ──────────────────────────────────────────────────────────
const PROJECT    = 'bdcap-a3b7b';
const COLLECTION = 'expedientesArca';

const archivoArg = process.argv.indexOf('--archivo');
const XLSX_PATH  = archivoArg >= 0
  ? process.argv[archivoArg + 1]
  : 'C:/Users/ema/arca_arg/expedientes_arca.xlsx';

const isDryRun   = process.argv.includes('--dry-run');
const BATCH_SIZE = 400;
const DELAY_MS   = 300;

// ─── Columnas Excel → campo Firestore ───────────────────────────────────────
const COLUMNAS = {
  'N° Expediente':     'nroExpediente',
  'Tipo Trámite':      'tipoTramite',
  'Delegación':        'delegacion',
  'CUIL':              'cuil',
  'Apellido y Nombre': 'apellidoNombre',
  'Fecha Nacimiento':  'fechaNacimiento',
  'Sexo':              'sexo',
  'Localidad':         'localidad',
  'Provincia':         'provincia',
  'Fecha Accidente':   'fechaAccidente',
  'Tipo Accidente':    'tipoAccidente',
  'Cód. ART':          'artCodigo',
  'ART':               'artNombre',
  'CUIT Empleador':    'cuitEmpleador',
  'Empleador':         'empleador',
  'Patrocinante':      'patroNombre',
  'CUIL Patrocinante': 'patroCuil',
  'Matrícula':         'patroMatricula',
};

// ─── Firebase token ──────────────────────────────────────────────────────────
const CFG_PATH             = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const GOOGLE_CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

async function refreshToken(rt) {
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          j.access_token ? resolve(j.access_token) : reject(new Error(JSON.stringify(j).slice(0, 200)));
        } catch { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

async function subirBatch(registros) {
  const writes = registros.map(r => ({
    update: {
      name: `projects/${PROJECT}/databases/(default)/documents/${COLLECTION}/${r._docId}`,
      fields: Object.fromEntries(
        Object.entries(r)
          .filter(([k]) => k !== '_docId')
          .map(([k, v]) => [k, v ? { stringValue: String(v) } : { nullValue: null }])
      ),
    },
  }));
  const result = await firestoreRequest(
    'POST',
    `/v1/projects/${PROJECT}/databases/(default)/documents:batchWrite`,
    { writes }
  );
  if (result.status !== 200) throw new Error(`HTTP ${result.status}: ${JSON.stringify(result.body).slice(0, 200)}`);
  const errors = (result.body.status ?? []).filter(s => s?.code && s.code !== 0);
  return { ok: writes.length - errors.length, errors: errors.length };
}

// ─── Obtener token ───────────────────────────────────────────────────────────
let TOKEN;
try {
  const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
  if (!cfg.tokens?.refresh_token) throw new Error('No hay refresh_token en Firebase CLI');
  console.log('🔑 Obteniendo token...');
  TOKEN = await refreshToken(cfg.tokens.refresh_token);
  console.log('✅ Token OK\n');
} catch (e) {
  console.error('❌ Error de auth:', e.message, '\n   Ejecutá: firebase login');
  process.exit(1);
}

// ─── Leer Excel ──────────────────────────────────────────────────────────────
console.log(`📖 Leyendo: ${XLSX_PATH}`);
const wb   = XLSX.readFile(XLSX_PATH);
const ws   = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
console.log(`   ${rows.length} filas encontradas\n`);
if (isDryRun) {
  console.log('⚠️  DRY RUN — primeras 2 filas:');
  rows.slice(0, 2).forEach(r => console.log(JSON.stringify(r, null, 2)));
  process.exit(0);
}

// ─── Convertir y subir ───────────────────────────────────────────────────────
const registros = rows.map(row => {
  const doc = { _docId: '', importadoEn: new Date().toISOString() };

  for (const [colExcel, campo] of Object.entries(COLUMNAS)) {
    doc[campo] = String(row[colExcel] ?? '').trim();
  }

  // ID del documento: nroExpediente con / → _ (ej: 10006/26 → 10006_26)
  doc._docId = doc.nroExpediente
    ? doc.nroExpediente.replace(/\//g, '_').replace(/\s/g, '')
    : `fila_${Math.random().toString(36).slice(2)}`;

  return doc;
});

let totalOk = 0, totalErr = 0;
for (let i = 0; i < registros.length; i += BATCH_SIZE) {
  const batch = registros.slice(i, i + BATCH_SIZE);
  try {
    const { ok, errors } = await subirBatch(batch);
    totalOk  += ok;
    totalErr += errors;
    console.log(`  ✅ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${ok} docs subidos (${errors} errores) — total ${totalOk} OK`);
    await sleep(DELAY_MS);
  } catch (e) {
    console.error(`  ❌ Error en batch: ${e.message}`);
    totalErr += batch.length;
    if (e.message.includes('401') || e.message.includes('UNAUTHENTICATED')) {
      console.error('\n🔑 Token expirado. Ejecutá: firebase login');
      process.exit(1);
    }
  }
}

console.log('\n─────────────────────────────────────────');
console.log(`📊 Resumen:`);
console.log(`   ✅ Subidos OK  : ${totalOk}`);
console.log(`   ❌ Con errores : ${totalErr}`);
console.log(`\n🔥 Colección Firestore: ${COLLECTION}`);

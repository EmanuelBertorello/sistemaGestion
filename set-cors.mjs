/**
 * set-cors.mjs — aplica CORS al bucket de Firebase Storage.
 * Uso: node set-cors.mjs
 * Requiere: firebase login (ya hecho)
 */
import https from 'https';
import os   from 'os';
import path from 'path';
import { readFileSync } from 'fs';

const PROJECT = 'bdcap-a3b7b';
const BUCKET  = `${PROJECT}.firebasestorage.app`;

const CFG_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));

// ── helpers ──────────────────────────────────────────────────────────────────

function httpsRequest(opts, body = '') {
  return new Promise((resolve, reject) => {
    const s = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({
      ...opts,
      headers: { ...opts.headers, 'Content-Length': Buffer.byteLength(s) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (s) req.write(s);
    req.end();
  });
}

async function getToken(scope) {
  const rt = cfg.tokens?.refresh_token;
  if (!rt) { console.error('❌ Ejecutá: firebase login'); process.exit(1); }

  const CLIENT_ID  = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
  const CLIENT_SEC = 'j9iVZfS8kkCEFUPaAeJV0sAi';

  let body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}&client_id=${encodeURIComponent(CLIENT_ID)}&client_secret=${encodeURIComponent(CLIENT_SEC)}`;
  if (scope) body += `&scope=${encodeURIComponent(scope)}`;

  const res = await httpsRequest({
    hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, body);

  if (!res.body?.access_token) throw new Error(JSON.stringify(res.body).slice(0, 300));
  return res.body.access_token;
}

// ── CORS policy ───────────────────────────────────────────────────────────────

const corsPolicy = [{
  origin: [
    'http://localhost:4200',
    'http://localhost:4000',
    'https://caoe2026.web.app',
    'https://caoe2026.firebaseapp.com',
  ],
  method: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
  maxAgeSeconds: 3600,
  responseHeader: [
    'Content-Type', 'Authorization', 'Content-Length',
    'User-Agent', 'x-goog-resumable', 'x-firebase-storage-version',
  ],
}];

// ── obtener token ─────────────────────────────────────────────────────────────

console.log('🔑 Obteniendo access token...');

let token;
// Intentar con cloud-platform (scope amplio, Firebase Tools lo tiene)
try {
  token = await getToken('https://www.googleapis.com/auth/cloud-platform');
  console.log('✅ Token OK (cloud-platform)\n');
} catch {
  // Fallback: usar el token existente en el config sin pedir scope extra
  try {
    token = await getToken('');
    console.log('✅ Token OK (default scopes)\n');
  } catch (e) {
    console.error('❌', e.message); process.exit(1);
  }
}

// ── intentar varios endpoints ─────────────────────────────────────────────────

const endpoints = [
  // Cloud Storage JSON API v1 — bucket con nombre completo
  { api: 'storage.googleapis.com', path: `/storage/v1/b/${encodeURIComponent(BUCKET)}?fields=cors`, body: { cors: corsPolicy } },
  // Cloud Storage XML API — PATCH sobre el bucket
  { api: 'storage.googleapis.com', path: `/storage/v1/b/${BUCKET}?fields=cors`, body: { cors: corsPolicy } },
  // Firebase Storage API v1beta
  { api: 'firebasestorage.googleapis.com', path: `/v1beta/projects/${PROJECT}/buckets/${encodeURIComponent(BUCKET)}`, body: { cors: corsPolicy } },
];

let ok = false;
for (const { api, path: p, body } of endpoints) {
  console.log(`🔧 PATCH https://${api}${p}`);
  const r = await httpsRequest({
    hostname: api, path: p, method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  }, body);

  console.log(`   → HTTP ${r.status}`);
  if (r.status === 200) {
    console.log('\n✅ CORS aplicado correctamente!');
    console.log(JSON.stringify(r.body?.cors ?? r.body, null, 2));
    ok = true; break;
  }
  if (r.status !== 404) {
    console.log(`   ⚠️  ${JSON.stringify(r.body).slice(0, 200)}`);
  }
}

if (!ok) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('No se pudo aplicar automáticamente.');
  console.log('\n📋 OPCIÓN 1 — Terminal (necesita gcloud instalado):');
  console.log('   gcloud auth login');
  console.log(`   gsutil cors set cors.json gs://${BUCKET}`);
  console.log('\n📋 OPCIÓN 2 — Firebase Console:');
  console.log('   https://console.firebase.google.com/project/bdcap-a3b7b/storage');
  console.log('   → Tab "Reglas" → reemplazá con reglas permisivas para desarrollo');
  console.log('\n   O instalar Google Cloud SDK desde:');
  console.log('   https://cloud.google.com/sdk/docs/install');
  console.log('\n   CORS JSON a aplicar:');
  console.log(JSON.stringify(corsPolicy, null, 2));
}

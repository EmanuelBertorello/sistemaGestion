/**
 * actualizar-carla.mjs
 * Actualiza los módulos de Carla Vignale a ['srt', 'sisfe']
 * Uso: node actualizar-carla.mjs
 */
import { readFileSync } from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';

const PROJECT_ID = 'bdcap-a3b7b';
const API_KEY    = 'AIzaSyDxzxVLoqqUU45DqEajJ49OBVUkE2dRKnI';
const CARLA_EMAIL = 'carlavignale82@gmail.com';

const CFG_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const GOOGLE_CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

async function refreshToken(rt) {
  return new Promise((resolve, reject) => {
    const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}&client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}&client_secret=${encodeURIComponent(GOOGLE_CLIENT_SECRET)}`;
    const req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : reject(new Error(JSON.stringify(j).slice(0, 200))); }
        catch { reject(new Error(d)); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function firestoreRequest(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'firestore.googleapis.com',
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
if (!cfg.tokens?.refresh_token) { console.error('❌ No hay refresh_token. Ejecutá: firebase login'); process.exit(1); }

console.log('🔑 Obteniendo token...');
const token = await refreshToken(cfg.tokens.refresh_token);
console.log('✅ Token OK\n');

// Buscar el documento de Carla en la colección usuarios
const basePath = `/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const queryUrl = `${basePath}:runQuery`;

const queryBody = {
  structuredQuery: {
    from: [{ collectionId: 'usuarios' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'email' },
        op: 'EQUAL',
        value: { stringValue: CARLA_EMAIL },
      },
    },
    limit: 1,
  },
};

console.log(`🔍 Buscando usuario: ${CARLA_EMAIL}`);
const queryRes = await firestoreRequest('POST', queryUrl, token, queryBody);

if (queryRes.status !== 200) {
  console.error('❌ Error al consultar Firestore:', queryRes.body);
  process.exit(1);
}

const docs = queryRes.body.filter(r => r.document);
if (docs.length === 0) {
  console.error('❌ No se encontró el usuario de Carla en Firestore.');
  process.exit(1);
}

const docName = docs[0].document.name;
console.log(`✅ Usuario encontrado: ${docName}\n`);

// Actualizar el campo modulos
const updateUrl = `${basePath}/${docName.split('/documents/')[1]}?updateMask.fieldPaths=modulos`;
const updateBody = {
  fields: {
    modulos: {
      arrayValue: {
        values: [
          { stringValue: 'srt' },
          { stringValue: 'sisfe' },
        ],
      },
    },
  },
};

console.log('🔧 Actualizando módulos de Carla a [\'srt\', \'sisfe\']...');
const updateRes = await firestoreRequest('PATCH', `/v1/${docName.split('/v1/')[1] || docName}?updateMask.fieldPaths=modulos`, token, updateBody);

// Si la URL no funcionó, intentar con la ruta completa directamente
const docId = docName.split('/documents/')[1];
const patchUrl = `${basePath}/${docId}?updateMask.fieldPaths=modulos`;
const patchRes = await firestoreRequest('PATCH', patchUrl, token, updateBody);

if (patchRes.status === 200) {
  console.log('✅ Módulos actualizados correctamente.');
  console.log('   Carla ahora tiene módulos: [\'srt\', \'sisfe\']');
} else {
  console.error(`❌ Error HTTP ${patchRes.status}:`);
  console.error(JSON.stringify(patchRes.body, null, 2));
}

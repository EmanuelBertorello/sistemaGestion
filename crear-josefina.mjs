/**
 * crear-josefina.mjs
 * 1. Crea cuenta Firebase Auth para Josefina
 * 2. Crea su documento en Firestore (usuarios)
 * 3. Agrega modulos: ['captar','procurar'] a Carla
 * 4. Agrega modulos: ['llamador','iniciado'] a Julián
 *
 * Uso: node crear-josefina.mjs
 */

import { readFileSync } from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';

// ─── Config ──────────────────────────────────────────────────────────────────
const PROJECT    = 'bdcap-a3b7b';
const API_KEY    = 'AIzaSyCD6mhPkLrKJ85uyGj9p08jKC9lp84eJnY';

const CFG_PATH             = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const GOOGLE_CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({ hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET', headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function refreshToken(rt) {
  const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}&client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}&client_secret=${encodeURIComponent(GOOGLE_CLIENT_SECRET)}`;
  const r = await httpsPost('oauth2.googleapis.com', '/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' }, body);
  if (!r.body.access_token) throw new Error('No access_token: ' + JSON.stringify(r.body).slice(0, 200));
  return r.body.access_token;
}

// ─── Firebase Auth REST ───────────────────────────────────────────────────────
async function crearAuthUser(email, password) {
  const r = await httpsPost('identitytoolkit.googleapis.com',
    `/v1/accounts:signUp?key=${API_KEY}`,
    { 'Content-Type': 'application/json' },
    { email, password, returnSecureToken: true });
  if (r.body.error) throw new Error(r.body.error.message);
  return r.body.localId; // uid
}

// ─── Firestore REST ───────────────────────────────────────────────────────────
let TOKEN;
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;

function firestoreReq(method, apiPath, body) {
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
    }, res => {
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

function toFs(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') return { integerValue: val.toString() };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFs) } };
  return { stringValue: String(val) };
}

async function createDoc(collection, docId, fields) {
  const fsFields = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, toFs(v)]));
  const r = await firestoreReq('PATCH',
    `${BASE}/${collection}/${docId}?currentDocument.exists=false`,
    { fields: fsFields });
  if (r.status !== 200) throw new Error(`Create ${docId}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
}

async function updateDoc(collection, docId, fields) {
  const updateMask = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const fsFields = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, toFs(v)]));
  const r = await firestoreReq('PATCH',
    `${BASE}/${collection}/${docId}?${updateMask}`,
    { fields: fsFields });
  if (r.status !== 200) throw new Error(`Update ${docId}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
}

// Busca un doc por campo=valor
async function findDocByField(collection, field, value) {
  const r = await firestoreReq('POST',
    `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
    {
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toFs(value) } },
        limit: 1,
      }
    });
  if (r.status !== 200) throw new Error(`Query ${collection}: HTTP ${r.status}`);
  const hit = r.body.find?.(d => d.document);
  return hit ? hit.document : null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
try {
  const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
  if (!cfg.tokens?.refresh_token) throw new Error('No hay refresh_token');
  console.log('🔑 Obteniendo token...');
  TOKEN = await refreshToken(cfg.tokens.refresh_token);
  console.log('✅ Token OK\n');
} catch (e) {
  console.error('❌ Error de auth:', e.message, '\n   Ejecutá: firebase login');
  process.exit(1);
}

// ─── 1. Crear cuenta Josefina ─────────────────────────────────────────────────
console.log('👤 Creando usuario Josefina en Firebase Auth...');
let joseUid;
try {
  joseUid = await crearAuthUser('restovichjosefina1@gmail.com', 'jose123');
  console.log(`   UID: ${joseUid}`);
} catch (e) {
  if (e.message.includes('EMAIL_EXISTS')) {
    console.log('   ⚠️  Email ya existe en Auth, continuando...');
    // Buscar uid existente en Firestore
    const existingDoc = await findDocByField('usuarios', 'email', 'restovichjosefina1@gmail.com');
    if (existingDoc) {
      joseUid = existingDoc.fields?.uid?.stringValue;
      console.log(`   UID existente: ${joseUid}`);
    } else {
      joseUid = 'josefina_uid_placeholder';
    }
  } else {
    console.error('   ❌', e.message);
    process.exit(1);
  }
}

// ─── 2. Crear doc Firestore Josefina ─────────────────────────────────────────
console.log('📄 Creando documento Firestore para Josefina...');
const joseDoc = await findDocByField('usuarios', 'email', 'restovichjosefina1@gmail.com');
if (joseDoc) {
  console.log('   ⚠️  Ya existe doc en Firestore, actualizando rol...');
  const parts = joseDoc.name.split('/');
  const docId = parts[parts.length - 1];
  await updateDoc('usuarios', docId, { rol: 'josefina', apodo: 'JOSEFINA' });
} else {
  await createDoc('usuarios', joseUid, {
    uid: joseUid,
    email: 'restovichjosefina1@gmail.com',
    apodo: 'JOSEFINA',
    rol: 'josefina',
  });
  console.log('   ✅ Documento creado');
}

// ─── 3. Modulos para Carla ────────────────────────────────────────────────────
console.log('\n📦 Actualizando módulos de Carla Vignale...');
const carlaDoc = await findDocByField('usuarios', 'email', 'carlavignale82@gmail.com');
if (carlaDoc) {
  const parts = carlaDoc.name.split('/');
  const docId = parts[parts.length - 1];
  await updateDoc('usuarios', docId, { modulos: ['captar', 'procurar'] });
  console.log('   ✅ modulos: [captar, procurar]');
} else {
  console.log('   ⚠️  No se encontró doc para carlavignale82@gmail.com');
}

// ─── 4. Modulos para Julián ───────────────────────────────────────────────────
console.log('\n📦 Actualizando módulos de Julián...');
const julianDoc = await findDocByField('usuarios', 'email', 'jcmr.abogado@gmail.com');
if (julianDoc) {
  const parts = julianDoc.name.split('/');
  const docId = parts[parts.length - 1];
  await updateDoc('usuarios', docId, { modulos: ['llamador', 'iniciado'] });
  console.log('   ✅ modulos: [llamador, iniciado]');
} else {
  console.log('   ⚠️  No se encontró doc para jcmr.abogado@gmail.com');
}

console.log('\n🎉 Listo!');

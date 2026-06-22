/**
 * Borra de BDmadre (cola) los docs con procesado=false cuya
 * Provincia_Ocurrencia NO esté en la lista permitida.
 *
 * Uso:
 *   node limpiar-cola-provincias.mjs          → dry-run (solo muestra)
 *   node limpiar-cola-provincias.mjs --borrar → borra de verdad
 */

import { readFileSync } from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';

const PROJECT_ID = 'bdcap-a3b7b';
const COLECCION  = 'BDmadre';
const CFG_PATH   = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const CLIENT_ID  = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

const BORRAR = process.argv.includes('--borrar');

// Provincias permitidas (comparación case-insensitive, sin tildes ni puntos)
const PERMITIDAS = ['santa fe', 'buenos aires', 'caba', 'ciudad autonoma de buenos aires',
  'capital federal', 'rio negro', 'rio negro', 'neuquen', 'neuquén',
  'ciudad autónoma de buenos aires', 'c.a.b.a.'];

function normalizar(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.\s]+/g, ' ').trim();
}

function esPermitida(provincia) {
  const n = normalizar(provincia);
  return PERMITIDAS.some(p => normalizar(p) === n);
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function refreshToken(rt) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: rt,
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET
    }).toString();
    const req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : reject(new Error(d)); } catch { reject(new Error(d)); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function firestoreRequest(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = { 'Authorization': `Bearer ${token}` };
    if (bodyStr) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(bodyStr); }
    const req = https.request({
      hostname: 'firestore.googleapis.com', path: urlPath, method,
      headers
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

// ─── Paginación con runQuery ─────────────────────────────────────────────────

async function getAllColaIds(token) {
  const url = `/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: COLECCION }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'procesado' },
          op: 'EQUAL',
          value: { booleanValue: false }
        }
      }
    }
  };

  const res = await firestoreRequest('POST', url, token, body);
  if (res.status !== 200) throw new Error(`runQuery error ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);

  const docs = Array.isArray(res.body) ? res.body : [];
  return docs
    .filter(r => r.document)
    .map(r => {
      const f = r.document.fields || {};
      const nombre = r.document.name; // projects/.../documents/BDmadre/{id}
      const id = nombre.split('/').pop();
      const provincia = f.Provincia_Ocurrencia?.stringValue ?? '';
      const trabajador = f.Trabajador?.stringValue ?? '';
      return { id, provincia, trabajador, nombre };
    });
}

async function borrarBatch(token, docs) {
  const base = `/v1/projects/${PROJECT_ID}/databases/(default)/documents:batchWrite`;
  const CHUNK = 499;
  let eliminados = 0;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const chunk = docs.slice(i, i + CHUNK);
    const writes = chunk.map(d => ({ delete: d.nombre }));
    const res = await firestoreRequest('POST', base, token, { writes });
    if (res.status !== 200) {
      console.error(`  Error batch ${i}-${i + chunk.length}:`, res.status, JSON.stringify(res.body).slice(0, 200));
    } else {
      eliminados += chunk.length;
      console.log(`  Borrados ${eliminados}/${docs.length}...`);
    }
  }
  return eliminados;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
console.log('Obteniendo token...');
const token = await refreshToken(cfg.tokens.refresh_token);
console.log('Token OK\n');

console.log('Leyendo cola (BDmadre, procesado=false)...');
const todos = await getAllColaIds(token);
console.log(`Total en cola: ${todos.length}\n`);

// Separar
const aConservar = todos.filter(d => esPermitida(d.provincia));
const aBorrar    = todos.filter(d => !esPermitida(d.provincia));

// Resumen por provincia de los que se borrarían
const conteo = {};
for (const d of aBorrar) {
  const k = d.provincia || '(sin provincia)';
  conteo[k] = (conteo[k] || 0) + 1;
}

console.log(`✓ A conservar (${aConservar.length} docs): Santa Fe, Buenos Aires, CABA, Río Negro, Neuquén`);
console.log(`✗ A borrar (${aBorrar.length} docs):`);
for (const [prov, n] of Object.entries(conteo).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${n.toString().padStart(5)} × ${prov}`);
}

if (!BORRAR) {
  console.log('\n⚠  DRY-RUN — no se borró nada.');
  console.log('   Para borrar de verdad: node limpiar-cola-provincias.mjs --borrar');
  process.exit(0);
}

console.log(`\nBorrando ${aBorrar.length} docs...`);
const eliminados = await borrarBatch(token, aBorrar);
console.log(`\n✓ Listo: ${eliminados} documentos eliminados de la cola.`);

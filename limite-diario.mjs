/**
 * limite-diario.mjs
 * Ver o cambiar el límite diario de "Acepto" por llamador (config_llamadores.limiteDiario),
 * sin pasar por el dashboard de admin.
 *
 * Uso:
 *   node limite-diario.mjs                 -> lista todos los llamadores con su límite diario
 *   node limite-diario.mjs <apodo>         -> muestra el límite diario de ese llamador
 *   node limite-diario.mjs <apodo> <valor> -> setea el límite diario (0 = sin límite)
 */
import { readFileSync } from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';

const PROJECT_ID = 'bdcap-a3b7b';
const COLLECTION = 'config_llamadores';

const CFG_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const GOOGLE_CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

function refreshToken(rt) {
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

async function main() {
  const [, , apodo, valorArg] = process.argv;

  const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
  if (!cfg.tokens?.refresh_token) { console.error('No hay refresh_token. Ejecutá: firebase login'); process.exit(1); }
  const token = await refreshToken(cfg.tokens.refresh_token);
  const basePath = `/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

  if (!apodo) {
    // Listar todos
    const res = await firestoreRequest('GET', `${basePath}/${COLLECTION}`, token);
    if (res.status !== 200) { console.error('Error:', res.body); process.exit(1); }
    const docs = res.body.documents ?? [];
    if (docs.length === 0) { console.log('No hay configuraciones guardadas.'); return; }
    console.log('Llamador'.padEnd(20), 'Límite diario');
    for (const doc of docs) {
      const f = doc.fields ?? {};
      const ap = f.apodo?.stringValue ?? '(sin apodo)';
      const lim = f.limiteDiario?.integerValue ?? f.limiteDiario?.doubleValue ?? 0;
      console.log(ap.padEnd(20), `${lim} ${Number(lim) === 0 ? '(sin límite)' : ''}`);
    }
    return;
  }

  // Buscar el doc de ese apodo
  const queryRes = await firestoreRequest('POST', `${basePath}:runQuery`, token, {
    structuredQuery: {
      from: [{ collectionId: COLLECTION }],
      where: { fieldFilter: { field: { fieldPath: 'apodo' }, op: 'EQUAL', value: { stringValue: apodo } } },
      limit: 1,
    },
  });
  if (queryRes.status !== 200) { console.error('Error:', queryRes.body); process.exit(1); }
  const docs = (Array.isArray(queryRes.body) ? queryRes.body : []).filter(r => r.document);

  if (valorArg === undefined) {
    // Solo consultar
    const lim = docs[0]?.document?.fields?.limiteDiario?.integerValue
      ?? docs[0]?.document?.fields?.limiteDiario?.doubleValue
      ?? 0;
    console.log(`Límite diario de "${apodo}": ${lim} ${Number(lim) === 0 ? '(sin límite)' : ''}`);
    return;
  }

  const valor = Number(valorArg);
  if (!Number.isInteger(valor) || valor < 0) { console.error('El valor debe ser un entero >= 0.'); process.exit(1); }

  if (docs.length > 0) {
    const docName = docs[0].document.name;
    const docId = docName.split('/documents/')[1];
    const patchRes = await firestoreRequest('PATCH', `${basePath}/${docId}?updateMask.fieldPaths=limiteDiario`, token, {
      fields: { limiteDiario: { integerValue: String(valor) } },
    });
    if (patchRes.status !== 200) { console.error('Error al actualizar:', patchRes.body); process.exit(1); }
  } else {
    const createRes = await firestoreRequest('POST', `${basePath}/${COLLECTION}`, token, {
      fields: {
        apodo: { stringValue: apodo },
        limiteDiario: { integerValue: String(valor) },
        limitePendientes: { integerValue: '35' },
      },
    });
    if (createRes.status !== 200) { console.error('Error al crear:', createRes.body); process.exit(1); }
  }

  console.log(`Listo. Límite diario de "${apodo}" -> ${valor} ${valor === 0 ? '(sin límite)' : ''}`);
}

main().catch(e => { console.error(e); process.exit(1); });

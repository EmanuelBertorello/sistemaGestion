/**
 * Pone el caso de "Sergio Damian Medina" en el historial de Daiana como interesado.
 * Uso: node poner-sergio-daiana.mjs
 */
import { readFileSync } from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';

const PROJECT_ID   = 'bdcap-a3b7b';
const COLECCION    = 'BDmadre';
const DAIANA_EMAIL = 'daianadagostino18@gmail.com';
const DAIANA_APODO = 'daiana';

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

const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
if (!cfg.tokens?.refresh_token) { console.error('No hay refresh_token.'); process.exit(1); }

console.log('Obteniendo token...');
const token = await refreshToken(cfg.tokens.refresh_token);
console.log('Token OK\n');

const basePath = `/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Los nombres son APELLIDO NOMBRE, buscar por prefijo MEDINA
const res = await firestoreRequest('POST', `${basePath}:runQuery`, token, {
  structuredQuery: {
    from: [{ collectionId: COLECCION }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'Trabajador' },
        op: 'GREATER_THAN_OR_EQUAL',
        value: { stringValue: 'MEDINA' }
      }
    },
    limit: 100
  }
});

if (res.status !== 200) {
  console.error('Error al consultar:', res.status, JSON.stringify(res.body).slice(0, 300));
  process.exit(1);
}

const todos = (res.body || []).filter(r => r.document);
console.log(`Docs con Trabajador >= "MEDINA": ${todos.length}`);

// Mostrar todos los MEDINA
const medinas = todos.filter(d => (d.document.fields?.Trabajador?.stringValue ?? '').toUpperCase().startsWith('MEDINA'));
console.log(`\nDocs que empiezan con MEDINA: ${medinas.length}`);
medinas.forEach(d => {
  const f = d.document.fields;
  console.log(`  -> "${f?.Trabajador?.stringValue}" | CUIL: ${f?.CUIL?.stringValue ?? '?'} | Estado: ${f?.estado?.stringValue ?? 'libre'} | ID: ${d.document.name.split('/').pop()}`);
});

// Buscar el Sergio
const target = medinas.find(d => {
  const nombre = (d.document.fields?.Trabajador?.stringValue ?? '').toLowerCase();
  return nombre.includes('sergio');
});

if (!target) {
  console.error('\nNo se encontro MEDINA SERGIO. Medinas encontradas arriba.');
  process.exit(1);
}

const docId = target.document.name.split('/').pop();
const f = target.document.fields;
console.log(`\nCaso seleccionado: "${f?.Trabajador?.stringValue}" (ID: ${docId})`);
console.log(`Estado actual: ${f?.estado?.stringValue ?? '-'} | procesadoPor: ${f?.procesadoPor?.stringValue ?? '-'}`);

const ts = new Date().toISOString();
const patchUrl = `${basePath}/${COLECCION}/${docId}?` +
  'updateMask.fieldPaths=procesado' +
  '&updateMask.fieldPaths=estado' +
  '&updateMask.fieldPaths=procesadoPor' +
  '&updateMask.fieldPaths=ASGINADO' +
  '&updateMask.fieldPaths=procesadoTimestamp';

const patchBody = {
  fields: {
    procesado:          { booleanValue: true },
    estado:             { stringValue: 'interesado' },
    procesadoPor:       { stringValue: DAIANA_EMAIL },
    ASGINADO:           { stringValue: DAIANA_APODO },
    procesadoTimestamp: { stringValue: ts },
  }
};

console.log('\nActualizando...');
const patchRes = await firestoreRequest('PATCH', patchUrl, token, patchBody);

if (patchRes.status === 200) {
  console.log('Caso actualizado correctamente.');
  console.log(`  -> estado: interesado`);
  console.log(`  -> procesadoPor: ${DAIANA_EMAIL}`);
  console.log(`  -> ASGINADO: ${DAIANA_APODO}`);
} else {
  console.error(`Error HTTP ${patchRes.status}:`);
  console.error(JSON.stringify(patchRes.body, null, 2));
}

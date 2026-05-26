import https from 'https';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PROJECT = 'bdcap-a3b7b';
const cfgPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const TOKEN = cfg.tokens.access_token;

// Buscar todos los docs donde ASGINADO tiene espacios
const runQuery = (body) => new Promise((res, rej) => {
  const b = JSON.stringify(body);
  const req = https.request({
    hostname: 'firestore.googleapis.com',
    path: `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}`, 'Content-Length': Buffer.byteLength(b) }
  }, (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d));}catch{res([]);}}); });
  req.on('error',rej); req.write(b); req.end();
});

const patch = (docPath, fields) => new Promise((res, rej) => {
  const fieldPaths = Object.keys(fields).join(',');
  const body = JSON.stringify({ fields });
  const path_ = `/v1/${docPath}?updateMask.fieldPaths=${encodeURIComponent(fieldPaths)}`;
  const req = https.request({
    hostname: 'firestore.googleapis.com',
    path: path_, method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}`, 'Content-Length': Buffer.byteLength(body) }
  }, (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); });
  req.on('error',rej); req.write(body); req.end();
});

const g = (f, k) => (f?.[k]?.stringValue ?? '');

// Traer todos los procesados y buscar ASGINADO con espacios
const r = await runQuery({
  structuredQuery: {
    from: [{ collectionId: 'BDmadre' }],
    where: { fieldFilter: { field: { fieldPath: 'procesado' }, op: 'EQUAL', value: { booleanValue: true } } },
    limit: 5000
  }
});

const docs = r.filter(x => x.document);
const conEspacios = docs.filter(x => {
  const asginado = g(x.document.fields, 'ASGINADO');
  return asginado !== asginado.trim();
});

console.log(`Docs procesados revisados: ${docs.length}`);
console.log(`ASGINADO con espacios: ${conEspacios.length}\n`);

for (const x of conEspacios) {
  const f = x.document.fields;
  const asginado = g(f, 'ASGINADO');
  const trimmed = asginado.trim();
  const docName = x.document.name;
  console.log(`Fixing: "${asginado}" → "${trimmed}" | ${g(f,'Trabajador')}`);
  await patch(docName, { ASGINADO: { stringValue: trimmed } });
  console.log('  ✓ Corregido');
}

console.log('\nListo.');
process.exit(0);

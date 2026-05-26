import https from 'https';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PROJECT = 'bdcap-a3b7b';

// Obtener el access token del Firebase CLI
const cfgPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const ACCESS_TOKEN = cfg.tokens.access_token;

const runQuery = (collectionId, structuredQuery) => new Promise((res, rej) => {
  const body = JSON.stringify({ structuredQuery: { from: [{ collectionId }], ...structuredQuery } });
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`);
  const req = https.request({
    hostname: url.hostname, path: url.pathname, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Length': Buffer.byteLength(body) }
  }, (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d));}catch{res([]);} }); });
  req.on('error', rej); req.write(body); req.end();
});

const g = (f, k) => {
  const v = f?.[k];
  return (v?.stringValue ?? v?.booleanValue?.toString() ?? v?.timestampValue ?? v?.integerValue ?? '');
};

const CUIL1 = '20285238111', CUIL2 = '27258511714';
const NOMBRE1 = 'diraya', NOMBRE2 = 'morello';
const COLLECTIONS = ['BDmadre', 'casos_ventasi', 'casos_archivo'];

console.log('=== Buscando casos perdidos ===\n');

// 1. Buscar en todas las colecciones por CUIL y nombre
for (const col of COLLECTIONS) {
  const r = await runQuery(col, { limit: 5000 });
  const docs = r.filter(x => x.document);
  const matches = docs.filter(x => {
    const f = x.document.fields;
    const cuil = g(f,'CUIL').replace(/\D/g,'');
    const nombre = g(f,'Trabajador').toLowerCase();
    return cuil === CUIL1 || cuil === CUIL2 || nombre.includes(NOMBRE1) || nombre.includes(NOMBRE2);
  });
  if (matches.length) {
    console.log(`✓ [${col}] ${matches.length} resultado(s):`);
    for (const x of matches) {
      const f = x.document.fields;
      console.log(`  Trabajador  : ${g(f,'Trabajador')}`);
      console.log(`  CUIL        : ${g(f,'CUIL')}`);
      console.log(`  estado      : ${g(f,'estado')}`);
      console.log(`  procesado   : ${g(f,'procesado')}`);
      console.log(`  procesadoPor: ${g(f,'procesadoPor')}`);
      console.log(`  ASGINADO    : ${g(f,'ASGINADO')}`);
      console.log(`  timestamp   : ${g(f,'procesadoTimestamp')}`);
      console.log('');
    }
  } else {
    console.log(`✗ [${col}] no encontrado (${docs.length} docs revisados)`);
  }
}

// 2. Ver todos los acepto de jrvillagra en BDmadre
console.log('\n=== Aceptos de jrvillagra en BDmadre ===');
const r2 = await runQuery('BDmadre', {
  where: { fieldFilter: { field: { fieldPath: 'estado' }, op: 'EQUAL', value: { stringValue: 'acepto' } } },
  limit: 500
});
const aceptos = r2.filter(x => x.document);
const deJr = aceptos.filter(x => {
  const f = x.document.fields;
  return g(f,'procesadoPor').toLowerCase().includes('jrvillagra') || g(f,'ASGINADO').toLowerCase().includes('jrvillagra');
});
console.log(`Total acepto en BDmadre: ${aceptos.length}`);
console.log(`De jrvillagra: ${deJr.length}`);
for (const x of deJr) {
  const f = x.document.fields;
  console.log(`  ${g(f,'Trabajador')} | CUIL: ${g(f,'CUIL')} | procesadoPor: ${g(f,'procesadoPor')}`);
}

// 3. Ver estadísticas generales
console.log('\n=== Estado general de BDmadre ===');
const r3 = await runQuery('BDmadre', { limit: 5000 });
const all = r3.filter(x => x.document);
const procesados = all.filter(x => g(x.document.fields,'procesado') === 'true');
const sinProcesar = all.filter(x => g(x.document.fields,'procesado') !== 'true');
const estados = {};
for (const x of procesados) {
  const e = g(x.document.fields,'estado') || '(vacío)';
  estados[e] = (estados[e]||0) + 1;
}
console.log(`Total en BDmadre: ${all.length} (${procesados.length} procesados, ${sinProcesar.length} en cola)`);
console.log('Estados:', JSON.stringify(estados));

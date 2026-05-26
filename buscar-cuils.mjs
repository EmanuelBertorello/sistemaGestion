// Usa el token OAuth del Firebase CLI para autenticarse
import { execSync } from 'child_process';
import https from 'https';

const PROJECT = 'bdcap-a3b7b';
const CUILS = ['20285238111', '27258511714'];

// Obtener access token del CLI
let token;
try {
  token = execSync('firebase --project ' + PROJECT + ' use --add 2>nul && firebase login:ci --no-localhost 2>nul', { stdio: 'pipe' });
} catch {}

// Usar la REST API de Firestore con una query estructurada
const getToken = () => new Promise((resolve, reject) => {
  const proc = execSync('node -e "const {GoogleAuth} = require(\'google-auth-library\'); const auth = new GoogleAuth({scopes:[\'https://www.googleapis.com/auth/cloud-platform\']}); auth.getAccessToken().then(t=>process.stdout.write(t)).catch(()=>process.exit(1))"',
    { cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe' });
  resolve(proc.trim());
});

// Alternativa: usar la REST API pública de Firestore con API key
// Los documentos se leen via runQuery

const apiKey = 'AIzaSyCD6mhPkLrKJ85uyGj9p08jKC9lp84eJnY';
const dbUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const runQuery = (cuil) => new Promise((res, rej) => {
  const body = JSON.stringify({
    structuredQuery: {
      from: [{ collectionId: 'BDmadre' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'CUIL' },
          op: 'EQUAL',
          value: { stringValue: cuil }
        }
      },
      limit: 5
    }
  });

  const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery?key=${apiKey}`);

  const req = https.request({
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, (r) => {
    let data = '';
    r.on('data', c => data += c);
    r.on('end', () => res(JSON.parse(data)));
  });
  req.on('error', rej);
  req.write(body);
  req.end();
});

for (const cuil of CUILS) {
  console.log(`\n=== Buscando CUIL: ${cuil} ===`);
  const results = await runQuery(cuil);
  if (!results || results.length === 0 || !results[0].document) {
    console.log('  NO encontrado en BDmadre');

    // Buscar en casos_ventasi
    const body2 = JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'casos_ventasi' }],
        where: { fieldFilter: { field: { fieldPath: 'CUIL' }, op: 'EQUAL', value: { stringValue: cuil } } },
        limit: 3
      }
    });
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery?key=${apiKey}`;
    const r2 = await new Promise((res, rej) => {
      const req = https.request(new URL(url), { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (r) => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
      });
      req.on('error', rej);
      req.write(body2);
      req.end();
    });
    if (r2[0]?.document) console.log('  ENCONTRADO en casos_ventasi!');
    else console.log('  Tampoco en casos_ventasi');
    continue;
  }

  for (const r of results) {
    if (!r.document) continue;
    const f = r.document.fields;
    const get = (k) => f[k]?.stringValue ?? f[k]?.booleanValue ?? f[k]?.timestampValue ?? '—';
    console.log('  Trabajador  :', get('Trabajador'));
    console.log('  CUIL        :', get('CUIL'));
    console.log('  estado      :', get('estado'));
    console.log('  procesado   :', get('procesado'));
    console.log('  procesadoPor:', get('procesadoPor'));
    console.log('  ASGINADO    :', get('ASGINADO'));
    console.log('  esVentaSi   :', get('esVentaSi'));
    console.log('  timestamp   :', get('procesadoTimestamp'));
  }
}

import { readFileSync } from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';

const PROJECT_ID = 'bdcap-a3b7b';
const DOC_ID     = 'EmEytAc4XiTxpxBVxNe2'; // MEDINA SERGIO DAMIAN
const COLECCION  = 'BDmadre';
const CFG_PATH   = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const CLIENT_ID  = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

function refreshToken(rt) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }).toString();
    const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : reject(new Error(d)); } catch { reject(new Error(d)); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function patchDoc(urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({ hostname: 'firestore.googleapis.com', path: urlPath, method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Content-Length': Buffer.byteLength(bodyStr) } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject); req.write(bodyStr); req.end();
  });
}

const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
console.log('Obteniendo token...');
const token = await refreshToken(cfg.tokens.refresh_token);
console.log('Token OK');

const base = `/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const url  = `${base}/${COLECCION}/${DOC_ID}?updateMask.fieldPaths=estado`;
const res  = await patchDoc(url, token, { fields: { estado: { stringValue: 'pendiente' } } });

if (res.status === 200) {
  console.log('OK: MEDINA SERGIO DAMIAN -> estado: pendiente');
} else {
  console.error('Error:', res.status, JSON.stringify(res.body).slice(0, 400));
}

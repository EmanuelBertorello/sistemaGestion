import { setGlobalOptions } from 'firebase-functions';
import { onRequest } from 'firebase-functions/https';

setGlobalOptions({ maxInstances: 10 });

const CERTERO_BASE = 'https://certero.com.ar';
const CERTERO_TOKEN = '73e2400f32cb11f1b461005056017e8e';

export const certeroProxy = onRequest({ invoker: 'public' }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const path = req.path;
  const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const targetUrl = `${CERTERO_BASE}${path}${query}`;

  try {
    const response = await fetch(targetUrl, {
      headers: { 'Authorization': `Bearer ${CERTERO_TOKEN}` }
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

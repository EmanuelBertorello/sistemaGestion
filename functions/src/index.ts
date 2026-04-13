import { setGlobalOptions } from 'firebase-functions';
import { onRequest } from 'firebase-functions/https';
import { request as undiciRequest, Agent } from 'undici';

setGlobalOptions({ maxInstances: 10 });

const CERTERO_BASE = 'https://certero.com.ar';
const CERTERO_TOKEN = '73e2400f32cb11f1b461005056017e8e';

// Agente con HTTP/2 y TLS más parecido a un browser
const agent = new Agent({
  allowH2: true,
  connect: {
    rejectUnauthorized: false,
  }
});

export const certeroProxy = onRequest({ invoker: 'public' }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const path = req.path;
  const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const targetUrl = `${CERTERO_BASE}${path}${query}`;

  try {
    const { statusCode, body } = await undiciRequest(targetUrl, {
      method: 'GET',
      dispatcher: agent,
      headers: {
        'Authorization': `Bearer ${CERTERO_TOKEN}`,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://certero.com.ar/login',
        'Origin': 'https://certero.com.ar',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'Connection': 'keep-alive',
      }
    });

    const text = await body.text();

    try {
      const data = JSON.parse(text);
      res.status(statusCode).json(data);
    } catch {
      res.status(502).json({ error: 'Respuesta no JSON', status: statusCode, body: text.slice(0, 300) });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

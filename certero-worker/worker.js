const CERTERO_BASE  = 'https://certero.com.ar';
const CERTERO_TOKEN = '73e2400f32cb11f1b461005056017e8e';

export default {
  async fetch(request) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    const url   = new URL(request.url);
    const target = `${CERTERO_BASE}${url.pathname}${url.search}`;

    const upstream = await fetch(target, {
      method: 'GET',
      headers: {
        'Authorization':   `Bearer ${CERTERO_TOKEN}`,
        'Accept':          'application/json',
        'Accept-Language': 'es-AR,es;q=0.9',
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    const body = await upstream.text();

    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(),
      },
    });
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
}

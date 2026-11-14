/*
 * StreamHub · ponte para a TV Grátis (Cloudflare Worker)
 *
 * Deixa o site tocar canais abertos que o navegador bloquearia:
 *  - emissoras que não liberam tocar em outros sites (CORS)
 *  - links "http" (o site é "https")
 *
 * Só aceita pedidos vindos do seu site (lista ORIGENS abaixo).
 */
const ORIGENS = [
  'https://streamhubtv.dpdns.org',
  'https://www.streamhubtv.dpdns.org',
  'https://anotirbr.github.io'
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const origem = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ORIGENS.includes(origem) ? origem : ORIGENS[0],
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
      'Vary': 'Origin'
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (origem && !ORIGENS.includes(origem)) return new Response('origem nao permitida', { status: 403, headers: cors });
    if (url.pathname !== '/p') return new Response('StreamHub ponte OK', { headers: cors });

    const alvo = url.searchParams.get('u');
    if (!alvo || !/^https?:\/\//i.test(alvo)) return new Response('link invalido', { status: 400, headers: cors });

    const h = new Headers({ 'User-Agent': UA, 'Accept': '*/*' });
    const range = req.headers.get('Range');
    if (range) h.set('Range', range);

    let r;
    try {
      r = await fetch(alvo, { headers: h, redirect: 'follow', cf: { cacheTtl: 2 } });
    } catch (e) {
      return new Response('emissora fora do ar', { status: 502, headers: cors });
    }

    const final = r.url || alvo;
    const tipo = r.headers.get('Content-Type') || '';
    const ehLista = /mpegurl/i.test(tipo) || /\.m3u8?$/i.test(new URL(final).pathname);

    if (ehLista && r.ok) {
      const txt = await r.text();
      const ponte = u => url.origin + '/p?u=' + encodeURIComponent(new URL(u, final).href);
      const saida = txt.split(/\r?\n/).map(l => {
        const t = l.trim();
        if (!t) return l;
        if (t[0] === '#') return l.replace(/URI="([^"]+)"/g, (m, u) => 'URI="' + ponte(u) + '"');
        return ponte(t);
      }).join('\n');
      return new Response(saida, {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache' }
      });
    }

    const out = new Headers(cors);
    for (const k of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'Cache-Control']) {
      const v = r.headers.get(k);
      if (v) out.set(k, v);
    }
    return new Response(r.body, { status: r.status, headers: out });
  }
};

// api/analyze.js
// Serverless proxy for safe cross-origin fetching (CORS-friendly).
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { url, type = 'html' } = req.query;

    if (!url) {
      return res.status(200).json({
        success: true,
        status: 'ready',
        message: 'API ready. Use ?url=<URL or domain>&type=html|robots|sitemap|llms'
      });
    }

    const normalize = (u) => {
      try { new URL(u); return u; }
      catch { return 'https://' + u.replace(/^https?:\/\//, '').replace(/\/$/, ''); }
    };

    let target = normalize(url);

    if (type === 'robots' || type === 'llms') {
      const { protocol, hostname } = new URL(target);
      target = `${protocol}//${hostname}/${type === 'robots' ? 'robots.txt' : 'llms.txt'}`;
    } else if (type === 'sitemap') {
      const { protocol, hostname } = new URL(target);
      const candidates = [
        `${protocol}//${hostname}/sitemap.xml`,
        `${protocol}//${hostname}/sitemap_index.xml`,
        `${protocol}//${hostname}/sitemap`
      ];
      for (const c of candidates) {
        const hit = await tryFetch(c);
        if (hit.success) return res.status(200).json(hit);
      }
      return res.status(404).json({ success: false, error: 'Sitemap not found' });
    }

    const result = await tryFetch(target);
    if (!result.success) {
      return res.status(result.statusCode || 500).json({ success: false, error: result.error });
    }
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.message || 'Unhandled error' });
  }
}

async function tryFetch(targetUrl) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    const resp = await fetch(targetUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'LLM-Visibility-Tool/1.0 (+https://llm-visibility-tool-chi.vercel.app/)',
        'Accept': 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8'
      }
    });
    clearTimeout(t);

    const ct = resp.headers.get('content-type') || '';
    const isText = ct.includes('text') || ct.includes('xml') || ct.includes('json') || ct === '';
    const content = isText ? await resp.text() : '';

    if (!resp.ok) {
      return { success: false, statusCode: resp.status, error: `HTTP ${resp.status}`, url: targetUrl };
    }

    return {
      success: true,
      url: targetUrl,
      finalUrl: resp.url,
      statusCode: resp.status,
      content,
      length: content.length,
      contentType: ct
    };
  } catch (e) {
    return { success: false, error: e.name === 'AbortError' ? 'Timeout' : e.message, url: targetUrl };
  }
}

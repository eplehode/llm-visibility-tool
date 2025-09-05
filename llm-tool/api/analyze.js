// api/analyze.js
// Serverless proxy for fetching HTML and plain-text resources with CORS.
// Works on Vercel (Node runtime). Supports ?url=... and optional ?type=html|robots|sitemap|llms.

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { url, type = 'html' } = req.query;

    // Simple readiness ping
    if (!url) {
      return res.status(200).json({
        message:
          'API is ready. Provide ?url=<full URL or domain>&type=html|robots|sitemap|llms',
        status: 'ready',
      });
    }

    // Normalize target URL
    const normalize = (u) => {
      if (!u) return null;
      try {
        // If already absolute, keep it
        new URL(u);
        return u;
      } catch {
        // Treat as domain
        return `https://${u.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
      }
    };

    let target = normalize(url);

    // If caller passed just a domain but requested a special type, build the right path
    if (type === 'robots') {
      const { protocol, hostname } = new URL(target);
      target = `${protocol}//${hostname}/robots.txt`;
    } else if (type === 'llms') {
      const { protocol, hostname } = new URL(target);
      target = `${protocol}//${hostname}/llms.txt`;
    } else if (type === 'sitemap') {
      // If a specific sitemap URL is given, we'll try that first; otherwise probe common paths
      const maybeSpecific =
        /sitemap/i.test(target) && /\.(xml|txt)?$/i.test(target);
      if (!maybeSpecific) {
        const { protocol, hostname } = new URL(target);
        const candidates = [
          `${protocol}//${hostname}/sitemap.xml`,
          `${protocol}//${hostname}/sitemap_index.xml`,
          `${protocol}//${hostname}/sitemap`,
        ];
        // Try each until one works
        for (const c of candidates) {
          const hit = await tryFetch(c);
          if (hit.success) {
            return res.status(200).json(hit);
          }
        }
        // None worked
        return res
          .status(404)
          .json({ success: false, error: 'Sitemap not found', tried: candidates });
      }
    }

    const result = await tryFetch(target);

    if (!result.success) {
      return res
        .status(result.statusCode || 500)
        .json({ success: false, error: result.error || 'Fetch failed' });
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Unhandled error',
      details: err?.message,
    });
  }
}

// Helper: fetch with a timeout, friendly headers, follows redirects.
async function tryFetch(targetUrl) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000); // 12s timeout

    const resp = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // A neutral UA that most sites accept
        'User-Agent':
          'Mozilla/5.0 (compatible; LLM-Visibility-Tool/1.0; +https://example.local)',
        'Accept':
          'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8',
      },
    });
    clearTimeout(timer);

    const ct = resp.headers.get('content-type') || '';
    const isText =
      ct.includes('text/') ||
      ct.includes('xml') ||
      ct.includes('json') ||
      ct === '';

    const content = isText ? await resp.text() : '';

    if (!resp.ok) {
      return {
        success: false,
        statusCode: resp.status,
        error: `HTTP ${resp.status}`,
        url: targetUrl,
        finalUrl: resp.url,
        contentType: ct,
      };
    }

    return {
      success: true,
      url: targetUrl,
      finalUrl: resp.url,
      statusCode: resp.status,
      content,
      length: content.length,
      contentType: ct,
    };
  } catch (e) {
    return {
      success: false,
      error: e.name === 'AbortError' ? 'Timeout' : e.message,
      url: targetUrl,
    };
  }
}

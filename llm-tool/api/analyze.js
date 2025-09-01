// Commercial version with multiple security layers
// Save as: api/analyze.js

import { kv } from '@vercel/kv'; // npm install @vercel/kv

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // ========================================
  // SECURITY LAYER 1: API Key Validation
  // ========================================
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (!apiKey) {
    return res.status(401).json({ 
      error: 'API key required',
      message: 'Get your API key at https://yourdomain.com/pricing',
      code: 'MISSING_API_KEY'
    });
  }

  // Check if API key exists in your database
  // For now, using environment variables for valid keys
  const validKeys = (process.env.VALID_API_KEYS || '').split(',');
  
  if (!validKeys.includes(apiKey)) {
    return res.status(401).json({ 
      error: 'Invalid API key',
      message: 'This API key is not recognized. Contact support if you believe this is an error.',
      code: 'INVALID_API_KEY'
    });
  }

  // ========================================
  // SECURITY LAYER 2: Rate Limiting
  // ========================================
  try {
    // Rate limit by API key (not IP, since legitimate users might share IPs)
    const rateLimitKey = `ratelimit:${apiKey}`;
    const requestCount = await kv.incr(rateLimitKey);
    
    // Set expiry on first request
    if (requestCount === 1) {
      await kv.expire(rateLimitKey, 3600); // Reset every hour
    }
    
    // Check rate limits based on API key tier
    const limits = {
      'trial': 10,      // 10 requests per hour for trial keys
      'basic': 100,     // 100 per hour for basic plan
      'pro': 1000,      // 1000 per hour for pro plan
      'unlimited': 999999  // Essentially unlimited
    };
    
    // Determine tier (you'd fetch this from your database in production)
    const tier = process.env[`TIER_${apiKey}`] || 'basic';
    const limit = limits[tier] || limits.basic;
    
    if (requestCount > limit) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded',
        message: `You've exceeded your ${tier} plan limit of ${limit} requests per hour.`,
        resetAt: new Date(Date.now() + 3600000).toISOString(),
        upgradeUrl: 'https://yourdomain.com/pricing',
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }
    
    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - requestCount));
    res.setHeader('X-RateLimit-Reset', new Date(Date.now() + 3600000).toISOString());
    
  } catch (kvError) {
    // If KV is not set up, continue without rate limiting
    // (for development or if you prefer not to use rate limiting)
    console.log('KV not configured, skipping rate limits');
  }

  // ========================================
  // SECURITY LAYER 3: Usage Tracking
  // ========================================
  try {
    // Track usage for billing
    const usageKey = `usage:${apiKey}:${new Date().toISOString().split('T')[0]}`;
    await kv.incr(usageKey);
    await kv.expire(usageKey, 2592000); // Keep for 30 days
  } catch (error) {
    console.log('Usage tracking failed:', error);
  }

  // ========================================
  // MAIN FUNCTIONALITY
  // ========================================
  const { url, type = 'html' } = req.query;

  if (!url) {
    return res.status(400).json({ 
      error: 'URL parameter is required',
      message: 'Please provide a URL to analyze',
      example: '/api/analyze?url=example.com&apiKey=YOUR_KEY',
      code: 'MISSING_URL'
    });
  }

  // Clean and validate URL
  let targetUrl = url.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  
  // Block internal/private IPs for security
  const blockedPatterns = [
    /^localhost/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^0\.0\.0\.0/
  ];
  
  if (blockedPatterns.some(pattern => pattern.test(targetUrl))) {
    return res.status(403).json({ 
      error: 'Invalid URL',
      message: 'Internal or private network addresses are not allowed',
      code: 'BLOCKED_URL'
    });
  }

  // Add protocol if missing
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
  }

  // Log the request (for analytics)
  console.log(`[${apiKey.substring(0, 8)}...] Analyzing: ${targetUrl}`);

  try {
    let resourceUrl = targetUrl;
    
    switch(type) {
      case 'robots':
        resourceUrl = new URL('/robots.txt', targetUrl).href;
        break;
      case 'sitemap':
        resourceUrl = new URL('/sitemap.xml', targetUrl).href;
        break;
      case 'llms':
        resourceUrl = new URL('/llms.txt', targetUrl).href;
        break;
      default:
        resourceUrl = targetUrl;
    }

    // Fetch with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    const response = await fetch(resourceUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'LLM-Visibility-Checker/2.0 (Commercial)',
        'Accept': type === 'html' ? 'text/html,application/xhtml+xml' : '*/*',
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `Failed to fetch: ${response.status}`,
        message: response.statusText,
        url: resourceUrl,
        code: 'FETCH_FAILED'
      });
    }

    const contentType = response.headers.get('content-type') || '';
    const content = await response.text();

    // Success response
    res.status(200).json({
      success: true,
      url: resourceUrl,
      originalUrl: url,
      contentType: contentType,
      content: content,
      contentLength: content.length,
      timestamp: new Date().toISOString(),
      credits: {
        used: 1,
        // In production, fetch actual remaining credits from database
        remaining: 'Check dashboard for remaining credits'
      }
    });

  } catch (error) {
    console.error('Fetch error:', error);
    
    if (error.name === 'AbortError') {
      return res.status(504).json({ 
        error: 'Request timeout',
        message: 'The target website took too long to respond',
        code: 'TIMEOUT'
      });
    }
    
    return res.status(500).json({ 
      error: 'Analysis failed',
      message: 'Unable to analyze the website. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      code: 'INTERNAL_ERROR'
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: '10mb',
  },
  maxDuration: 30,
};
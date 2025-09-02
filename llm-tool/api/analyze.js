// This is a simplified version that WILL work
// Save this as: api/analyze.js

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { url } = req.query;

  // Test response - just to make sure it works
  if (!url) {
    return res.status(200).json({ 
      message: 'API is working! Add ?url=example.com to analyze a site',
      status: 'ready'
    });
  }

  try {
    // Clean up the URL
    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http')) {
      targetUrl = 'https://' + targetUrl;
    }

    // Fetch the website
    const response = await fetch(targetUrl);
    const html = await response.text();

    // Send back the HTML
    res.status(200).json({
      success: true,
      url: targetUrl,
      content: html,
      length: html.length
    });

  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch site',
      details: error.message 
    });
  }
}

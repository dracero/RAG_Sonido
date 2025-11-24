/**
 * Simple Qdrant Proxy
 * Usage: /api/proxy?path=collections/my_collection
 */
export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, api-key');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const qdrantUrl = process.env.QDRANT_URL;
    const qdrantApiKey = process.env.QDRANT_KEY;

    if (!qdrantUrl || !qdrantApiKey) {
        return res.status(500).json({ error: 'Missing configuration' });
    }

    // Get path from query parameter
    const path = req.query.path;
    if (!path) {
        return res.status(400).json({ error: 'Missing path parameter' });
    }

    // Construct target URL
    // Try to remove port 6333 if present to use standard HTTPS which is often faster/more reliable from serverless
    let baseUrl = qdrantUrl.endsWith('/') ? qdrantUrl.slice(0, -1) : qdrantUrl;

    // If URL has :6333, we might want to try without it if connection fails, 
    // but for now let's stick to what's provided but add a timeout signal
    const targetUrl = `${baseUrl}/${path}`;

    console.log(`[Proxy] ${req.method} -> ${targetUrl}`);

    try {
        const controller = new AbortController();
        // Set a timeout of 9 seconds (Vercel Hobby limit is 10s)
        const timeoutId = setTimeout(() => controller.abort(), 9000);

        const options = {
            method: req.method,
            headers: {
                'api-key': qdrantApiKey,
                'Content-Type': 'application/json'
            },
            signal: controller.signal
        };

        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
            options.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        }

        const response = await fetch(targetUrl, options);
        clearTimeout(timeoutId);

        const data = await response.json().catch(() => ({}));

        return res.status(response.status).json(data);
    } catch (error) {
        console.error('[Proxy Error]', error);
        if (error.name === 'AbortError') {
            return res.status(504).json({ error: 'Gateway Timeout - Qdrant took too long to respond' });
        }
        return res.status(500).json({ error: error.message });
    }
}

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
    const baseUrl = qdrantUrl.endsWith('/') ? qdrantUrl.slice(0, -1) : qdrantUrl;
    const targetUrl = `${baseUrl}/${path}`;

    console.log(`[Proxy] ${req.method} -> ${targetUrl}`);

    try {
        const options = {
            method: req.method,
            headers: {
                'api-key': qdrantApiKey,
                'Content-Type': 'application/json'
            }
        };

        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
            options.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        }

        const response = await fetch(targetUrl, options);
        const data = await response.json().catch(() => ({}));

        return res.status(response.status).json(data);
    } catch (error) {
        console.error('[Proxy Error]', error);
        return res.status(500).json({ error: error.message });
    }
}

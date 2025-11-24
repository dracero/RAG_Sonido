/**
 * Vercel Serverless Function to proxy requests to Qdrant
 * This handles all requests to /api/qdrant/* and forwards them to the Qdrant service
 */
export default async function handler(req, res) {
    // Get the path from the request (everything after /api/qdrant/)
    const { path: pathParts } = req.query;
    const path = Array.isArray(pathParts) ? pathParts.join('/') : pathParts || '';

    // Get Qdrant credentials from environment variables
    const qdrantUrl = process.env.QDRANT_URL;
    const qdrantApiKey = process.env.QDRANT_KEY;

    if (!qdrantUrl || !qdrantApiKey) {
        return res.status(500).json({
            error: 'Qdrant configuration missing',
            details: 'QDRANT_URL or QDRANT_KEY not set in environment variables'
        });
    }

    // Build the target URL
    // Remove trailing slash from qdrantUrl if present
    const baseUrl = qdrantUrl.endsWith('/') ? qdrantUrl.slice(0, -1) : qdrantUrl;
    const targetUrl = `${baseUrl}/${path}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;

    console.log(`[Qdrant Proxy] ${req.method} ${targetUrl}`);

    try {
        // Forward the request to Qdrant
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'api-key': qdrantApiKey,
                'Content-Type': 'application/json',
                ...(req.headers['content-type'] && { 'Content-Type': req.headers['content-type'] })
            },
            body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
        });

        // Get response data
        const contentType = response.headers.get('content-type');
        let data;

        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            data = await response.text();
        }

        // Return the response from Qdrant
        return res.status(response.status).json(data);

    } catch (error) {
        console.error('[Qdrant Proxy] Error:', error);
        return res.status(500).json({
            error: 'Failed to proxy request to Qdrant',
            details: error.message
        });
    }
}

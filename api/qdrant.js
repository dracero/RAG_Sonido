/**
 * Vercel Serverless Function to proxy requests to Qdrant
 * This handles all requests to /api/qdrant and forwards them to the Qdrant service
 */
export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, api-key');

    // Handle OPTIONS request for CORS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Get Qdrant credentials from environment variables
    const qdrantUrl = process.env.QDRANT_URL;
    const qdrantApiKey = process.env.QDRANT_KEY;

    if (!qdrantUrl || !qdrantApiKey) {
        console.error('[Qdrant Proxy] Missing credentials');
        return res.status(500).json({
            error: 'Qdrant configuration missing',
            details: 'QDRANT_URL or QDRANT_KEY not set in environment variables'
        });
    }

    // Extract the path after /api/qdrant
    // req.url will be something like /api/qdrant/collections or /api/qdrant/collections/RAG_Sonido
    let targetPath = req.url.replace('/api/qdrant', '');

    // Remove leading slash if present
    if (targetPath.startsWith('/')) {
        targetPath = targetPath.substring(1);
    }

    // Build the target URL
    const baseUrl = qdrantUrl.endsWith('/') ? qdrantUrl.slice(0, -1) : qdrantUrl;
    const targetUrl = targetPath ? `${baseUrl}/${targetPath}` : baseUrl;

    console.log(`[Qdrant Proxy] ${req.method} ${targetUrl}`);

    try {
        // Prepare request options
        const options = {
            method: req.method,
            headers: {
                'api-key': qdrantApiKey,
                'Content-Type': 'application/json'
            }
        };

        // Add body for non-GET/HEAD requests
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
            options.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        }

        // Forward the request to Qdrant
        const response = await fetch(targetUrl, options);

        // Get response data
        const contentType = response.headers.get('content-type');
        let data;

        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            data = await response.text();
        }

        console.log(`[Qdrant Proxy] Response: ${response.status}`);

        // Return the response from Qdrant
        if (typeof data === 'string') {
            return res.status(response.status).send(data);
        } else {
            return res.status(response.status).json(data);
        }

    } catch (error) {
        console.error('[Qdrant Proxy] Error:', error);
        return res.status(500).json({
            error: 'Failed to proxy request to Qdrant',
            details: error.message
        });
    }
}

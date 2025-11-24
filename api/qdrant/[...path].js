/**
 * Vercel Serverless Function to proxy requests to Qdrant
 * Handles all /api/qdrant/* routes
 */
module.exports = async (req, res) => {
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
        console.error('[Qdrant Proxy] Missing env vars:', {
            hasUrl: !!qdrantUrl,
            hasKey: !!qdrantApiKey
        });
        return res.status(500).json({
            error: 'Qdrant configuration missing',
            details: 'QDRANT_URL or QDRANT_KEY not set'
        });
    }

    // Extract the full path after /api/qdrant/
    // In Vercel, req.url for /api/qdrant/collections would be just /collections
    // We need to reconstruct the full path
    const pathSegments = req.query.path || [];
    const fullPath = Array.isArray(pathSegments) ? pathSegments.join('/') : pathSegments;

    // Build the target URL
    const baseUrl = qdrantUrl.endsWith('/') ? qdrantUrl.slice(0, -1) : qdrantUrl;
    const targetUrl = fullPath ? `${baseUrl}/${fullPath}` : baseUrl;

    // Preserve query parameters
    const queryIndex = req.url.indexOf('?');
    const queryString = queryIndex !== -1 ? req.url.substring(queryIndex) : '';
    const finalUrl = targetUrl + queryString;

    console.log(`[Qdrant Proxy] ${req.method} ${finalUrl}`);

    try {
        // Prepare fetch options
        const fetchOptions = {
            method: req.method,
            headers: {
                'api-key': qdrantApiKey,
                'Content-Type': 'application/json'
            }
        };

        // Add body for non-GET/HEAD requests
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
            fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        }

        // Forward the request to Qdrant
        const response = await fetch(finalUrl, fetchOptions);

        // Get response data
        const contentType = response.headers.get('content-type');
        let data;

        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            data = await response.text();
        }

        console.log(`[Qdrant Proxy] Response: ${response.status}`);

        // Return the response
        if (typeof data === 'string') {
            return res.status(response.status).send(data);
        }
        return res.status(response.status).json(data);

    } catch (error) {
        console.error('[Qdrant Proxy] Error:', error.message);
        return res.status(500).json({
            error: 'Failed to proxy request to Qdrant',
            details: error.message
        });
    }
};

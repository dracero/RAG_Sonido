/**
 * Debug endpoint to test Qdrant connectivity from Vercel
 */
module.exports = async (req, res) => {
    const qdrantUrl = process.env.QDRANT_URL;
    const qdrantApiKey = process.env.QDRANT_KEY;

    console.log('[Debug] Environment check:', {
        hasUrl: !!qdrantUrl,
        hasKey: !!qdrantApiKey,
        urlValue: qdrantUrl ? `${qdrantUrl.substring(0, 20)}...` : 'missing'
    });

    if (!qdrantUrl || !qdrantApiKey) {
        return res.status(500).json({
            error: 'Missing environment variables',
            hasUrl: !!qdrantUrl,
            hasKey: !!qdrantApiKey
        });
    }

    // Test 1: Try to connect to Qdrant root
    const baseUrl = qdrantUrl.endsWith('/') ? qdrantUrl.slice(0, -1) : qdrantUrl;
    const testUrl = `${baseUrl}/collections`;

    console.log('[Debug] Attempting to connect to:', testUrl);

    try {
        const response = await fetch(testUrl, {
            method: 'GET',
            headers: {
                'api-key': qdrantApiKey,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json().catch(() => response.text());

        console.log('[Debug] Qdrant response status:', response.status);

        return res.status(200).json({
            success: response.ok,
            status: response.status,
            statusText: response.statusText,
            url: testUrl,
            response: data,
            headers: Object.fromEntries(response.headers.entries())
        });

    } catch (error) {
        console.error('[Debug] Connection error:', error);

        return res.status(500).json({
            error: 'Failed to connect to Qdrant',
            message: error.message,
            stack: error.stack,
            url: testUrl
        });
    }
};

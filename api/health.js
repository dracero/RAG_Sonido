/**
 * Vercel Serverless Function - Health Check
 */
export default async function handler(req, res) {
    console.log('[Health Check] Endpoint accessed');

    const hasUrl = !!process.env.QDRANT_URL;
    const hasKey = !!process.env.QDRANT_KEY;

    return res.status(200).json({
        status: 'API route is working',
        timestamp: new Date().toISOString(),
        environment: {
            hasQdrantUrl: hasUrl,
            hasQdrantKey: hasKey,
            nodeVersion: process.version
        }
    });
}

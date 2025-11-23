import { QdrantClient } from '@qdrant/js-client-rest';
import { QdrantService } from './qdrant-service';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple .env parser
function loadEnv() {
    try {
        const envPath = path.resolve(__dirname, '.env.local');
        console.log('Loading .env from:', envPath);
        if (!fs.existsSync(envPath)) {
            console.warn('.env.local file not found');
            return {};
        }
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const env: Record<string, string> = {};
        envContent.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                const value = match[2].trim().replace(/^["']|["']$/g, ''); // Remove quotes
                env[key] = value;
            }
        });
        console.log('Found keys:', Object.keys(env));
        return env;
    } catch (error) {
        console.error('Error loading .env.local:', error);
        return {};
    }
}

async function verifyQdrant() {
    const env = loadEnv();
    const qdrantUrl = env.QDRANT_URL;
    const qdrantApiKey = env.QDRANT_API_KEY || env.QDRANT_KEY;
    const geminiApiKey = env.GEMINI_API_KEY || env.API_KEY;

    if (!qdrantUrl || !qdrantApiKey || !geminiApiKey) {
        console.error('Missing configuration in .env.local');
        console.log('QDRANT_URL:', !!qdrantUrl);
        console.log('QDRANT_KEY:', !!qdrantApiKey);
        console.log('GEMINI_API_KEY:', !!geminiApiKey);
        return;
    }

    console.log(`Connecting to Qdrant at ${qdrantUrl}...`);

    const service = new QdrantService(qdrantUrl, qdrantApiKey, geminiApiKey);

    try {
        console.log('Initializing collection...');
        await service.initializeCollection();
        console.log('Collection initialized.');

        // Test Data
        const testChunks = [
            {
                text: "This is a test chunk to verify Qdrant loading.",
                index: 0,
                fileName: "test_verification.txt",
                totalChunks: 1
            }
        ];

        console.log('Storing test chunk...');
        await service.storeChunks(testChunks);
        console.log('Test chunk stored.');

        console.log('Searching for test chunk...');
        const results = await service.searchRelevantChunks("verify Qdrant loading");

        if (results.length > 0) {
            console.log('SUCCESS: Found relevant chunks:');
            results.forEach(r => console.log(`- [${r.score.toFixed(4)}] ${r.text}`));
        } else {
            console.error('FAILURE: No chunks found after storing.');
        }

        // Cleanup (optional, but good to keep it clean)
        console.log('Cleaning up test data...');
        await service.deleteFileChunks("test_verification.txt");
        console.log('Cleanup complete.');

    } catch (error) {
        console.error('Error verifying Qdrant:', error);
    }
}

verifyQdrant();

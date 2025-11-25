import { QdrantClient } from '@qdrant/js-client-rest';
// @ts-ignore
import { pipeline, env } from '@xenova/transformers';

// Skip local model checks since we're in browser
env.allowLocalModels = false;

export interface ChunkWithMetadata {
    text: string;
    index: number;
    fileName: string;
    totalChunks: number;
}

export class QdrantService {
    private client: QdrantClient;
    private extractor: any = null;
    private collectionName = 'RAG_Sonido';
    private vectorSize = 384; // all-MiniLM-L6-v2 produces 384-dimensional vectors

    private debugUrl: string;
    private debugApiKey: string;

    constructor(
        qdrantUrl: string,
        qdrantApiKey: string,
        _googleApiKey: string // Unused now
    ) {
        this.client = new QdrantClient({
            url: qdrantUrl,
            apiKey: qdrantApiKey,
            checkCompatibility: false,
        });

        // Store credentials for debug fetch
        this.debugUrl = qdrantUrl;
        this.debugApiKey = qdrantApiKey;
    }

    /**
     * Helper to construct URL for proxy or direct access
     */
    private getUrl(path: string): string {
        // If we are using the Vercel proxy (URL contains /api/qdrant), switch to simple proxy
        // BUT only in production (on Vercel). Locally we use Vite proxy at /api/qdrant
        if (this.debugUrl.includes('/api/qdrant') && !import.meta.env.DEV) {
            const baseUrl = this.debugUrl.replace('/api/qdrant', '/api/proxy');
            // Ensure path doesn't start with /
            const cleanPath = path.startsWith('/') ? path.substring(1) : path;
            return `${baseUrl}?path=${encodeURIComponent(cleanPath)}`;
        }

        // Standard URL construction
        const baseUrl = this.debugUrl.endsWith('/') ? this.debugUrl.slice(0, -1) : this.debugUrl;
        const cleanPath = path.startsWith('/') ? path : `/${path}`;
        return `${baseUrl}${cleanPath}`;
    }

    /**
     * Initialize the embedding pipeline
     */
    private async initPipeline() {
        if (!this.extractor) {
            console.log('Loading embedding model...');
            this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
            console.log('Embedding model loaded');
        }
    }

    /**
     * Initialize the Qdrant collection if it doesn't exist
     */
    async initializeCollection(): Promise<void> {
        try {
            await this.initPipeline();

            // Check if collection exists using fetch
            let exists = false;
            try {
                const collectionsUrl = this.getUrl('collections');
                const response = await fetch(collectionsUrl, {
                    headers: {
                        'api-key': this.debugApiKey,
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.result && Array.isArray(data.result.collections)) {
                        exists = data.result.collections.some(
                            (col: any) => col.name === this.collectionName
                        );
                    }
                } else {
                    console.error('Failed to fetch collections:', response.status, response.statusText);
                }
            } catch (e) {
                console.error('Error checking collections with fetch:', e);
            }

            if (!exists) {
                console.log(`Creating collection: ${this.collectionName}`);
                try {
                    // Use fetch directly since client.createCollection fails with proxy path
                    const createUrl = this.getUrl(`collections/${this.collectionName}`);

                    console.log(`[QdrantService] Sending PUT request to ${createUrl}`);

                    const response = await fetch(createUrl, {
                        method: 'PUT',
                        headers: {
                            'api-key': this.debugApiKey,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            vectors: {
                                size: this.vectorSize,
                                distance: 'Cosine',
                            }
                        })
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Failed to create collection: ${response.status} ${response.statusText} - ${errorText}`);
                    }

                    console.log(`Collection ${this.collectionName} created successfully`);
                } catch (createError) {
                    console.error('Error creating collection:', createError);
                    throw createError;
                }
            } else {
                console.log(`Collection ${this.collectionName} already exists`);

                // Check if vector size matches (if possible) or just warn
                // Ideally we would check info and recreate if size mismatch, 
                // but for now let's assume if it exists it might be wrong if it was created with 768
                // We'll try to delete and recreate to be safe since we changed models
                try {
                    const info = await this.client.getCollection(this.collectionName);
                    if (info.config?.params?.vectors?.size !== this.vectorSize) {
                        console.warn(`Collection vector size mismatch! Recreating ${this.collectionName}...`);
                        await this.client.deleteCollection(this.collectionName);
                        await this.initializeCollection(); // Recurse to create
                        return;
                    }
                } catch (e) {
                    // Ignore error checking info
                }
            }
        } catch (error) {
            console.error('Error initializing collection:', error);
            throw error;
        }
    }

    /**
     * Generate embeddings using Transformers.js
     */
    private async generateEmbedding(text: string): Promise<number[]> {
        try {
            await this.initPipeline();

            const output = await this.extractor(text, { pooling: 'mean', normalize: true });
            return Array.from(output.data);
        } catch (error) {
            console.error('Error generating embedding:', error);
            throw error;
        }
    }

    /**
     * Sanitize text to remove control characters and invalid sequences
     */
    private cleanText(text: string): string {
        // Remove null bytes, control characters, and backslashes
        let cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\\]/g, '');
        // Remove any surrogate characters that could break JSON
        cleaned = cleaned.replace(/[\uD800-\uDFFF]/g, '');
        return cleaned;
    }

    /**
     * Store chunks in Qdrant with their embeddings
     */
    async storeChunks(chunks: ChunkWithMetadata[]): Promise<void> {
        try {
            console.log(`[QdrantService] Processing ${chunks.length} chunks for Qdrant...`);

            let pointsBuffer = [];
            // Batch upserts to avoid payload limits
            // Increased to 10 for better performance now that we handle errors
            const BATCH_SIZE = 10;
            let totalStored = 0;

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                console.log(`[QdrantService] Generating embedding for chunk ${i + 1}/${chunks.length}`);

                try {
                    // Sanitize text before embedding and storage
                    const cleanedText = this.cleanText(chunk.text);
                    const embedding = await this.generateEmbedding(cleanedText);

                    pointsBuffer.push({
                        id: Date.now() + i, // Simple ID generation
                        vector: embedding,
                        payload: {
                            text: cleanedText,
                            fileName: chunk.fileName,
                            chunkIndex: chunk.index,
                            totalChunks: chunk.totalChunks,
                        },
                    });

                    // If buffer is full, upsert immediately
                    if (pointsBuffer.length >= BATCH_SIZE) {
                        try {
                            await this.upsertBatch(pointsBuffer);
                            totalStored += pointsBuffer.length;
                        } catch (upsertError) {
                            console.error(`[QdrantService] Failed to upsert batch for chunk ${i + 1}:`, upsertError);
                            // Log the text that failed
                            console.log(`[QdrantService] Failed text content (${cleanedText.length} chars):`, cleanedText.substring(0, 100) + '...');
                        } finally {
                            pointsBuffer = []; // Clear buffer regardless of success/failure to prevent cascading
                        }
                        console.log(`[QdrantService] Progress: ${totalStored}/${chunks.length} chunks stored`);
                    }

                } catch (embError) {
                    console.error(`[QdrantService] Failed to process chunk ${i + 1}:`, embError);
                    // Continue with next chunk instead of failing everything? 
                    // For now, let's log and continue to try to save partial data
                }
            }

            // Upsert remaining points
            if (pointsBuffer.length > 0) {
                try {
                    await this.upsertBatch(pointsBuffer);
                    totalStored += pointsBuffer.length;
                } catch (upsertError) {
                    console.error(`[QdrantService] Failed to upsert final batch:`, upsertError);
                }
            }

            console.log(`[QdrantService] Successfully stored total ${totalStored} chunks`);
        } catch (error) {
            console.error('[QdrantService] Error storing chunks:', error);
            throw error;
        }
    }

    /**
     * Helper to upsert a batch of points
     */
    private async upsertBatch(points: any[]): Promise<void> {
        console.log(`[QdrantService] Upserting batch of ${points.length} points...`);

        // Validate vectors before sending
        const firstVector = points[0]?.vector;
        if (firstVector) {
            if (firstVector.length !== this.vectorSize) {
                console.error(`[QdrantService] CRITICAL: Vector dimension mismatch! Expected ${this.vectorSize}, got ${firstVector.length}`);
            }
            if (firstVector.some((v: number) => isNaN(v))) {
                console.error(`[QdrantService] CRITICAL: Vector contains NaN values!`);
            }
        }

        // Use fetch for upsert to ensure correct path usage
        // Use fetch for upsert to ensure correct path usage
        const upsertUrl = this.getUrl(`collections/${this.collectionName}/points?wait=true`);

        const response = await fetch(upsertUrl, {
            method: 'PUT',
            headers: {
                'api-key': this.debugApiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                points: points
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[QdrantService] Upsert failed with status ${response.status}`);
            console.error(`[QdrantService] Error response body: ${errorText}`);
            throw new Error(`Failed to upsert batch: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json();
        console.log('[QdrantService] Batch upsert successful:', result);
    }

    /**
     * Search for relevant chunks based on a query
     */
    async searchRelevantChunks(
        query: string,
        limit: number = 5
    ): Promise<Array<{ text: string; fileName: string; score: number }>> {
        try {
            // Clean the query text before embedding (same as when storing chunks)
            const cleanedQuery = this.cleanText(query);
            console.log(`[QdrantService] Generating embedding for search query: "${cleanedQuery}"`);
            const queryEmbedding = await this.generateEmbedding(cleanedQuery);
            console.log(`[QdrantService] Query embedding dimension: ${queryEmbedding.length}`);

            const searchUrl = this.getUrl(`collections/${this.collectionName}/points/search`);

            const searchPayload = {
                vector: queryEmbedding,
                limit: limit,
                with_payload: true
            };

            console.log(`[QdrantService] Searching with limit: ${limit}`);
            console.log(`[QdrantService] Search URL: ${searchUrl}`);
            console.log(`[QdrantService] Vector first 5 values:`, queryEmbedding.slice(0, 5));

            const response = await fetch(searchUrl, {
                method: 'POST',
                headers: {
                    'api-key': this.debugApiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(searchPayload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[QdrantService] Search failed with status ${response.status}`);
                console.error(`[QdrantService] Error response body: ${errorText}`);
                throw new Error(`Search failed: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const result = await response.json();
            console.log(`[QdrantService] Full Qdrant response:`, result);

            const points = result.result?.points ?? result.result ?? [];

            console.log(`[QdrantService] Found ${points.length} results`);
            if (points.length > 0) {
                console.log(`[QdrantService] Top result score: ${points[0]?.score?.toFixed(4)}`);
                console.log(`[QdrantService] Search results:`, points.map((p: any) => ({
                    fileName: p.payload?.fileName,
                    score: p.score?.toFixed(4),
                    textPreview: p.payload?.text?.substring(0, 100)
                })));
            }

            return points.map((p: any) => ({
                text: p.payload?.text ?? '',
                fileName: p.payload?.fileName ?? '',
                score: p.score ?? 0
            }));
        } catch (error) {
            console.error('Error searching chunks:', error);
            throw error;
        }
    }

    /**
     * Delete all points associated with a specific file
     */
    async deleteFileChunks(fileName: string): Promise<void> {
        try {
            await this.client.delete(this.collectionName, {
                filter: {
                    must: [
                        {
                            key: 'fileName',
                            match: { value: fileName },
                        },
                    ],
                },
            });
            console.log(`Deleted all chunks for file: ${fileName}`);
        } catch (error) {
            console.error('Error deleting file chunks:', error);
            throw error;
        }
    }

    /**
     * Clear all data from the collection
     */
    async clearCollection(): Promise<void> {
        try {
            console.log(`[QdrantService] Clearing collection ${this.collectionName}...`);
            // Use fetch for deletion to ensure correct path usage
            // Use fetch for deletion to ensure correct path usage
            const deleteUrl = this.getUrl(`collections/${this.collectionName}`);
            console.log(`[QdrantService] Sending DELETE request to ${deleteUrl}`);

            const response = await fetch(deleteUrl, {
                method: 'DELETE',
                headers: {
                    'api-key': this.debugApiKey,
                }
            });

            if (!response.ok) {
                // 404 is fine (collection doesn't exist)
                if (response.status === 404) {
                    console.log(`[QdrantService] Collection ${this.collectionName} not found (already cleared)`);
                } else {
                    throw new Error(`Failed to delete collection: ${response.status} ${response.statusText}`);
                }
            } else {
                console.log(`[QdrantService] Collection ${this.collectionName} deleted successfully`);
            }

            // Re-initialize (create empty)
            await this.initializeCollection();
            console.log(`[QdrantService] Collection ${this.collectionName} cleared and re-initialized`);
        } catch (error) {
            console.error('[QdrantService] Error clearing collection:', error);
            throw error;
        }
    }
}

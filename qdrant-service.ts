import { QdrantClient } from '@qdrant/js-client-rest';
import { GoogleGenAI } from '@google/genai';

export interface ChunkWithMetadata {
    text: string;
    index: number;
    fileName: string;
    totalChunks: number;
}

export class QdrantService {
    private client: QdrantClient;
    private genAI: GoogleGenAI;
    private collectionName = 'RAG_Sonido';
    private embeddingModel = 'text-embedding-004';
    private vectorSize = 768; // text-embedding-004 produces 768-dimensional vectors

    constructor(
        qdrantUrl: string,
        qdrantApiKey: string,
        googleApiKey: string
    ) {
        this.client = new QdrantClient({
            url: qdrantUrl,
            apiKey: qdrantApiKey,
        });

        this.genAI = new GoogleGenAI({
            apiKey: googleApiKey,
        });
    }

    /**
     * Initialize the Qdrant collection if it doesn't exist
     */
    async initializeCollection(): Promise<void> {
        try {
            // Check if collection exists
            const collections = await this.client.getCollections();
            const exists = collections.collections.some(
                (col) => col.name === this.collectionName
            );

            if (!exists) {
                console.log(`Creating collection: ${this.collectionName}`);
                await this.client.createCollection(this.collectionName, {
                    vectors: {
                        size: this.vectorSize,
                        distance: 'Cosine',
                    },
                });
                console.log(`Collection ${this.collectionName} created successfully`);
            } else {
                console.log(`Collection ${this.collectionName} already exists`);
            }
        } catch (error) {
            console.error('Error initializing collection:', error);
            throw error;
        }
    }

    /**
     * Generate embeddings for a text using Google's embedding model
     */
    private async generateEmbedding(text: string): Promise<number[]> {
        try {
            const result = await this.genAI.models.embedContent({
                model: this.embeddingModel,
                contents: [{ parts: [{ text }] }],
            });

            return result.embeddings[0].values;
        } catch (error) {
            console.error('Error generating embedding:', error);
            throw error;
        }
    }

    /**
     * Store chunks in Qdrant with their embeddings
     */
    async storeChunks(chunks: ChunkWithMetadata[]): Promise<void> {
        try {
            console.log(`Storing ${chunks.length} chunks in Qdrant...`);

            const points = [];

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                console.log(`Generating embedding for chunk ${i + 1}/${chunks.length}`);

                const embedding = await this.generateEmbedding(chunk.text);

                points.push({
                    id: Date.now() + i, // Simple ID generation
                    vector: embedding,
                    payload: {
                        text: chunk.text,
                        fileName: chunk.fileName,
                        chunkIndex: chunk.index,
                        totalChunks: chunk.totalChunks,
                    },
                });
            }

            await this.client.upsert(this.collectionName, {
                wait: true,
                points: points,
            });

            console.log(`Successfully stored ${chunks.length} chunks`);
        } catch (error) {
            console.error('Error storing chunks:', error);
            throw error;
        }
    }

    /**
     * Search for relevant chunks based on a query
     */
    async searchRelevantChunks(
        query: string,
        limit: number = 5
    ): Promise<Array<{ text: string; fileName: string; score: number }>> {
        try {
            const queryEmbedding = await this.generateEmbedding(query);

            const searchResult = await this.client.search(this.collectionName, {
                vector: queryEmbedding,
                limit: limit,
                with_payload: true,
            });

            return searchResult.map((result) => ({
                text: result.payload?.text as string,
                fileName: result.payload?.fileName as string,
                score: result.score,
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
            await this.client.deleteCollection(this.collectionName);
            await this.initializeCollection();
            console.log(`Collection ${this.collectionName} cleared`);
        } catch (error) {
            console.error('Error clearing collection:', error);
            throw error;
        }
    }
}

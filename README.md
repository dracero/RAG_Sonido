# RAG Sonido - Audio Chat with PDF RAG

This application provides a live audio chat interface with support for PDF document ingestion and Retrieval Augmented Generation (RAG) using Qdrant vector database.

## Features

- 🎤 Live audio conversation with Gemini AI
- 📄 PDF document upload and processing
- 🔍 Semantic search using Qdrant vector database
- 📹 Screen sharing capability
- 🌐 Google Search integration (optional)
- 🧩 Automatic document chunking with overlap

## Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```env
# Required: Google AI API Key
API_KEY=your_google_ai_api_key

# Optional: Qdrant Configuration (for RAG functionality)
QDRANT_URL=https://your-qdrant-instance.cloud
QDRANT_API_KEY=your_qdrant_api_key
```

### Getting Qdrant Credentials

1. Sign up for a free Qdrant Cloud account at [cloud.qdrant.io](https://cloud.qdrant.io)
2. Create a new cluster
3. Copy the cluster URL and API key
4. Add them to your `.env.local` file

## How It Works

### Without Qdrant (In-Memory Mode)
- PDFs are split into chunks of 3,000 characters with 200-character overlap
- Up to 50 chunks are included in the conversation context
- Chunks are stored in memory only

### With Qdrant (RAG Mode)
- PDFs are split into chunks and stored in Qdrant vector database
- Each chunk is embedded using Google's `text-embedding-004` model
- When you ask questions, semantic search finds the most relevant chunks
- Only relevant context is provided to the AI, improving accuracy and reducing token usage
- The collection name is `RAG_Sonido`

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Usage

1. **Start the application** and grant microphone/camera permissions
2. **Upload PDFs** using the upload button
   - Files are automatically processed and chunked
   - If Qdrant is configured, chunks are stored in the vector database
3. **Start recording** to begin the conversation
4. **Ask questions** about your uploaded documents
5. **Optional**: Enable Google Search for web-based queries

## Technical Details

### Chunking Strategy
- **Chunk Size**: 3,000 characters
- **Overlap**: 200 characters (preserves context between chunks)
- **Max Chunks in Context**: 50 (in-memory mode)

### Qdrant Integration
- **Collection**: `RAG_Sonido`
- **Vector Size**: 768 dimensions
- **Distance Metric**: Cosine similarity
- **Embedding Model**: `text-embedding-004` (Google)

### Supported Features
- Multiple PDF upload
- Individual PDF removal
- Clear all PDFs
- Real-time status updates
- Error handling and recovery

## Troubleshooting

### "Request contains an invalid argument" Error
This error occurred with very large PDFs before chunking was implemented. The current version handles large documents automatically.

### Qdrant Connection Issues
- Verify your `QDRANT_URL` and `QDRANT_API_KEY` are correct
- Check that your Qdrant cluster is running
- Look for connection status in the browser console

### PDF Processing Fails
- Ensure the PDF is not corrupted
- Check browser console for detailed error messages
- Try a smaller PDF first to verify the system is working

## License

Apache-2.0

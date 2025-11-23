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
- Each chunk is embedded using Google's `text-embedding-004` model (768 dimensions)
- **Real-time semantic search**: When you ask a question, the system:
  1. Captures your speech transcription
  2. Performs semantic search in Qdrant to find the 5 most relevant chunks
  3. Automatically sends these chunks as context to the AI
  4. The AI answers based only on the retrieved relevant excerpts
- Only relevant context is provided to the AI, improving accuracy and reducing token usage
- The collection name is `RAG_Sonido`
- Visual indicator shows Qdrant connection status in the top-left corner

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
   - If Qdrant is configured:
     - The collection is cleared
     - All PDFs (existing + new) are re-uploaded to ensure synchronization
     - You'll see progress updates showing chunks being stored
3. **Start recording** to begin the conversation
4. **Ask questions** about your uploaded documents
   - The system automatically searches for relevant chunks
   - Only the most relevant context is sent to the AI
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

### Real-Time RAG Workflow
When Qdrant is enabled, the system performs intelligent context retrieval:

1. **User speaks**: Your question is transcribed in real-time
2. **Turn completion**: When you finish speaking, the system detects the complete transcription
3. **Semantic search**: The transcription is embedded and used to search Qdrant for the 5 most relevant chunks
4. **Context injection**: Relevant excerpts are automatically sent to the AI with relevance scores
5. **AI response**: The model answers based exclusively on the retrieved context
6. **Citation**: The AI cites which document excerpts it used

This approach ensures:
- ✅ **Accuracy**: Only relevant information is considered
- ✅ **Efficiency**: Minimal token usage compared to sending all documents
- ✅ **Scalability**: Works with thousands of document chunks
- ✅ **Transparency**: You can see relevance scores in the console logs

### Supported Features
- Multiple PDF upload
- Individual PDF removal
- Clear all PDFs
- Real-time status updates
- Error handling and recovery
- **Qdrant synchronization**: When uploading new PDFs, the entire Qdrant collection is cleared and recreated with all PDFs to ensure perfect synchronization between the UI and the vector database

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

/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, LiveServerMessage, Modality, Session, Tool } from '@google/genai';
import { LitElement, css, html } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import * as pdfjsLib from 'pdfjs-dist';
import { createBlob, decode, decodeAudioData } from './utils';
import './visual-3d';
import { QdrantService, ChunkWithMetadata } from './qdrant-service';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() isSharingScreen = false;
  @state() status = '';
  @state() error = '';
  @state() selectedLanguage = 'en-US';
  @state() isGoogleSearchEnabled = false;
  @state() currentInputTranscription = '';
  @state() currentOutputTranscription = '';
  @state() transcriptionHistory: Array<{
    speaker: 'user' | 'model';
    text: string;
    sources?: Array<{ uri: string; title: string }>;
  }> = [];
  @state() pdfFileNames: string[] = [];
  @state() isProcessingPdf = false;

  @query('#captions') private captionsContainer: HTMLDivElement;

  // PDF chunking configuration
  private readonly CHUNK_SIZE = 3000; // Characters per chunk
  private readonly CHUNK_OVERLAP = 200; // Overlap between chunks for context
  private readonly MAX_CHUNKS_IN_CONTEXT = 50; // Maximum chunks to include in system instruction

  private client: GoogleGenAI;
  private session: Session | null = null;
  // FIX: Cast window to any to allow for webkitAudioContext fallback.
  private inputAudioContext = new ((window as any).AudioContext ||
    (window as any).webkitAudioContext)({ sampleRate: 16000 });
  // FIX: Cast window to any to allow for webkitAudioContext fallback.
  private outputAudioContext = new ((window as any).AudioContext ||
    (window as any).webkitAudioContext)({ sampleRate: 24000 });
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private screenStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();
  private pdfChunks = new Map<string, Array<{ text: string; index: number }>>();

  private videoElement: HTMLVideoElement;
  private videoCanvas: HTMLCanvasElement;
  private videoFrameInterval: number;
  private qdrantService: QdrantService | null = null;
  @state() useQdrant = false;
  @state() qdrantStatus = '';

  private readonly languages = [
    { code: 'en-US', name: 'English (US)' },
    { code: 'en-GB', name: 'English (UK)' },
  ];

  static styles = css`
    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: white;
      font-family: sans-serif;
    }

    #qdrant-status {
      position: absolute;
      top: 20px;
      left: 20px;
      z-index: 10;
      background: rgba(0, 0, 0, 0.6);
      color: white;
      font-family: sans-serif;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 12px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    #qdrant-status.connected {
      border-color: rgba(76, 175, 80, 0.6);
      background: rgba(76, 175, 80, 0.2);
    }

    #qdrant-status.error {
      border-color: rgba(244, 67, 54, 0.6);
      background: rgba(244, 67, 54, 0.2);
    }

    #captions {
      position: absolute;
      bottom: 25vh;
      left: 50%;
      transform: translateX(-50%);
      width: 80%;
      max-width: 800px;
      max-height: 20vh;
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.4);
      color: white;
      font-family: sans-serif;
      padding: 1rem;
      border-radius: 12px;
      z-index: 10;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.3) transparent;
      box-sizing: border-box;
    }

    #captions p {
      margin: 0;
      padding: 0;
      text-align: left;
      line-height: 1.4;
    }

    #captions p b {
      font-weight: bold;
    }

    #captions .user b {
      color: #a7c7e7; /* Light blue */
    }

    #captions .model b {
      color: #b2f2bb; /* Light green */
    }

    #captions .current {
      opacity: 0.7;
    }

    .source-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 4px;
      padding-left: 10px;
    }

    .source-chip {
      background: rgba(66, 133, 244, 0.3);
      border: 1px solid rgba(66, 133, 244, 0.6);
      color: #e8f0fe;
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: 12px;
      text-decoration: none;
      transition: background 0.2s;
    }

    .source-chip:hover {
      background: rgba(66, 133, 244, 0.5);
    }

    #captions::-webkit-scrollbar {
      width: 8px;
    }

    #captions::-webkit-scrollbar-track {
      background: transparent;
    }

    #captions::-webkit-scrollbar-thumb {
      background-color: rgba(255, 255, 255, 0.3);
      border-radius: 4px;
    }

    #webcam {
      position: absolute;
      top: 20px;
      right: 20px;
      width: 240px;
      height: 180px;
      border-radius: 12px;
      object-fit: cover;
      border: 2px solid rgba(255, 255, 255, 0.2);
      transform: scaleX(-1); /* Mirror view for user */
      background: #000;
      z-index: 10;
    }

    #webcam.screenshare {
      transform: scaleX(1);
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 20px;

      label {
        color: white;
        margin-right: 10px;
        font-family: sans-serif;
      }

      select {
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        padding: 8px 12px;
        font-size: 16px;
        cursor: pointer;

        &:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        &:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }
      }

      .settings {
        display: flex;
        gap: 15px;
        align-items: center;
        background: rgba(0, 0, 0, 0.2);
        padding: 8px 15px;
        border-radius: 16px;
        flex-wrap: wrap;
        justify-content: center;
      }

      /* Toggle Switch Styles */
      .toggle-container {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .switch {
        position: relative;
        display: inline-block;
        width: 40px;
        height: 24px;
      }

      .switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        transition: 0.4s;
        border-radius: 34px;
      }

      .slider:before {
        position: absolute;
        content: "";
        height: 16px;
        width: 16px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: 0.4s;
        border-radius: 50%;
      }

      input:checked + .slider {
        background-color: #4285f4;
        border-color: #4285f4;
      }

      input:checked + .slider:before {
        transform: translateX(16px);
      }
      
      input:disabled + .slider {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .buttons {
        display: flex;
        gap: 10px;
      }

      button {
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        width: 64px;
        height: 64px;
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;

        &:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      }

      button[disabled] {
        opacity: 0.5;
        cursor: not-allowed;
      }

      #startButton[disabled],
      #stopButton[disabled],
      #resetButton[disabled] {
        display: none;
      }

      .pdf-upload-label {
        display: flex;
        align-items: center;
        gap: 8px;
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        padding: 8px 12px;
        font-size: 16px;
        font-family: sans-serif;
        cursor: pointer;
        height: fit-content;
      }
      .pdf-upload-label:hover {
        background: rgba(255, 255, 255, 0.2);
      }
      .pdf-upload-label[disabled] {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .pdf-file-list {
        display: flex;
        flex-direction: column;
        gap: 5px;
        max-height: 100px;
        overflow-y: auto;
        background: rgba(0, 0, 0, 0.2);
        padding: 8px;
        border-radius: 8px;
        min-width: 250px;
      }

      .pdf-file-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 5px;
      }

      .pdf-file-name {
        color: #ccc;
        font-family: sans-serif;
        font-size: 14px;
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex-grow: 1;
      }

      .clear-pdf-button {
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        padding: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        min-width: 24px;
        border-radius: 50%;
      }
      .clear-pdf-button:hover {
        background: rgba(255, 255, 255, 0.1);
      }
      .clear-all-pdfs-button {
        background: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        cursor: pointer;
        padding: 4px 8px;
        margin-top: 5px;
        border-radius: 8px;
        font-size: 12px;
        align-self: flex-start;
        width: auto;
        height: auto;
      }
      .clear-all-pdfs-button:hover {
        background: rgba(255, 255, 255, 0.1);
      }
    }
  `;

  constructor() {
    super();
    // Pin the PDF.js worker to the same version as the library to prevent mismatches.
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.mjs`;
    this.initClient();
    this.videoCanvas = document.createElement('canvas');
    this.initQdrant();
  }

  private async initQdrant() {
    const qdrantUrl = process.env.QDRANT_URL;
    const qdrantApiKey = process.env.QDRANT_API_KEY;
    const apiKey = process.env.API_KEY;

    if (qdrantUrl && qdrantApiKey && apiKey) {
      try {
        console.log('Raw Qdrant URL:', qdrantUrl);
        // If using proxy (relative path), prepend origin to make it a valid URL for QdrantClient
        // IMPORTANT: Must end with / so that QdrantClient appends paths correctly (e.g. /collections)
        // otherwise http://host/api/qdrant + collections -> http://host/collections
        let finalQdrantUrl = qdrantUrl.startsWith('/')
          ? `${window.location.origin}${qdrantUrl}`
          : qdrantUrl;

        if (!finalQdrantUrl.endsWith('/')) {
          finalQdrantUrl += '/';
        }

        console.log('Final Qdrant URL:', finalQdrantUrl);
        console.log('Qdrant API Key present:', !!qdrantApiKey, qdrantApiKey ? `(Length: ${qdrantApiKey.length})` : '');

        this.qdrantService = new QdrantService(finalQdrantUrl, qdrantApiKey, apiKey);
        await this.qdrantService.initializeCollection();
        this.useQdrant = true;
        this.qdrantStatus = '✅ Qdrant connected';
        console.log('Qdrant service initialized successfully');
      } catch (error) {
        console.error('Failed to initialize Qdrant:', error);
        this.qdrantStatus = '❌ Qdrant connection failed';
        this.useQdrant = false;
      }
    } else {
      console.log('Qdrant credentials not found, using in-memory chunks');
      this.qdrantStatus = 'Using in-memory storage';
    }
  }

  /**
   * Determine if the user query is asking about documents
   * Returns true if the query appears to be document-related
   */
  private shouldSearchDocuments(query: string): boolean {
    const lowerQuery = query.toLowerCase().trim();

    // If query is too short (e.g. "ok", "si", "no"), don't search
    if (lowerQuery.length < 4) {
      return false;
    }

    // Exclude common greetings and small talk
    const greetingPatterns = [
      /^hola/i, /^buenos días/i, /^buenas tardes/i, /^buenas noches/i,
      /^hello/i, /^hi\b/i, /^hey/i, /^good morning/i, /^good afternoon/i,
      /^cómo estás/i, /^cómo está/i, /^how are you/i,
      /^gracias/i, /^thank you/i, /^thanks/i,
      /^adiós/i, /^chau/i, /^bye/i, /^goodbye/i,
      /^ok/i, /^listo/i, /^entendido/i, /^vale/i
    ];

    const isGreeting = greetingPatterns.some(pattern => pattern.test(lowerQuery));

    if (isGreeting) {
      return false;
    }

    // If it's not a greeting and has enough length, assume it might be a question about content
    // This is much more flexible than looking for specific "document" keywords
    return true;
  }

  protected firstUpdated(): void {
    // FIX: Cast this to any to access renderRoot to avoid TS errors regarding missing properties on LitElement.
    this.videoElement = (this as any).renderRoot.querySelector(
      '#webcam',
    ) as HTMLVideoElement;
  }

  updated() {
    if (this.captionsContainer) {
      this.captionsContainer.scrollTop = this.captionsContainer.scrollHeight;
    }
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    this.client = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-native-audio-preview-09-2025';

    let combinedPdfText = '';
    let systemInstructionText = '';

    if (this.useQdrant && this.qdrantService && this.pdfChunks.size > 0) {
      // When using Qdrant, we'll do semantic search on user queries
      const totalChunks = Array.from(this.pdfChunks.values()).reduce((sum, chunks) => sum + chunks.length, 0);
      const fileNames = Array.from(this.pdfChunks.keys()).join(', ');

      systemInstructionText = `You are a helpful assistant with access to a vector database containing ${totalChunks} chunks from ${this.pdfChunks.size} PDF document(s): ${fileNames}.

You can engage in general conversation. When users ask questions that might be related to the documents, you will receive relevant excerpts through semantic search in this format:

--- RELEVANT DOCUMENT EXCERPTS ---
[Excerpt N from "filename" (relevance: X%)]
<text content>
--- END OF EXCERPTS ---

When excerpts are provided: Use them to answer the user's question accurately. Always cite which document you're using.
When no excerpts are provided: Respond naturally based on your general knowledge, but mention that you didn't find specific information in the documents if the question seemed to be about them.`;

      this.updateStatus(`🔍 Qdrant RAG mode: ${totalChunks} chunks indexed`);
    } else if (this.pdfChunks.size > 0) {
      // Fallback to in-memory chunks
      let totalChunksIncluded = 0;
      let docIndex = 1;

      for (const [fileName, chunks] of this.pdfChunks.entries()) {
        combinedPdfText += `--- START OF DOCUMENT ${docIndex}: ${fileName} (${chunks.length} chunks) ---\n\n`;

        // Include chunks up to the limit
        for (const chunk of chunks) {
          if (totalChunksIncluded >= this.MAX_CHUNKS_IN_CONTEXT) {
            combinedPdfText += `\n[... Additional chunks omitted due to context size limits ...]\n`;
            break;
          }

          combinedPdfText += `[Chunk ${chunk.index + 1}]\n${chunk.text}\n\n`;
          totalChunksIncluded++;
        }

        combinedPdfText += `--- END OF DOCUMENT ${docIndex} ---\n\n`;
        docIndex++;

        if (totalChunksIncluded >= this.MAX_CHUNKS_IN_CONTEXT) {
          break;
        }
      }

      // Inform user about chunk usage
      const totalChunks = Array.from(this.pdfChunks.values()).reduce((sum, chunks) => sum + chunks.length, 0);
      if (totalChunksIncluded < totalChunks) {
        console.warn(`Using ${totalChunksIncluded} of ${totalChunks} total chunks due to context limits`);
        this.updateStatus(`📄 Using ${totalChunksIncluded} of ${totalChunks} chunks from PDFs`);
      } else {
        this.updateStatus(`📄 Loaded ${totalChunks} chunks from ${this.pdfChunks.size} PDF(s)`);
      }

      systemInstructionText = `You are a helpful assistant. Please answer the user's questions based exclusively on the content of the following documents. The documents have been split into chunks for processing. If the answer is not in the provided chunks, say that you cannot find the information in the provided text.\n\nDOCUMENT CONTENT:\n${combinedPdfText}`;
    }

    const systemInstruction = systemInstructionText || undefined;

    // Prepare tools configuration
    const tools: Tool[] = [];
    if (this.isGoogleSearchEnabled) {
      tools.push({ googleSearch: {} });
    }

    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Opened');
          },
          onmessage: async (message: LiveServerMessage) => {
            const serverContent = message.serverContent;
            if (serverContent) {
              if (serverContent.inputTranscription) {
                this.currentInputTranscription +=
                  serverContent.inputTranscription.text;
              } else if (serverContent.outputTranscription) {
                this.currentOutputTranscription +=
                  serverContent.outputTranscription.text;
              }

              // Check for Grounding Metadata (Search results)
              // Cast to any to access metadata that might be attached to the modelTurn
              const modelTurn = serverContent.modelTurn as any;
              let currentSources: Array<{ uri: string; title: string }> = [];

              if (modelTurn?.groundingMetadata?.groundingChunks) {
                const chunks = modelTurn.groundingMetadata.groundingChunks;
                chunks.forEach((chunk: any) => {
                  if (chunk.web) {
                    currentSources.push({
                      uri: chunk.web.uri,
                      title: chunk.web.title,
                    });
                  }
                });
              }

              if (serverContent.turnComplete) {
                if (this.currentInputTranscription.trim()) {
                  // Check if user intent suggests they want document information
                  const query = this.currentInputTranscription.trim();
                  const shouldSearch = this.shouldSearchDocuments(query);

                  // Perform semantic search in Qdrant only if user is asking about documents
                  if (this.useQdrant && this.qdrantService && this.pdfChunks.size > 0 && shouldSearch) {
                    try {
                      console.log(`[Intent Detected] Searching Qdrant for: "${query}"`);

                      const relevantChunks = await this.qdrantService.searchRelevantChunks(query, 5);

                      if (relevantChunks.length > 0) {
                        console.log(`Found ${relevantChunks.length} relevant chunks`);

                        // Build context from relevant chunks
                        let contextText = '\n\n--- RELEVANT DOCUMENT EXCERPTS ---\n\n';
                        relevantChunks.forEach((chunk, idx) => {
                          contextText += `[Excerpt ${idx + 1} from "${chunk.fileName}" (relevance: ${(chunk.score * 100).toFixed(1)}%)]\n${chunk.text}\n\n`;
                        });
                        contextText += '--- END OF EXCERPTS ---\n\n';

                        // Send the context to the model as a text message
                        if (this.session) {
                          this.session.sendRealtimeInput({
                            text: contextText,
                          });
                          console.log('Sent relevant context to model');
                        }
                      } else {
                        console.log('No relevant chunks found for document query');
                      }
                    } catch (error) {
                      console.error('Error performing semantic search:', error);
                    }
                  } else if (this.pdfChunks.size > 0 && !shouldSearch) {
                    console.log(`[General Conversation] Skipping Qdrant search for: "${query}"`);
                  }

                  this.transcriptionHistory = [
                    ...this.transcriptionHistory,
                    {
                      speaker: 'user',
                      text: this.currentInputTranscription.trim(),
                    },
                  ];
                }
                if (this.currentOutputTranscription.trim()) {
                  this.transcriptionHistory = [
                    ...this.transcriptionHistory,
                    {
                      speaker: 'model',
                      text: this.currentOutputTranscription.trim(),
                      sources: currentSources.length > 0 ? currentSources : undefined
                    },
                  ];
                }
                this.currentInputTranscription = '';
                this.currentOutputTranscription = '';
              }

              const audio = serverContent.modelTurn?.parts[0]?.inlineData;

              if (audio) {
                this.nextStartTime = Math.max(
                  this.nextStartTime,
                  this.outputAudioContext.currentTime,
                );

                const audioBuffer = await decodeAudioData(
                  decode(audio.data),
                  this.outputAudioContext,
                  24000,
                  1,
                );
                const source = this.outputAudioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(this.outputNode);
                source.addEventListener('ended', () => {
                  this.sources.delete(source);
                });

                source.start(this.nextStartTime);
                this.nextStartTime = this.nextStartTime + audioBuffer.duration;
                this.sources.add(source);
              }

              const interrupted = serverContent.interrupted;
              if (interrupted) {
                for (const source of this.sources.values()) {
                  source.stop();
                  this.sources.delete(source);
                }
                this.nextStartTime = 0;
              }
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.session = null;
            this.updateStatus('Close:' + e.reason);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            languageCode: this.selectedLanguage,
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction,
          tools: tools.length > 0 ? tools : undefined,
        },
      });
    } catch (e) {
      console.error(e);
      this.updateError(e.message);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();

    this.updateStatus('Requesting microphone and camera access...');

    try {
      // Check if navigator.mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Media Devices API is not supported in this browser or context. Please ensure you are using HTTPS or localhost.');
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      });

      this.videoElement.srcObject = this.mediaStream;
      this.videoElement.play();

      this.updateStatus(
        'Microphone and camera access granted. Starting capture...',
      );

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording || !this.session) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        this.session.sendRealtimeInput({ media: createBlob(pcmData) });
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.videoFrameInterval = window.setInterval(() => {
        this.sendVideoFrame();
      }, 1000);

      this.isRecording = true;
      this.updateStatus('🔴 Recording... Capturing audio and video.');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private sendVideoFrame() {
    if (
      !this.isRecording ||
      !this.videoElement ||
      !this.session ||
      this.videoElement.readyState < this.videoElement.HAVE_CURRENT_DATA
    ) {
      return;
    }

    const context = this.videoCanvas.getContext('2d');
    const width = this.videoElement.videoWidth;
    const height = this.videoElement.videoHeight;

    if (width === 0 || height === 0) return;

    this.videoCanvas.width = width;
    this.videoCanvas.height = height;
    context.drawImage(this.videoElement, 0, 0, width, height);

    const dataUrl = this.videoCanvas.toDataURL('image/jpeg', 0.8);
    const base64Data = dataUrl.split(',')[1];

    if (base64Data) {
      this.session.sendRealtimeInput({
        media: {
          data: base64Data,
          mimeType: 'image/jpeg',
        },
      });
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus('Stopping recording...');

    if (this.isSharingScreen) {
      this.stopScreenShare();
    }

    this.isRecording = false;

    if (this.videoFrameInterval) {
      clearInterval(this.videoFrameInterval);
      this.videoFrameInterval = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Recording stopped. Click Start to begin again.');
  }

  private async toggleScreenShare() {
    if (this.isSharingScreen) {
      this.stopScreenShare();
    } else {
      await this.startScreenShare();
    }
  }

  private async startScreenShare() {
    this.updateStatus('Requesting screen sharing access...');
    try {
      // Check if navigator.mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error('Screen Capture API is not supported in this browser or context. Please ensure you are using HTTPS or localhost.');
      }

      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      // Listen for when the user stops sharing via the browser UI
      this.screenStream.getVideoTracks()[0].onended = () => {
        this.stopScreenShare();
      };

      this.videoElement.srcObject = this.screenStream;
      this.videoElement.play();
      this.isSharingScreen = true;
      this.updateStatus('Screen sharing active.');
    } catch (err) {
      console.error('Error starting screen share:', err);
      this.updateStatus(`Error starting screen share: ${err.message}`);
      this.isSharingScreen = false; // ensure state is correct on failure
    }
  }

  private stopScreenShare() {
    if (!this.screenStream) return;

    this.screenStream.getTracks().forEach((track) => track.stop());
    this.screenStream = null;
    this.isSharingScreen = false;

    // Restore webcam stream if it exists
    if (this.mediaStream) {
      this.videoElement.srcObject = this.mediaStream;
      this.videoElement.play();
    } else {
      this.videoElement.srcObject = null;
    }
    this.updateStatus('Screen sharing stopped.');
  }

  private async reset() {
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    await this.initSession();
    this.updateStatus(
      this.pdfChunks.size > 0
        ? 'PDF context applied. Session reset.'
        : 'Session settings updated.',
    );
  }

  private handleLanguageChange(e: Event) {
    this.selectedLanguage = (e.target as HTMLSelectElement).value;
    this.reset();
  }

  private handleGoogleSearchToggle(e: Event) {
    this.isGoogleSearchEnabled = (e.target as HTMLInputElement).checked;
    this.reset();
  }

  private splitTextIntoChunks(text: string): Array<{ text: string; index: number }> {
    const chunks: Array<{ text: string; index: number }> = [];
    let startIndex = 0;
    let chunkIndex = 0;

    while (startIndex < text.length) {
      const endIndex = Math.min(startIndex + this.CHUNK_SIZE, text.length);
      const chunkText = text.substring(startIndex, endIndex);

      chunks.push({
        text: chunkText,
        index: chunkIndex
      });

      chunkIndex++;
      startIndex += this.CHUNK_SIZE - this.CHUNK_OVERLAP;
    }

    return chunks;
  }


  private processSinglePdf(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader();
      fileReader.onload = async (event) => {
        try {
          const typedArray =
            new Uint8Array(event.target!.result as ArrayBuffer);
          const pdf = await pdfjsLib.getDocument(typedArray).promise;
          let fullText = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const text = textContent.items.map((s: any) => s.str).join(' ');
            fullText += text + '\n';
          }
          resolve(fullText);
        } catch (err) {
          reject(err);
        }
      };
      fileReader.onerror = () => {
        reject(new Error('Failed to read the PDF file.'));
      };
      fileReader.readAsArrayBuffer(file);
    });
  }

  private async handlePdfUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    this.isProcessingPdf = true;
    const newContents = new Map<string, string>();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
      this.updateStatus(`Processing PDF ${i + 1}/${files.length}: ${file.name} (${fileSizeMB} MB)`);

      try {
        const text = await this.processSinglePdf(file);
        newContents.set(file.name, text);
      } catch (err) {
        console.error(`Error processing ${file.name}:`, err);
        this.updateError(`Failed to process ${file.name}: ${err.message}`);
      }
    }

    // Convert text to chunks and store
    for (const [name, text] of newContents.entries()) {
      if (!this.pdfChunks.has(name)) {
        this.pdfFileNames = [...this.pdfFileNames, name];
      }
      const chunks = this.splitTextIntoChunks(text);
      this.pdfChunks.set(name, chunks);
      console.log(`PDF "${name}" split into ${chunks.length} chunks`);
    }

    // If using Qdrant, clear the collection and re-upload ALL PDFs
    if (this.useQdrant && this.qdrantService && this.pdfChunks.size > 0) {
      try {
        console.log('Starting Qdrant update process...');
        this.updateStatus('🔄 Clearing Qdrant collection...');
        await this.qdrantService.clearCollection();
        console.log('Qdrant collection cleared');

        // Re-upload all PDFs (existing + new)
        let totalChunksStored = 0;
        for (const [name, chunks] of this.pdfChunks.entries()) {
          console.log(`Preparing to store "${name}" with ${chunks.length} chunks`);
          this.updateStatus(`Storing "${name}" in Qdrant (${totalChunksStored} chunks stored)...`);
          const chunksWithMetadata: ChunkWithMetadata[] = chunks.map(chunk => ({
            ...chunk,
            fileName: name,
            totalChunks: chunks.length,
          }));

          console.log(`Calling storeChunks for "${name}"...`);
          await this.qdrantService.storeChunks(chunksWithMetadata);
          totalChunksStored += chunks.length;
          console.log(`Stored "${name}" (${chunks.length} chunks) in Qdrant`);
        }

        this.updateStatus(`✅ All PDFs stored in Qdrant (${totalChunksStored} total chunks)`);
      } catch (error) {
        console.error('Failed to update Qdrant collection:', error);
        this.updateError(`Failed to update Qdrant collection: ${error.message}`);
      }
    } else {
      console.log('Skipping Qdrant update:', {
        useQdrant: this.useQdrant,
        hasService: !!this.qdrantService,
        chunksSize: this.pdfChunks.size
      });
    }

    // FIX: Cast this to any to call requestUpdate as TS is failing to see it on LitElement.
    (this as any).requestUpdate();

    this.isProcessingPdf = false;
    this.updateStatus('PDFs processed successfully.');
    this.reset();

    input.value = '';
  }

  private async removePdf(fileNameToRemove: string) {
    this.pdfFileNames = this.pdfFileNames.filter(
      (name) => name !== fileNameToRemove,
    );
    this.pdfChunks.delete(fileNameToRemove);

    // Remove from Qdrant if available
    if (this.useQdrant && this.qdrantService) {
      try {
        await this.qdrantService.deleteFileChunks(fileNameToRemove);
        console.log(`Removed "${fileNameToRemove}" from Qdrant`);
      } catch (error) {
        console.error(`Failed to remove "${fileNameToRemove}" from Qdrant:`, error);
      }
    }

    this.reset();
  }

  private async clearAllPdfs() {
    this.pdfFileNames = [];
    this.pdfChunks.clear();

    // Clear Qdrant collection if available
    if (this.useQdrant && this.qdrantService) {
      try {
        await this.qdrantService.clearCollection();
        console.log('Cleared all PDFs from Qdrant');
      } catch (error) {
        console.error('Failed to clear Qdrant collection:', error);
      }
    }

    this.reset();
  }

  render() {
    return html`
      <div>
        ${this.qdrantStatus
        ? html`<div
              id="qdrant-status"
              class="${this.useQdrant ? 'connected' : this.qdrantStatus.includes('failed') ? 'error' : ''}">
              ${this.qdrantStatus}
            </div>`
        : ''}
        <video
          id="webcam"
          class=${this.isSharingScreen ? 'screenshare' : ''}
          autoplay
          muted
          playsinline></video>
        <div id="captions">
          ${this.transcriptionHistory.map(
          (item) =>
            html`
                <div class="caption-item">
                  <p class="${item.speaker}">
                    <b>${item.speaker === 'user' ? 'You' : 'AI'}:</b> ${item.text}
                  </p>
                  ${item.sources && item.sources.length > 0
                ? html`
                        <div class="source-chips">
                          ${item.sources.map(
                  (source) =>
                    html`<a
                                class="source-chip"
                                href="${source.uri}"
                                target="_blank"
                                >${source.title || 'Source'}</a
                              >`,
                )}
                        </div>
                      `
                : ''}
                </div>
              `,
        )}
          ${this.currentInputTranscription
        ? html`<p class="user current">
                <b>You:</b> ${this.currentInputTranscription}
              </p>`
        : ''}
          ${this.currentOutputTranscription
        ? html`<p class="model current">
                <b>AI:</b> ${this.currentOutputTranscription}
              </p>`
        : ''}
        </div>
        <div class="controls">
          <div class="settings">
            <label for="language-select">Language</label>
            <select
              id="language-select"
              @change=${this.handleLanguageChange}
              .value=${this.selectedLanguage}
              ?disabled=${this.isRecording || this.isProcessingPdf}>
              ${this.languages.map(
          (lang) =>
            html`<option .value=${lang.code}>${lang.name}</option>`,
        )}
            </select>

            <div class="toggle-container">
              <label for="google-search-toggle">Google Search</label>
              <label class="switch">
                <input
                  id="google-search-toggle"
                  type="checkbox"
                  .checked=${this.isGoogleSearchEnabled}
                  @change=${this.handleGoogleSearchToggle}
                  ?disabled=${this.isRecording || this.isProcessingPdf} />
                <span class="slider"></span>
              </label>
            </div>

            <label
              for="pdf-upload"
              class="pdf-upload-label"
              ?disabled=${this.isRecording || this.isProcessingPdf}
              title="Upload PDFs to provide context for the conversation">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#ffffff">
                <path
                  d="M440-200h80v-167l64 64 56-57-160-160-160 160 57 57 63-64v167ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520Z" />
              </svg>
              <span>Upload PDF(s)</span>
            </label>
            <input
              id="pdf-upload"
              type="file"
              accept=".pdf"
              multiple
              @change=${this.handlePdfUpload}
              style="display:none"
              ?disabled=${this.isRecording || this.isProcessingPdf} />
            ${this.pdfFileNames.length > 0
        ? html`
                  <div class="pdf-file-list">
                    ${this.pdfFileNames.map(
          (name) => html`
                        <div class="pdf-file-item">
                          <span class="pdf-file-name" title=${name}
                            >${name}</span
                          >
                          <button
                            class="clear-pdf-button"
                            @click=${() => this.removePdf(name)}
                            ?disabled=${this.isRecording || this.isProcessingPdf}
                            title="Remove ${name}">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              height="20px"
                              viewBox="0 -960 960 960"
                              width="20px"
                              fill="#ffffff">
                              <path
                                d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
                            </svg>
                          </button>
                        </div>
                      `,
        )}
                    <button
                      class="clear-all-pdfs-button"
                      @click=${this.clearAllPdfs}
                      ?disabled=${this.isRecording || this.isProcessingPdf}
                      title="Clear all PDF contexts">
                      Clear All
                    </button>
                  </div>
                `
        : ''}
          </div>
          <div class="buttons">
            <button
              id="resetButton"
              @click=${this.reset}
              ?disabled=${this.isRecording}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="40px"
                viewBox="0 -960 960 960"
                width="40px"
                fill="#ffffff">
                <path
                  d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
              </svg>
            </button>
            <button
              id="startButton"
              @click=${this.startRecording}
              ?disabled=${this.isRecording || this.isProcessingPdf}>
              <svg
                viewBox="0 0 100 100"
                width="32px"
                height="32px"
                fill="#c80000"
                xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="50" r="50" />
              </svg>
            </button>
            <button
              id="screenShareButton"
              @click=${this.toggleScreenShare}
              ?disabled=${!this.isRecording}
              title=${this.isSharingScreen ? 'Stop screen sharing' : 'Share screen'
      }>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="40px"
                viewBox="0 -960 960 960"
                width="40px"
                fill=${this.isSharingScreen ? '#a7c7e7' : '#ffffff'}>
                <path
                  d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v280h-80v-280H200v560h280v80H200Zm400 0v-160l-40 40-56-56 160-160 160 160-56 56 40 40v160H600Z" />
              </svg>
            </button>
            <button
              id="stopButton"
              @click=${this.stopRecording}
              ?disabled=${!this.isRecording}>
              <svg
                viewBox="0 0 100 100"
                width="32px"
                height="32px"
                fill="#000000"
                xmlns="http://www.w3.org/2000/svg">
                <rect x="0" y="0" width="100" height="100" rx="15" />
              </svg>
            </button>
          </div>
        </div>

        <div id="status"> ${this.error || this.status} </div>
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}

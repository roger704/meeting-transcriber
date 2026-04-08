// Web Worker for local Whisper transcription using Transformers.js
// Loads the library dynamically for Chrome extension compatibility

let pipeline = null;
let transcriber = null;
let isLoading = false;

// Dynamic import of Transformers.js
async function loadTransformers() {
  if (pipeline) return;

  try {
    // Import from CDN - works in modern browsers
    const module = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1/dist/transformers.min.js');
    pipeline = module.pipeline;
  } catch (e) {
    // Fallback: try to load from local if bundled
    try {
      const module = await import('./lib/transformers.min.js');
      pipeline = module.pipeline;
    } catch (e2) {
      throw new Error('Failed to load Transformers.js library');
    }
  }
}

// Initialize the Whisper model
async function loadModel(modelSize = 'tiny') {
  if (transcriber || isLoading) return;

  isLoading = true;
  self.postMessage({ type: 'status', message: `Loading Whisper ${modelSize} model...` });

  try {
    await loadTransformers();

    // Model options: tiny, base, small (larger = more accurate but slower)
    const modelName = `Xenova/whisper-${modelSize}.en`;

    self.postMessage({ type: 'status', message: `Downloading model (this may take a minute)...` });

    transcriber = await pipeline('automatic-speech-recognition', modelName, {
      quantized: true,
      progress_callback: (progress) => {
        if (progress.status === 'downloading') {
          const pct = Math.round((progress.loaded / progress.total) * 100);
          self.postMessage({ type: 'status', message: `Downloading: ${pct}%` });
        }
      }
    });

    self.postMessage({ type: 'status', message: 'Model loaded successfully' });
    self.postMessage({ type: 'ready' });
  } catch (error) {
    self.postMessage({ type: 'error', message: `Failed to load model: ${error.message}` });
  } finally {
    isLoading = false;
  }
}

// Transcribe audio data
async function transcribe(audioData, sampleRate = 16000) {
  if (!transcriber) {
    self.postMessage({ type: 'error', message: 'Model not loaded' });
    return;
  }

  try {
    const result = await transcriber(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });

    self.postMessage({
      type: 'transcription',
      text: result.text,
      chunks: result.chunks || []
    });
  } catch (error) {
    self.postMessage({ type: 'error', message: `Transcription failed: ${error.message}` });
  }
}

// Handle messages from main thread
self.onmessage = async (event) => {
  const { type, data } = event.data;

  switch (type) {
    case 'load':
      await loadModel(data?.modelSize || 'tiny');
      break;
    case 'transcribe':
      await transcribe(data.audio, data.sampleRate);
      break;
    case 'unload':
      transcriber = null;
      break;
  }
};

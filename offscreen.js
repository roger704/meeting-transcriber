// Offscreen document for audio processing, transcription, and speaker diarization

let mediaStream = null;
let mediaRecorder = null;
let audioContext = null;
let analyser = null;
let audioChunks = [];
let isProcessing = false;
let transcriptionInterval = null;
let fullTranscript = [];
let settings = {
  whisperApiKey: null,
  transcriptionMode: 'local', // 'local', 'openai', 'assemblyai'
  assemblyaiKey: null,
  modelSize: 'tiny',
  enableDiarization: true
};

// Speaker diarization state
let currentSpeaker = 1;
let currentSpeakerName = null; // Actual name from meeting UI
let lastSpeakerChangeTime = 0;
let lastAudioLevel = 0;
let silenceStart = null;
const SILENCE_THRESHOLD = 0.01;
const SPEAKER_CHANGE_SILENCE_MS = 800;
let speakerProfiles = new Map(); // Maps speaker number to voice profile
let speakerNames = new Map(); // Maps speaker number to actual name
let detectedNameQueue = []; // Queue of names detected from meeting UI
const NAME_CORRELATION_WINDOW_MS = 2000; // Time window to correlate name with audio

// Local Whisper worker
let whisperWorker = null;
let whisperReady = false;
let pendingAudioQueue = [];

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  if (message.action === 'processAudio') {
    Object.assign(settings, message.settings || {});
    startProcessing(message.streamId);
  } else if (message.action === 'stopProcessing') {
    stopProcessing();
  } else if (message.action === 'exportTranscript') {
    exportTranscript(message.format);
  } else if (message.action === 'speakerNameDetected') {
    // Name detected from meeting UI - correlate with current audio
    handleDetectedSpeakerName(message.name, message.timestamp);
  } else if (message.action === 'updateSpeakerName') {
    // Manual name assignment from popup
    speakerNames.set(message.speakerNumber, message.name);
    updateTranscriptSpeakerNames();
  }
});

function handleDetectedSpeakerName(name, timestamp) {
  // Add to queue with timestamp
  detectedNameQueue.push({ name, timestamp });

  // Clean old entries
  const now = Date.now();
  detectedNameQueue = detectedNameQueue.filter(
    entry => now - entry.timestamp < NAME_CORRELATION_WINDOW_MS * 2
  );

  // If we're currently detecting audio, associate this name with current speaker
  if (lastAudioLevel > SILENCE_THRESHOLD && currentSpeaker) {
    // Check if this is a new speaker or matches existing profile
    const existingName = speakerNames.get(currentSpeaker);
    if (!existingName) {
      // First time seeing this speaker - assign the name
      speakerNames.set(currentSpeaker, name);
      currentSpeakerName = name;
      console.log(`Associated Speaker ${currentSpeaker} with "${name}"`);
    } else if (existingName !== name) {
      // Different name detected - might be a different speaker
      // Check voice profile similarity
      const voiceProfile = speakerProfiles.get(currentSpeaker);
      if (voiceProfile) {
        // Look for existing speaker with this name
        let foundExisting = false;
        for (const [spkNum, spkName] of speakerNames) {
          if (spkName === name) {
            currentSpeaker = spkNum;
            currentSpeakerName = name;
            foundExisting = true;
            break;
          }
        }
        if (!foundExisting) {
          // New speaker
          currentSpeaker = speakerNames.size + 1;
          speakerNames.set(currentSpeaker, name);
          currentSpeakerName = name;
        }
      }
    } else {
      currentSpeakerName = name;
    }
  }
}

function updateTranscriptSpeakerNames() {
  // Update existing transcript entries with new speaker names
  fullTranscript = fullTranscript.map(entry => {
    if (entry.speakerNumber) {
      const name = speakerNames.get(entry.speakerNumber);
      if (name) {
        entry.speaker = name;
      }
    }
    return entry;
  });

  // Notify popup of updated transcript
  chrome.storage.local.set({
    transcript: fullTranscript,
    transcriptText: fullTranscript.map(e =>
      e.speaker ? `[${e.timeStr}] ${e.speaker}: ${e.text}` : `[${e.timeStr}] ${e.text}`
    ).join('\n')
  });

  chrome.runtime.sendMessage({
    action: 'transcriptUpdate',
    transcript: fullTranscript
  });
}

async function startProcessing(streamId) {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    // Set up audio analysis for speaker diarization
    setupAudioAnalysis();

    // Initialize transcription based on mode
    if (settings.transcriptionMode === 'local') {
      await initLocalWhisper();
    }

    isProcessing = true;
    startRecording();

    chrome.runtime.sendMessage({ action: 'captureStarted' });
    console.log('Audio capture started');

  } catch (error) {
    console.error('Error starting audio capture:', error);
    chrome.runtime.sendMessage({
      action: 'captureError',
      error: error.message
    });
  }
}

function setupAudioAnalysis() {
  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(mediaStream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;
  source.connect(analyser);

  // Start voice activity detection for diarization
  if (settings.enableDiarization) {
    detectVoiceActivity();
  }
}

function detectVoiceActivity() {
  if (!isProcessing || !analyser) return;

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);

  // Calculate average audio level
  const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength / 255;

  const now = Date.now();

  if (average < SILENCE_THRESHOLD) {
    // Silence detected
    if (silenceStart === null) {
      silenceStart = now;
    } else if (now - silenceStart > SPEAKER_CHANGE_SILENCE_MS) {
      // Long silence - potential speaker change
      if (now - lastSpeakerChangeTime > 2000) {
        // Avoid rapid speaker changes
        lastSpeakerChangeTime = now;
        // Don't change speaker yet - wait for next voice activity
      }
    }
  } else {
    // Voice activity detected
    if (silenceStart !== null && now - silenceStart > SPEAKER_CHANGE_SILENCE_MS) {
      // Coming out of long silence - might be new speaker
      const voiceProfile = extractVoiceFeatures(dataArray);
      const detectedSpeaker = identifySpeaker(voiceProfile);
      if (detectedSpeaker !== currentSpeaker) {
        currentSpeaker = detectedSpeaker;
        lastSpeakerChangeTime = now;
      }
    }
    silenceStart = null;
  }

  lastAudioLevel = average;

  // Continue detection
  requestAnimationFrame(detectVoiceActivity);
}

function extractVoiceFeatures(frequencyData) {
  // Simple voice feature extraction based on frequency distribution
  const lowFreq = frequencyData.slice(0, 100).reduce((a, b) => a + b, 0) / 100;
  const midFreq = frequencyData.slice(100, 400).reduce((a, b) => a + b, 0) / 300;
  const highFreq = frequencyData.slice(400, 800).reduce((a, b) => a + b, 0) / 400;

  return { lowFreq, midFreq, highFreq };
}

function identifySpeaker(profile) {
  // Simple speaker identification based on voice profile matching
  const threshold = 30;
  let bestMatch = -1;
  let bestDistance = Infinity;

  for (const [speaker, storedProfile] of speakerProfiles) {
    const distance = Math.abs(profile.lowFreq - storedProfile.lowFreq) +
                     Math.abs(profile.midFreq - storedProfile.midFreq) +
                     Math.abs(profile.highFreq - storedProfile.highFreq);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = speaker;
    }
  }

  if (bestDistance < threshold && bestMatch !== -1) {
    // Update profile with running average
    const stored = speakerProfiles.get(bestMatch);
    stored.lowFreq = (stored.lowFreq + profile.lowFreq) / 2;
    stored.midFreq = (stored.midFreq + profile.midFreq) / 2;
    stored.highFreq = (stored.highFreq + profile.highFreq) / 2;
    return bestMatch;
  }

  // New speaker detected
  const newSpeaker = speakerProfiles.size + 1;
  speakerProfiles.set(newSpeaker, profile);
  return newSpeaker;
}

async function initLocalWhisper() {
  try {
    chrome.runtime.sendMessage({
      action: 'statusUpdate',
      status: 'Initializing local transcription...'
    });

    // Try to create worker for local Whisper
    // Note: Full local Whisper requires bundled Transformers.js
    // For now, check if a local Whisper server is available
    const localServerAvailable = await checkLocalWhisperServer();

    if (localServerAvailable) {
      whisperReady = true;
      chrome.runtime.sendMessage({
        action: 'statusUpdate',
        status: 'Connected to local Whisper server'
      });
      return;
    }

    // Try to initialize in-browser Whisper
    try {
      whisperWorker = new Worker('transcription-worker.js', { type: 'module' });

      whisperWorker.onmessage = (event) => {
        const { type, text, chunks, message } = event.data;

        if (type === 'ready') {
          whisperReady = true;
          chrome.runtime.sendMessage({
            action: 'statusUpdate',
            status: 'Local Whisper ready'
          });
          processQueuedAudio();
        } else if (type === 'transcription') {
          handleTranscriptionResult(text, chunks);
        } else if (type === 'status') {
          chrome.runtime.sendMessage({
            action: 'statusUpdate',
            status: message
          });
        } else if (type === 'error') {
          console.error('Whisper worker error:', message);
          handleLocalWhisperFallback();
        }
      };

      whisperWorker.onerror = (error) => {
        console.error('Worker error:', error);
        handleLocalWhisperFallback();
      };

      whisperWorker.postMessage({
        type: 'load',
        data: { modelSize: settings.modelSize }
      });

    } catch (workerError) {
      console.error('Worker creation failed:', workerError);
      handleLocalWhisperFallback();
    }

  } catch (error) {
    console.error('Failed to init local Whisper:', error);
    handleLocalWhisperFallback();
  }
}

async function checkLocalWhisperServer() {
  try {
    const response = await fetch('http://localhost:8080/health', {
      method: 'GET',
      signal: AbortSignal.timeout(1000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

function handleLocalWhisperFallback() {
  if (settings.whisperApiKey) {
    settings.transcriptionMode = 'openai';
    chrome.runtime.sendMessage({
      action: 'statusUpdate',
      status: 'Using OpenAI Whisper API'
    });
    whisperReady = true;
  } else {
    chrome.runtime.sendMessage({
      action: 'statusUpdate',
      status: 'Local mode unavailable - add OpenAI API key in settings'
    });
  }
}

function startRecording() {
  audioChunks = [];

  mediaRecorder = new MediaRecorder(mediaStream, {
    mimeType: 'audio/webm;codecs=opus'
  });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      audioChunks.push(event.data);
    }
  };

  mediaRecorder.start(1000);

  // Transcribe based on mode and interval
  const interval = settings.transcriptionMode === 'local' ? 5000 : 10000;
  transcriptionInterval = setInterval(async () => {
    if (audioChunks.length > 0 && isProcessing) {
      await transcribeAudio();
    }
  }, interval);
}

async function transcribeAudio() {
  if (audioChunks.length === 0) return;

  const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
  audioChunks = [];

  switch (settings.transcriptionMode) {
    case 'local':
      await transcribeLocal(audioBlob);
      break;
    case 'openai':
      await transcribeWithOpenAI(audioBlob);
      break;
    case 'assemblyai':
      await transcribeWithAssemblyAI(audioBlob);
      break;
    default:
      await transcribeWithOpenAI(audioBlob);
  }
}

async function transcribeLocal(audioBlob) {
  if (!whisperReady) {
    pendingAudioQueue.push(audioBlob);
    return;
  }

  // Check if we're using local server or in-browser
  const serverAvailable = await checkLocalWhisperServer();

  if (serverAvailable) {
    await transcribeWithLocalServer(audioBlob);
    return;
  }

  // Fall back to OpenAI if configured
  if (settings.whisperApiKey) {
    await transcribeWithOpenAI(audioBlob);
    return;
  }

  try {
    // Try in-browser Whisper (if worker is available)
    if (whisperWorker) {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const audioData = resampleAudio(audioBuffer, 16000);

      whisperWorker.postMessage({
        type: 'transcribe',
        data: { audio: audioData, sampleRate: 16000 }
      });
    }
  } catch (error) {
    console.error('Local transcription error:', error);
  }
}

async function transcribeWithLocalServer(audioBlob) {
  try {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');

    const response = await fetch('http://localhost:8080/transcribe', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Local server error: ${response.status}`);
    }

    const result = await response.json();
    if (result.text && result.text.trim()) {
      handleTranscriptionResult(result.text.trim(), result.segments || []);
    }

  } catch (error) {
    console.error('Local server transcription error:', error);
    // Fall back to OpenAI if available
    if (settings.whisperApiKey) {
      await transcribeWithOpenAI(audioBlob);
    }
  }
}

function resampleAudio(audioBuffer, targetSampleRate) {
  const channels = audioBuffer.numberOfChannels;
  const sourceRate = audioBuffer.sampleRate;
  const ratio = sourceRate / targetSampleRate;
  const newLength = Math.floor(audioBuffer.length / ratio);
  const result = new Float32Array(newLength);

  // Mix down to mono and resample
  for (let i = 0; i < newLength; i++) {
    const sourceIndex = Math.floor(i * ratio);
    let sample = 0;
    for (let c = 0; c < channels; c++) {
      sample += audioBuffer.getChannelData(c)[sourceIndex];
    }
    result[i] = sample / channels;
  }

  return result;
}

function processQueuedAudio() {
  while (pendingAudioQueue.length > 0) {
    const blob = pendingAudioQueue.shift();
    transcribeLocal(blob);
  }
}

async function transcribeWithOpenAI(audioBlob) {
  if (!settings.whisperApiKey) {
    console.log('No OpenAI API key configured');
    return;
  }

  try {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    formData.append('response_format', 'verbose_json');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.whisperApiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const result = await response.json();
    if (result.text && result.text.trim()) {
      handleTranscriptionResult(result.text.trim(), result.segments || []);
    }

  } catch (error) {
    console.error('OpenAI transcription error:', error);
  }
}

async function transcribeWithAssemblyAI(audioBlob) {
  if (!settings.assemblyaiKey) {
    console.log('No AssemblyAI API key configured');
    return;
  }

  try {
    // Upload audio
    const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        'Authorization': settings.assemblyaiKey
      },
      body: audioBlob
    });

    const { upload_url } = await uploadResponse.json();

    // Request transcription with speaker diarization
    const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'Authorization': settings.assemblyaiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        audio_url: upload_url,
        speaker_labels: true
      })
    });

    const { id } = await transcriptResponse.json();

    // Poll for result
    let result;
    while (true) {
      const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
        headers: { 'Authorization': settings.assemblyaiKey }
      });
      result = await pollResponse.json();

      if (result.status === 'completed') break;
      if (result.status === 'error') throw new Error(result.error);

      await new Promise(r => setTimeout(r, 1000));
    }

    // Process utterances with speaker labels
    if (result.utterances) {
      for (const utterance of result.utterances) {
        addToTranscript(utterance.text, `Speaker ${utterance.speaker}`);
      }
    } else if (result.text) {
      handleTranscriptionResult(result.text, []);
    }

  } catch (error) {
    console.error('AssemblyAI transcription error:', error);
  }
}

function handleTranscriptionResult(text, segments) {
  if (!text || !text.trim()) return;

  // Use detected speaker from voice activity analysis
  const speaker = settings.enableDiarization ? `Speaker ${currentSpeaker}` : null;
  addToTranscript(text.trim(), speaker);
}

function addToTranscript(text, speaker) {
  const timestamp = new Date();
  const timeStr = timestamp.toLocaleTimeString();

  // Determine the actual speaker name
  let speakerName = speaker;
  let speakerNumber = null;

  if (settings.enableDiarization) {
    speakerNumber = currentSpeaker;

    // Try to get actual name from speakerNames map
    const actualName = speakerNames.get(currentSpeaker);
    if (actualName) {
      speakerName = actualName;
    } else if (currentSpeakerName) {
      speakerName = currentSpeakerName;
    } else {
      speakerName = `Speaker ${currentSpeaker}`;
    }

    // Also check recent name detections from meeting UI
    const now = Date.now();
    const recentName = detectedNameQueue.find(
      entry => now - entry.timestamp < NAME_CORRELATION_WINDOW_MS
    );
    if (recentName && !speakerNames.get(currentSpeaker)) {
      speakerName = recentName.name;
      speakerNames.set(currentSpeaker, recentName.name);
    }
  }

  const entry = {
    timestamp: timestamp.toISOString(),
    timeStr,
    speaker: speakerName,
    speakerNumber: speakerNumber,
    text
  };

  fullTranscript.push(entry);

  // Store transcript
  chrome.storage.local.set({
    transcript: fullTranscript,
    transcriptText: fullTranscript.map(e =>
      e.speaker ? `[${e.timeStr}] ${e.speaker}: ${e.text}` : `[${e.timeStr}] ${e.text}`
    ).join('\n')
  });

  // Notify popup
  chrome.runtime.sendMessage({
    action: 'transcriptUpdate',
    transcript: fullTranscript,
    latest: entry
  });
}

function exportTranscript(format) {
  let content, filename, mimeType;

  switch (format) {
    case 'srt':
      content = generateSRT();
      filename = `transcript-${Date.now()}.srt`;
      mimeType = 'text/srt';
      break;
    case 'json':
      content = JSON.stringify(fullTranscript, null, 2);
      filename = `transcript-${Date.now()}.json`;
      mimeType = 'application/json';
      break;
    case 'txt':
    default:
      content = generateTXT();
      filename = `transcript-${Date.now()}.txt`;
      mimeType = 'text/plain';
  }

  chrome.runtime.sendMessage({
    action: 'exportReady',
    content,
    filename,
    mimeType
  });
}

function generateTXT() {
  return fullTranscript.map(entry => {
    if (entry.speaker) {
      return `[${entry.timeStr}] ${entry.speaker}: ${entry.text}`;
    }
    return `[${entry.timeStr}] ${entry.text}`;
  }).join('\n\n');
}

function generateSRT() {
  return fullTranscript.map((entry, index) => {
    const startTime = new Date(entry.timestamp);
    const endTime = new Date(startTime.getTime() + 5000); // Assume 5 second duration

    const formatSRTTime = (date) => {
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      const ms = String(date.getMilliseconds()).padStart(3, '0');
      return `${hours}:${minutes}:${seconds},${ms}`;
    };

    const speakerPrefix = entry.speaker ? `<b>${entry.speaker}:</b> ` : '';

    return `${index + 1}
${formatSRTTime(startTime)} --> ${formatSRTTime(endTime)}
${speakerPrefix}${entry.text}`;
  }).join('\n\n');
}

function stopProcessing() {
  isProcessing = false;

  if (transcriptionInterval) {
    clearInterval(transcriptionInterval);
    transcriptionInterval = null;
  }

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  if (whisperWorker) {
    whisperWorker.postMessage({ type: 'unload' });
    whisperWorker.terminate();
    whisperWorker = null;
    whisperReady = false;
  }

  // Final transcription of remaining audio
  if (audioChunks.length > 0) {
    transcribeAudio();
  }

  // Reset speaker profiles for next session
  speakerProfiles.clear();
  currentSpeaker = 1;

  console.log('Audio processing stopped');
}

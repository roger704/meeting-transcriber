// Popup script for Meeting Transcriber

// DOM Elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const transcriptEl = document.getElementById('transcript');
const copyBtn = document.getElementById('copyBtn');
const errorEl = document.getElementById('error');
const settingsToggle = document.getElementById('settingsToggle');
const settingsPanel = document.getElementById('settingsPanel');
const saveSettingsBtn = document.getElementById('saveSettings');

// Export buttons
const exportTxtBtn = document.getElementById('exportTxt');
const exportSrtBtn = document.getElementById('exportSrt');
const exportJsonBtn = document.getElementById('exportJson');

// Speaker panel
const speakersPanel = document.getElementById('speakersPanel');
const speakersList = document.getElementById('speakersList');
const refreshParticipantsBtn = document.getElementById('refreshParticipants');

// Settings elements
const transcriptionModeSelect = document.getElementById('transcriptionMode');
const modelSizeSelect = document.getElementById('modelSize');
const openaiKeyInput = document.getElementById('openaiKey');
const assemblyaiKeyInput = document.getElementById('assemblyaiKey');
const enableDiarizationCheckbox = document.getElementById('enableDiarization');
const modeInfo = document.getElementById('modeInfo');
const modelSizeGroup = document.getElementById('modelSizeGroup');
const openaiKeyGroup = document.getElementById('openaiKeyGroup');
const assemblyaiKeyGroup = document.getElementById('assemblyaiKeyGroup');

let isRecording = false;
let transcript = [];
let participants = [];
let speakerMap = {};

// Speaker colors
const speakerColors = [
  '#4361ee', '#00d26a', '#f9a825', '#e91e63', '#9c27b0',
  '#00bcd4', '#ff5722', '#795548', '#607d8b', '#3f51b5'
];

// Mode info text
const modeInfoText = {
  local: 'Runs entirely on your device. First use downloads ~40MB model.',
  openai: 'Uses OpenAI Whisper API. Requires API key. ~$0.006/minute.',
  assemblyai: 'Uses AssemblyAI with advanced speaker diarization. ~$0.01/minute.'
};

// Initialize popup state
document.addEventListener('DOMContentLoaded', async () => {
  // Load existing transcript
  const response = await chrome.runtime.sendMessage({ action: 'getTranscript' });
  if (response && response.transcript) {
    transcript = response.transcript;
    updateTranscriptDisplay();
  }

  // Check recording state from storage
  const state = await chrome.storage.local.get(['isRecording']);
  if (state.isRecording) {
    setRecordingState(true);
  }

  // Load settings
  const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });
  if (settings) {
    transcriptionModeSelect.value = settings.transcriptionMode || 'local';
    modelSizeSelect.value = settings.modelSize || 'tiny';
    openaiKeyInput.value = settings.whisperApiKey || '';
    assemblyaiKeyInput.value = settings.assemblyaiKey || '';
    enableDiarizationCheckbox.checked = settings.enableDiarization !== false;
    updateModeUI();
  }
});

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'transcriptUpdate':
      transcript = message.transcript;
      updateTranscriptDisplay();
      updateSpeakersPanel();
      break;

    case 'statusUpdate':
      statusText.textContent = message.status;
      if (message.status.includes('Loading')) {
        statusDot.classList.add('loading');
        statusDot.classList.remove('active');
      }
      break;

    case 'captureStarted':
      statusDot.classList.remove('loading');
      statusDot.classList.add('active');
      statusText.textContent = 'Recording...';
      break;

    case 'captureError':
      showError(message.error);
      setRecordingState(false);
      break;

    case 'downloadFile':
      downloadFile(message.content, message.filename, message.mimeType);
      break;
  }
});

// Settings toggle
settingsToggle.addEventListener('click', () => {
  const isHidden = settingsPanel.style.display === 'none';
  settingsPanel.style.display = isHidden ? 'block' : 'none';
  settingsToggle.textContent = isHidden ? 'Hide Settings' : 'Settings';
});

// Transcription mode change
transcriptionModeSelect.addEventListener('change', updateModeUI);

function updateModeUI() {
  const mode = transcriptionModeSelect.value;
  modeInfo.textContent = modeInfoText[mode];

  modelSizeGroup.style.display = mode === 'local' ? 'block' : 'none';
  openaiKeyGroup.style.display = mode === 'openai' ? 'block' : 'none';
  assemblyaiKeyGroup.style.display = mode === 'assemblyai' ? 'block' : 'none';
}

// Save settings
saveSettingsBtn.addEventListener('click', async () => {
  const settings = {
    transcriptionMode: transcriptionModeSelect.value,
    modelSize: modelSizeSelect.value,
    whisperApiKey: openaiKeyInput.value.trim(),
    assemblyaiKey: assemblyaiKeyInput.value.trim(),
    enableDiarization: enableDiarizationCheckbox.checked
  };

  await chrome.runtime.sendMessage({ action: 'saveSettings', settings });

  saveSettingsBtn.textContent = 'Saved!';
  setTimeout(() => {
    saveSettingsBtn.textContent = 'Save Settings';
  }, 2000);
});

// Start recording
startBtn.addEventListener('click', async () => {
  try {
    hideError();

    // Get the current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      showError('No active tab found');
      return;
    }

    // Check if it's a meeting URL (relaxed check - allow any URL)
    const supportedDomains = ['meet.google.com', 'zoom.us', 'teams.microsoft.com', 'webex.com'];
    const url = new URL(tab.url);
    const isKnownMeeting = supportedDomains.some(domain => url.hostname.includes(domain));

    if (!isKnownMeeting) {
      // Allow but warn
      console.log('Not a known meeting platform, but proceeding...');
    }

    // Clear previous transcript
    transcript = [];
    await chrome.storage.local.set({ transcript: [], transcriptText: '', isRecording: true });
    updateTranscriptDisplay();

    // Send message to start capture
    chrome.runtime.sendMessage({
      action: 'startCapture',
      tabId: tab.id
    });

    setRecordingState(true);
    statusText.textContent = 'Starting...';
    statusDot.classList.add('loading');

  } catch (error) {
    showError(error.message);
  }
});

// Stop recording
stopBtn.addEventListener('click', async () => {
  chrome.runtime.sendMessage({ action: 'stopCapture' });
  await chrome.storage.local.set({ isRecording: false });
  setRecordingState(false);
});

// Copy transcript
copyBtn.addEventListener('click', async () => {
  const text = transcript.map(entry => {
    if (entry.speaker) {
      return `[${entry.timeStr}] ${entry.speaker}: ${entry.text}`;
    }
    return `[${entry.timeStr}] ${entry.text}`;
  }).join('\n');

  if (text) {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
    }, 2000);
  }
});

// Export buttons
exportTxtBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'exportTranscript', format: 'txt' });
});

exportSrtBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'exportTranscript', format: 'srt' });
});

exportJsonBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'exportTranscript', format: 'json' });
});

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

async function setRecordingState(recording) {
  isRecording = recording;
  startBtn.disabled = recording;
  stopBtn.disabled = !recording;

  // Enable/disable export buttons based on transcript content
  const hasTranscript = transcript.length > 0;
  exportTxtBtn.disabled = !hasTranscript;
  exportSrtBtn.disabled = !hasTranscript;
  exportJsonBtn.disabled = !hasTranscript;

  if (recording) {
    statusDot.classList.add('active');
    statusText.textContent = 'Recording...';

    // Load participants after a short delay (let content script initialize)
    setTimeout(async () => {
      await loadParticipants();
      updateSpeakersPanel();
    }, 2000);
  } else {
    statusDot.classList.remove('active', 'loading');
    statusText.textContent = hasTranscript ? 'Recording stopped' : 'Not recording';
  }
}

function updateTranscriptDisplay() {
  if (!transcript || transcript.length === 0) {
    transcriptEl.innerHTML = '<div class="empty-state">Listening for speech...</div>';
    return;
  }

  transcriptEl.innerHTML = transcript.map(entry => {
    const speakerClass = entry.speaker ? `speaker-${entry.speaker.replace('Speaker ', '')}` : '';
    const speakerHtml = entry.speaker
      ? `<span class="transcript-speaker ${speakerClass}">${entry.speaker}:</span> `
      : '';

    return `
      <div class="transcript-entry">
        <span class="transcript-time">${entry.timeStr}</span><br>
        ${speakerHtml}${entry.text}
      </div>
    `;
  }).join('');

  // Auto-scroll to bottom
  transcriptEl.scrollTop = transcriptEl.scrollHeight;

  // Update export button state
  const hasTranscript = transcript.length > 0;
  exportTxtBtn.disabled = !hasTranscript;
  exportSrtBtn.disabled = !hasTranscript;
  exportJsonBtn.disabled = !hasTranscript;
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

function hideError() {
  errorEl.style.display = 'none';
}

// Speaker management
async function loadParticipants() {
  const response = await chrome.runtime.sendMessage({ action: 'getParticipants' });
  if (response && response.participants) {
    participants = response.participants;
  }

  const mapResponse = await chrome.runtime.sendMessage({ action: 'getSpeakerMap' });
  if (mapResponse && mapResponse.speakerMap) {
    speakerMap = mapResponse.speakerMap;
  }
}

function updateSpeakersPanel() {
  // Get unique speakers from transcript
  const speakers = new Set();
  transcript.forEach(entry => {
    if (entry.speakerNumber) {
      speakers.add(entry.speakerNumber);
    }
  });

  if (speakers.size === 0) {
    speakersPanel.style.display = 'none';
    return;
  }

  speakersPanel.style.display = 'block';

  speakersList.innerHTML = Array.from(speakers).map(speakerNum => {
    const color = speakerColors[(speakerNum - 1) % speakerColors.length];
    const currentName = speakerMap[speakerNum] ||
                       transcript.find(t => t.speakerNumber === speakerNum)?.speaker ||
                       `Speaker ${speakerNum}`;

    // Create dropdown with participants if available
    const options = participants.length > 0
      ? participants.map(p =>
          `<option value="${p.name}" ${p.name === currentName ? 'selected' : ''}>${p.name}</option>`
        ).join('')
      : '';

    return `
      <div class="speaker-item" data-speaker="${speakerNum}">
        <div class="speaker-color" style="background: ${color}"></div>
        ${participants.length > 0 ? `
          <select class="speaker-select" data-speaker="${speakerNum}">
            <option value="">Speaker ${speakerNum}</option>
            ${options}
          </select>
        ` : `
          <input type="text" class="speaker-input" data-speaker="${speakerNum}"
                 value="${currentName}" placeholder="Enter name">
        `}
      </div>
    `;
  }).join('');

  // Add event listeners for name changes
  speakersList.querySelectorAll('.speaker-input, .speaker-select').forEach(el => {
    el.addEventListener('change', (e) => {
      const speakerNum = parseInt(e.target.dataset.speaker);
      const name = e.target.value.trim();
      if (name) {
        assignSpeakerName(speakerNum, name);
      }
    });
  });
}

async function assignSpeakerName(speakerNumber, name) {
  speakerMap[speakerNumber] = name;

  await chrome.runtime.sendMessage({
    action: 'assignSpeakerName',
    speakerNumber,
    name
  });

  // Update local transcript display
  transcript = transcript.map(entry => {
    if (entry.speakerNumber === speakerNumber) {
      entry.speaker = name;
    }
    return entry;
  });

  updateTranscriptDisplay();
}

// Refresh participants button
refreshParticipantsBtn.addEventListener('click', async () => {
  await loadParticipants();
  updateSpeakersPanel();
});

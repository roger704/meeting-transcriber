// Background service worker for Meeting Transcriber

let offscreenDocumentCreated = false;
let activeTabId = null;
let speakerMap = new Map(); // Maps speaker number to actual name
let lastDetectedSpeaker = null;
let lastSpeakerTimestamp = 0;

// Handle messages from popup, offscreen document, and content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'startCapture':
      activeTabId = message.tabId;
      startTabCapture(message.tabId);
      // Start monitoring for speaker names
      startSpeakerMonitoring(message.tabId);
      sendResponse({ status: 'started' });
      break;

    case 'stopCapture':
      stopCapture();
      stopSpeakerMonitoring();
      sendResponse({ status: 'stopped' });
      break;

    case 'getTranscript':
      getStoredTranscript().then(sendResponse);
      return true;

    case 'saveSettings':
      chrome.storage.sync.set(message.settings);
      sendResponse({ status: 'saved' });
      break;

    case 'getSettings':
      chrome.storage.sync.get([
        'whisperApiKey',
        'assemblyaiKey',
        'transcriptionMode',
        'modelSize',
        'enableDiarization',
        'voiceProfiles'
      ]).then(sendResponse);
      return true;

    case 'exportTranscript':
      chrome.runtime.sendMessage({
        action: 'exportTranscript',
        target: 'offscreen',
        format: message.format
      });
      sendResponse({ status: 'exporting' });
      break;

    case 'exportReady':
      chrome.runtime.sendMessage({
        action: 'downloadFile',
        content: message.content,
        filename: message.filename,
        mimeType: message.mimeType
      });
      break;

    // Speaker detection from content script
    case 'activeSpeakerDetected':
      handleActiveSpeaker(message.speaker, message.timestamp);
      break;

    case 'participantsUpdated':
      handleParticipantsUpdate(message.participants);
      break;

    // Speaker assignment from popup
    case 'assignSpeakerName':
      assignSpeakerName(message.speakerNumber, message.name);
      sendResponse({ status: 'assigned' });
      break;

    case 'getSpeakerMap':
      sendResponse({ speakerMap: Object.fromEntries(speakerMap) });
      break;

    case 'getParticipants':
      getParticipantsFromTab().then(sendResponse);
      return true;

    // Save voice profile
    case 'saveVoiceProfile':
      saveVoiceProfile(message.name, message.profile);
      sendResponse({ status: 'saved' });
      break;

    case 'transcriptUpdate':
    case 'statusUpdate':
    case 'captureStarted':
    case 'captureError':
      chrome.runtime.sendMessage(message);
      break;
  }
});

// Speaker correlation logic
function handleActiveSpeaker(name, timestamp) {
  if (!name) return;

  lastDetectedSpeaker = name;
  lastSpeakerTimestamp = timestamp;

  // Forward to offscreen for correlation with audio
  chrome.runtime.sendMessage({
    action: 'speakerNameDetected',
    target: 'offscreen',
    name: name,
    timestamp: timestamp
  });
}

function handleParticipantsUpdate(participants) {
  // Store participants for the naming UI
  chrome.storage.local.set({ meetingParticipants: participants });
}

function assignSpeakerName(speakerNumber, name) {
  speakerMap.set(speakerNumber, name);

  // Save to storage for persistence
  chrome.storage.local.set({
    speakerMap: Object.fromEntries(speakerMap)
  });

  // Notify offscreen to update speaker names
  chrome.runtime.sendMessage({
    action: 'updateSpeakerName',
    target: 'offscreen',
    speakerNumber: speakerNumber,
    name: name
  });
}

async function saveVoiceProfile(name, profile) {
  const { voiceProfiles = {} } = await chrome.storage.sync.get(['voiceProfiles']);
  voiceProfiles[name] = profile;
  await chrome.storage.sync.set({ voiceProfiles });
}

async function getParticipantsFromTab() {
  if (!activeTabId) return { participants: [] };

  try {
    const response = await chrome.tabs.sendMessage(activeTabId, {
      action: 'getParticipants'
    });
    return response;
  } catch (e) {
    return { participants: [] };
  }
}

function startSpeakerMonitoring(tabId) {
  chrome.tabs.sendMessage(tabId, { action: 'startMonitoring' }).catch(() => {
    // Content script may not be loaded yet
  });
}

function stopSpeakerMonitoring() {
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { action: 'stopMonitoring' }).catch(() => {});
  }
  activeTabId = null;
  speakerMap.clear();
}

async function startTabCapture(tabId) {
  // Create offscreen document for audio processing
  await setupOffscreenDocument();

  // Request tab capture
  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(id);
      }
    });
  });

  // Get all settings
  const settings = await chrome.storage.sync.get([
    'whisperApiKey',
    'assemblyaiKey',
    'transcriptionMode',
    'modelSize',
    'enableDiarization'
  ]);

  // Set defaults
  const finalSettings = {
    whisperApiKey: settings.whisperApiKey || null,
    assemblyaiKey: settings.assemblyaiKey || null,
    transcriptionMode: settings.transcriptionMode || 'local',
    modelSize: settings.modelSize || 'tiny',
    enableDiarization: settings.enableDiarization !== false
  };

  // Send stream ID to offscreen document for processing
  chrome.runtime.sendMessage({
    action: 'processAudio',
    target: 'offscreen',
    streamId: streamId,
    settings: finalSettings
  });
}

async function setupOffscreenDocument() {
  if (offscreenDocumentCreated) return;

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length > 0) {
    offscreenDocumentCreated = true;
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA', 'WORKERS'],
    justification: 'Audio transcription requires processing media streams and running ML models'
  });

  offscreenDocumentCreated = true;
}

function stopCapture() {
  chrome.runtime.sendMessage({
    action: 'stopProcessing',
    target: 'offscreen'
  });
}

async function getStoredTranscript() {
  const result = await chrome.storage.local.get(['transcript', 'transcriptText']);
  return {
    transcript: result.transcript || [],
    transcriptText: result.transcriptText || ''
  };
}

// Clear transcript on extension startup
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.remove(['transcript', 'transcriptText']);
});

// Content script to extract participant info from meeting platforms
// Detects who is currently speaking and reports their name

let platform = null;
let pollInterval = null;
let lastActiveSpeaker = null;

// Detect which meeting platform we're on
function detectPlatform() {
  const url = window.location.hostname;

  if (url.includes('meet.google.com')) {
    return 'google-meet';
  } else if (url.includes('zoom.us')) {
    return 'zoom';
  } else if (url.includes('teams.microsoft.com')) {
    return 'teams';
  } else if (url.includes('webex.com')) {
    return 'webex';
  }

  return null;
}

// Get all participants from the meeting
function getParticipants() {
  switch (platform) {
    case 'google-meet':
      return getGoogleMeetParticipants();
    case 'zoom':
      return getZoomParticipants();
    case 'teams':
      return getTeamsParticipants();
    default:
      return [];
  }
}

// Get currently active speaker
function getActiveSpeaker() {
  switch (platform) {
    case 'google-meet':
      return getGoogleMeetActiveSpeaker();
    case 'zoom':
      return getZoomActiveSpeaker();
    case 'teams':
      return getTeamsActiveSpeaker();
    default:
      return null;
  }
}

// ============ Google Meet ============

function getGoogleMeetParticipants() {
  const participants = [];

  // Method 1: From the participant panel (if open)
  const participantItems = document.querySelectorAll('[data-participant-id]');
  participantItems.forEach(item => {
    const nameEl = item.querySelector('[data-self-name]') || item.querySelector('span');
    if (nameEl) {
      participants.push({
        id: item.getAttribute('data-participant-id'),
        name: nameEl.textContent.trim()
      });
    }
  });

  // Method 2: From video tiles
  if (participants.length === 0) {
    const tiles = document.querySelectorAll('[data-requested-participant-id]');
    tiles.forEach(tile => {
      const nameEl = tile.querySelector('[data-self-name]') ||
                     tile.querySelector('.zWGUib') ||
                     tile.querySelector('[class*="name"]');
      if (nameEl) {
        participants.push({
          id: tile.getAttribute('data-requested-participant-id'),
          name: nameEl.textContent.trim()
        });
      }
    });
  }

  // Method 3: From the roster/people panel
  const rosterItems = document.querySelectorAll('[role="listitem"]');
  rosterItems.forEach(item => {
    const nameSpan = item.querySelector('span');
    if (nameSpan && nameSpan.textContent.trim()) {
      const name = nameSpan.textContent.trim();
      if (!participants.find(p => p.name === name)) {
        participants.push({ id: name, name });
      }
    }
  });

  return participants;
}

function getGoogleMeetActiveSpeaker() {
  // Look for the speaking indicator (animated border/highlight)
  // Google Meet shows a colored border around the active speaker

  // Method 1: Check for speaking animation class
  const speakingTiles = document.querySelectorAll('[data-requested-participant-id]');
  for (const tile of speakingTiles) {
    // Look for the speaking indicator (usually a colored border or animation)
    const hasSpeakingIndicator =
      tile.querySelector('[class*="speaking"]') ||
      tile.querySelector('[class*="active"]') ||
      tile.classList.contains('speaking') ||
      // Check for the blue/green border that indicates speaking
      window.getComputedStyle(tile).borderColor.includes('rgb(26, 115, 232)') ||
      window.getComputedStyle(tile).borderColor.includes('rgb(0, 200, 83)');

    if (hasSpeakingIndicator) {
      const nameEl = tile.querySelector('[data-self-name]') ||
                     tile.querySelector('.zWGUib') ||
                     tile.querySelector('[class*="name"]');
      if (nameEl) {
        return nameEl.textContent.trim();
      }
    }
  }

  // Method 2: Check the main/pinned video for speaking
  const mainVideo = document.querySelector('[data-allocation-index="0"]');
  if (mainVideo) {
    const nameEl = mainVideo.querySelector('[data-self-name]') ||
                   mainVideo.querySelector('[class*="name"]');
    if (nameEl) {
      // Check if this person is speaking (has audio activity)
      const audioIndicator = mainVideo.querySelector('[class*="audio"]');
      if (audioIndicator) {
        return nameEl.textContent.trim();
      }
    }
  }

  // Method 3: Look for "is presenting" or active speaker label
  const presenterLabel = document.querySelector('[class*="presenter"]');
  if (presenterLabel) {
    return presenterLabel.textContent.replace('is presenting', '').trim();
  }

  return null;
}

// ============ Zoom ============

function getZoomParticipants() {
  const participants = [];

  // From participant panel
  const items = document.querySelectorAll('.participants-item__display-name, [class*="participant-name"]');
  items.forEach(item => {
    const name = item.textContent.trim();
    if (name && !participants.find(p => p.name === name)) {
      participants.push({ id: name, name });
    }
  });

  // From video tiles
  const videoNames = document.querySelectorAll('.video-avatar__avatar-name, [class*="video-name"]');
  videoNames.forEach(el => {
    const name = el.textContent.trim();
    if (name && !participants.find(p => p.name === name)) {
      participants.push({ id: name, name });
    }
  });

  return participants;
}

function getZoomActiveSpeaker() {
  // Zoom shows a green border around active speaker
  const activeTile = document.querySelector('[class*="speaker-active"], [class*="active-speaker"]');
  if (activeTile) {
    const nameEl = activeTile.querySelector('[class*="name"]');
    if (nameEl) {
      return nameEl.textContent.trim();
    }
  }

  // Check for speaking indicator
  const speakingIndicators = document.querySelectorAll('[class*="speaking"]');
  for (const indicator of speakingIndicators) {
    const parent = indicator.closest('[class*="video"]');
    if (parent) {
      const nameEl = parent.querySelector('[class*="name"]');
      if (nameEl) {
        return nameEl.textContent.trim();
      }
    }
  }

  return null;
}

// ============ Microsoft Teams ============

function getTeamsParticipants() {
  const participants = [];

  // Method 1: From roster/participant panel
  const rosterItems = document.querySelectorAll(
    '[data-cid*="participant"], ' +
    '[class*="roster-participant"], ' +
    '[data-tid="roster-participant"], ' +
    '.ts-calling-participant-roster-item'
  );
  rosterItems.forEach(item => {
    const nameEl = item.querySelector(
      '[class*="participant-name"], ' +
      '[class*="display-name"], ' +
      '[data-tid="participant-name"], ' +
      'span[class*="name"]'
    );
    if (nameEl) {
      const name = nameEl.textContent.trim();
      if (name && !participants.find(p => p.name === name)) {
        participants.push({ id: name, name });
      }
    }
  });

  // Method 2: From video gallery tiles
  const videoTiles = document.querySelectorAll(
    '[data-cid*="video-tile"], ' +
    '[class*="video-tile"], ' +
    '[data-tid="video-participant"], ' +
    '.ts-video-tile, ' +
    '[class*="calling-participant-stream"]'
  );
  videoTiles.forEach(tile => {
    const nameEl = tile.querySelector(
      '[class*="display-name"], ' +
      '[class*="name-label"], ' +
      '[data-tid="display-name"], ' +
      '.ui-participant-name, ' +
      '[class*="participant-name"]'
    );
    if (nameEl) {
      const name = nameEl.textContent.trim();
      if (name && !participants.find(p => p.name === name)) {
        participants.push({ id: name, name });
      }
    }
  });

  // Method 3: From the "People" panel
  const peopleItems = document.querySelectorAll('[role="listitem"]');
  peopleItems.forEach(item => {
    const nameEl = item.querySelector('[class*="name"], span');
    if (nameEl) {
      let name = nameEl.textContent.trim();
      // Remove status indicators like "(Guest)", "(Organizer)"
      name = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (name && !participants.find(p => p.name === name)) {
        participants.push({ id: name, name });
      }
    }
  });

  return participants;
}

function getTeamsActiveSpeaker() {
  // Method 1: Check for speaking indicator (purple/blue border or animation)
  const speakingSelectors = [
    '[data-is-speaking="true"]',
    '[class*="is-speaking"]',
    '[class*="speaking-indicator"]',
    '.ts-calling-participant-speaking',
    '[data-tid="video-participant"][class*="active"]'
  ];

  for (const selector of speakingSelectors) {
    const activeTile = document.querySelector(selector);
    if (activeTile) {
      const nameEl = activeTile.querySelector(
        '[class*="display-name"], ' +
        '[class*="participant-name"], ' +
        '[data-tid="display-name"], ' +
        '.ui-participant-name'
      );
      if (nameEl) {
        return nameEl.textContent.trim();
      }
    }
  }

  // Method 2: Check video tiles for speaking animation/border
  const tiles = document.querySelectorAll('[data-tid="video-participant"], .ts-video-tile');
  for (const tile of tiles) {
    // Teams uses a colored border or glow effect for active speakers
    const computedStyle = window.getComputedStyle(tile);
    const hasActiveBorder =
      computedStyle.boxShadow.includes('rgb(98, 100, 167)') || // Teams purple
      computedStyle.boxShadow.includes('rgb(91, 95, 199)') ||
      computedStyle.borderColor.includes('rgb(98, 100, 167)');

    if (hasActiveBorder) {
      const nameEl = tile.querySelector('[class*="display-name"], [class*="name"]');
      if (nameEl) {
        return nameEl.textContent.trim();
      }
    }
  }

  // Method 3: Look for the dominant speaker indicator
  const dominantSpeaker = document.querySelector('[data-tid="dominant-speaker"], [class*="dominant-speaker"]');
  if (dominantSpeaker) {
    const nameEl = dominantSpeaker.querySelector('[class*="name"]');
    if (nameEl) {
      return nameEl.textContent.trim();
    }
  }

  // Method 4: Check for audio level indicators
  const audioIndicators = document.querySelectorAll('[class*="audio-indicator"], [class*="volume-indicator"]');
  for (const indicator of audioIndicators) {
    // Check if this indicator shows activity (not muted/silent)
    if (!indicator.classList.contains('muted') && !indicator.classList.contains('silent')) {
      const tile = indicator.closest('[data-tid="video-participant"], .ts-video-tile, [class*="video-tile"]');
      if (tile) {
        const nameEl = tile.querySelector('[class*="display-name"], [class*="name"]');
        if (nameEl) {
          return nameEl.textContent.trim();
        }
      }
    }
  }

  return null;
}

// ============ Main Logic ============

function startPolling() {
  if (pollInterval) return;

  platform = detectPlatform();
  if (!platform) {
    console.log('Meeting Transcriber: Unknown platform');
    return;
  }

  console.log(`Meeting Transcriber: Detected ${platform}`);

  // Poll for active speaker every 500ms
  pollInterval = setInterval(() => {
    const activeSpeaker = getActiveSpeaker();

    if (activeSpeaker && activeSpeaker !== lastActiveSpeaker) {
      lastActiveSpeaker = activeSpeaker;

      // Send to background script
      chrome.runtime.sendMessage({
        action: 'activeSpeakerDetected',
        speaker: activeSpeaker,
        platform: platform,
        timestamp: Date.now()
      });
    }
  }, 500);

  // Also send initial participant list
  setTimeout(() => {
    const participants = getParticipants();
    if (participants.length > 0) {
      chrome.runtime.sendMessage({
        action: 'participantsUpdated',
        participants: participants,
        platform: platform
      });
    }
  }, 2000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startMonitoring') {
    startPolling();
    sendResponse({ status: 'started', platform });
  } else if (message.action === 'stopMonitoring') {
    stopPolling();
    sendResponse({ status: 'stopped' });
  } else if (message.action === 'getParticipants') {
    const participants = getParticipants();
    sendResponse({ participants, platform });
  } else if (message.action === 'getActiveSpeaker') {
    const speaker = getActiveSpeaker();
    sendResponse({ speaker, platform });
  }
});

// Auto-start when page loads
if (document.readyState === 'complete') {
  startPolling();
} else {
  window.addEventListener('load', startPolling);
}

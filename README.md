# Meeting Transcriber

Chrome extension that auto-transcribes meetings with speaker identification. Works with Microsoft Teams, Google Meet, Zoom, and WebEx.

## Features

- **Real-time transcription** - Transcribe meetings as they happen
- **Speaker diarization** - Identifies different speakers with names from the meeting UI
- **Multiple transcription backends**:
  - Local Whisper server (free, offline)
  - OpenAI Whisper API
  - AssemblyAI (best speaker diarization)
- **Export formats** - TXT, SRT (subtitles), JSON
- **No recording indicator** - Other participants won't see a recording notification

## Installation

### 1. Generate Icons

Open `generate-icons.html` in Chrome, then download the 3 PNG files to the `icons/` folder.

### 2. Load Extension

1. Go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select this repository root (the folder containing `manifest.json`)

### 3. Set Up Transcription (choose one)

#### Option A: Local Whisper Server (Free, Offline)

```bash
cd whisper-server
pip install -r requirements.txt
python server.py
```

Leave the server running while using the extension.

#### Option B: OpenAI Whisper API

1. Get an API key from [OpenAI](https://platform.openai.com/api-keys)
2. Open the extension popup → Settings
3. Select "OpenAI Whisper API" and enter your key

Check current provider pricing before use.

#### Option C: AssemblyAI

1. Get an API key from [AssemblyAI](https://www.assemblyai.com/)
2. Open the extension popup → Settings
3. Select "AssemblyAI" and enter your key

Check current provider pricing before use.

## Usage

1. Join a meeting (Teams, Meet, Zoom, or WebEx)
2. Click the extension icon
3. Click "Start Recording"
4. Speak - the transcript will appear in real-time
5. Use the "Speakers" panel to correct any speaker names
6. Click "Stop" when done
7. Export as TXT, SRT, or JSON

## How Speaker Identification Works

The extension uses two methods to identify speakers:

1. **Meeting UI Detection**: A content script monitors the meeting interface for speaking indicators (the colored border that appears around active speakers). When someone speaks, their name is captured from the UI.

2. **Voice Profile Matching**: Audio analysis creates voice "fingerprints" based on frequency patterns. When the same voice is heard again, it's matched to the previously identified speaker.

## Supported Platforms

| Platform | Transcription | Speaker Names |
|----------|--------------|---------------|
| Microsoft Teams | ✅ | ✅ |
| Google Meet | ✅ | ✅ |
| Zoom (Web) | ✅ | ✅ |
| WebEx | ✅ | ✅ |

## Privacy & Legal

This extension captures audio locally from your browser tab. Audio is sent to the transcription backend you select, including the local server when configured. External backends send audio to their providers; model assets may also be downloaded. Review the selected path before using sensitive audio.

**Important**: Recording meetings without consent may violate:
- Local laws (many jurisdictions require all-party consent)
- Platform terms of service
- Workplace policies

Use responsibly and ethically.

## Development

```
recorder/
├── manifest.json           # Extension configuration
├── background.js           # Service worker
├── content-script.js       # Meeting UI scraper
├── offscreen.js            # Audio processing
├── popup.html/js           # Extension UI
├── transcription-worker.js # In-browser Whisper (experimental)
└── whisper-server/         # Local transcription server
    ├── server.py
    └── requirements.txt
```

## License

MIT

## Maintainer documentation

[Project guide: setup, architecture, verification and operations](docs/PROJECT.md) · [Changelogs](changelogs/README.md). The project guide distinguishes implemented behavior from proposals and live deployment evidence.


## Architecture diagrams

[Current architecture, data flow and change-planning guidance](docs/diagrams/README.md).

# Local Whisper Server

Free, offline transcription server for the Meeting Transcriber Chrome extension.

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Run server (downloads model on first run)
python server.py
```

The server runs on `http://localhost:8080` and the Chrome extension will auto-detect it.

## Model Selection

Choose a model based on your needs:

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| tiny | ~40MB | Fastest | Basic |
| base | ~75MB | Fast | Good |
| small | ~250MB | Medium | Better |
| medium | ~750MB | Slow | High |
| large | ~1.5GB | Slowest | Best |

To use a different model:

```bash
WHISPER_MODEL=small python server.py
```

## GPU Acceleration

If you have an NVIDIA GPU with CUDA:

```bash
pip install nvidia-cublas-cu12 nvidia-cudnn-cu12
```

The server will automatically use GPU if available.

## API Endpoints

- `GET /health` - Check server status
- `POST /transcribe` - Transcribe audio file (multipart form with `file` field)
- `GET /models` - List available models

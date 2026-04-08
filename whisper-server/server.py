#!/usr/bin/env python3
"""
Local Whisper Transcription Server
Provides free, offline transcription for the Meeting Transcriber Chrome extension.

Install dependencies:
    pip install faster-whisper flask flask-cors

Run:
    python server.py

The server will listen on http://localhost:8080
"""

import os
import sys
import tempfile
from flask import Flask, request, jsonify
from flask_cors import CORS

# Try faster-whisper first (faster, uses CTranslate2)
try:
    from faster_whisper import WhisperModel
    USE_FASTER_WHISPER = True
except ImportError:
    USE_FASTER_WHISPER = False
    try:
        import whisper
    except ImportError:
        print("Error: Please install either faster-whisper or openai-whisper")
        print("  pip install faster-whisper  (recommended, faster)")
        print("  pip install openai-whisper  (alternative)")
        sys.exit(1)

app = Flask(__name__)
CORS(app)  # Enable CORS for Chrome extension

# Global model instance
model = None
MODEL_SIZE = os.environ.get('WHISPER_MODEL', 'base')  # tiny, base, small, medium, large


def load_model():
    global model
    if model is not None:
        return

    print(f"Loading Whisper model: {MODEL_SIZE}")

    if USE_FASTER_WHISPER:
        # faster-whisper uses CTranslate2 for better performance
        model = WhisperModel(
            MODEL_SIZE,
            device="auto",  # Uses GPU if available
            compute_type="auto"
        )
    else:
        model = whisper.load_model(MODEL_SIZE)

    print("Model loaded successfully")


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'model': MODEL_SIZE,
        'engine': 'faster-whisper' if USE_FASTER_WHISPER else 'openai-whisper'
    })


@app.route('/transcribe', methods=['POST'])
def transcribe():
    """Transcribe audio file"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    audio_file = request.files['file']

    # Save to temporary file
    with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name

    try:
        load_model()

        if USE_FASTER_WHISPER:
            segments, info = model.transcribe(
                tmp_path,
                language='en',
                beam_size=5,
                vad_filter=True  # Filter out silence
            )

            # Collect segments
            text_parts = []
            segment_list = []
            for segment in segments:
                text_parts.append(segment.text)
                segment_list.append({
                    'start': segment.start,
                    'end': segment.end,
                    'text': segment.text
                })

            result = {
                'text': ' '.join(text_parts).strip(),
                'segments': segment_list,
                'language': info.language,
                'duration': info.duration
            }
        else:
            # OpenAI Whisper
            result = model.transcribe(
                tmp_path,
                language='en',
                fp16=False
            )
            result = {
                'text': result['text'].strip(),
                'segments': result.get('segments', []),
                'language': result.get('language', 'en')
            }

        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e)}), 500

    finally:
        # Clean up temp file
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.route('/models', methods=['GET'])
def list_models():
    """List available model sizes"""
    return jsonify({
        'available': ['tiny', 'base', 'small', 'medium', 'large'],
        'current': MODEL_SIZE,
        'description': {
            'tiny': '~40MB, fastest, least accurate',
            'base': '~75MB, good balance',
            'small': '~250MB, better accuracy',
            'medium': '~750MB, high accuracy',
            'large': '~1.5GB, best accuracy'
        }
    })


if __name__ == '__main__':
    print("=" * 50)
    print("Meeting Transcriber - Local Whisper Server")
    print("=" * 50)
    print(f"Model: {MODEL_SIZE}")
    print(f"Engine: {'faster-whisper' if USE_FASTER_WHISPER else 'openai-whisper'}")
    print()
    print("To use a different model, set WHISPER_MODEL environment variable:")
    print("  WHISPER_MODEL=small python server.py")
    print()
    print("Starting server on http://localhost:8080")
    print("=" * 50)

    # Pre-load model
    load_model()

    app.run(host='0.0.0.0', port=8080, debug=False)

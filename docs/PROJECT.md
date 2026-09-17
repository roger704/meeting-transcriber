# Browser meeting transcription extension

Reviewed against source `7a9af437c372e2a15a99e0fed75ced2d198b2b4b` on 2026-09-17. This guide describes tracked implementation and does not assert live deployment state.

## Purpose and architecture

Manifest V3 extension: service worker (`background.js`), meeting UI content script, offscreen audio processing and popup. Optional local Flask/Whisper server lives in `whisper-server/`; external transcription backends are separate services.

## Setup and development

Load this repository root as an unpacked Chrome extension after generating the icons described in README. For local transcription, create a Python virtual environment, install `whisper-server/requirements.txt`, then run `python server.py` from that directory. `WHISPER_MODEL` selects the model; startup may download model weights.

## Verification

Use a test meeting/audio sample, start and stop capture, inspect transcript and export TXT/SRT/JSON. Check `GET /health` on the local server. There is no tracked CI test/deploy workflow.

## Deployment and operations

The Flask server binds `0.0.0.0:8080`, has permissive CORS and no request authentication. Keep it on a trusted local network or place access controls in front of it. Replacing extension files requires reloading the extension; existing tabs may need reload. Back up desired transcript exports before clearing browser data.

Every actual deployment needs a distinct record under [changelogs](../changelogs/README.md), including exact revision/artifact, environment, outcome and operational notes. A source merge or successful build is not deployment evidence.

## Interfaces and further reading

[Local transcription API](API.md). External provider prices and availability are not guaranteed by this repository.

## Architecture diagrams

Read [the current architecture and data-flow maps](diagrams/README.md) before planning changes. Proposed behavior is labeled separately from implemented behavior.

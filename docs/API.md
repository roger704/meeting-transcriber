# Local Whisper HTTP API

Implementation: `whisper-server/server.py`. Default base URL `http://localhost:8080`.
No authentication is implemented; CORS is enabled globally and the server binds all interfaces. Restrict access at the host/network boundary. External OpenAI/AssemblyAI APIs are not implemented here.

| Method/path | Input | Response |
|---|---|---|
| GET `/health` | None | JSON `status`, configured `model`, selected `engine` |
| GET `/models` | None | Available model names, current model and descriptions |
| POST `/transcribe` | Multipart field `file` containing audio | JSON `text`, `segments`, `language`; faster-whisper also returns `duration` |

Both engines currently force English. Segments contain start/end times and text; engine-specific extra fields can differ. Missing `file` returns 400 with `error`; processing exceptions return 500 with `error`. Temporary uploaded audio is removed in a finally block. Models preload at startup; health reports process readiness, not transcription quality.

```sh
curl --fail http://localhost:8080/health
curl --fail -F 'file=@sample.webm' http://localhost:8080/transcribe
```

Use a non-sensitive local sample for smoke tests. No streaming transcription endpoint or request-size policy is declared by this Flask application.

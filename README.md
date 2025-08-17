# VideoCut (MVP)

Simple in-browser video editor using FFmpeg.wasm for audio extraction and local Whisper transcription (Transformers.js). Includes fast export via stream copy and `.srt` subtitle export named after the loaded video.

## Features

- **Simple timeline editing** with zoom/scroll and segment selection.
- **Fast export (no re-encode)** via stream copy (when keyframe alignment allows).
- **Local transcription (Whisper tiny)** in the browser via `@xenova/transformers`.
- **Default language: English (en)** with fallback to auto-detection.
- **SRT export** using the **video's base filename** for best player compatibility.
- **Smooth UI**: ASR runs in a **Web Worker** and logging is lightweight to prevent stalls.

## Tech stack

- UI: HTML/CSS/JS (no framework)
- Video/audio: **FFmpeg.wasm**
  - `@ffmpeg/ffmpeg`: 0.11.6 (recommended)
  - `@ffmpeg/core-st`: 0.11.0 (single-threaded to avoid SharedArrayBuffer restrictions)
- ASR: **Transformers.js** (`@xenova/transformers`) with `Xenova/whisper-tiny` (quantized)
- Optional local server: `server.js` (Node) or `server.py` (Python) to serve with the right headers

## Project structure

- `index.html`: main UI and dependency loading (includes `#exportStatus`).
- `styles.css`: styles.
- `app.js`: app logic (timeline, cuts, export, transcription, UI status).
- `asrWorker.js`: Web Worker to run Whisper off the main thread.
- `server.js` / `server.py`: simple local servers.

## Browser requirements

For FFmpeg.wasm and Workers, serve the app with security headers:
- Cross-Origin-Opener-Policy: `same-origin`
- Cross-Origin-Embedder-Policy: `require-corp`

They are already included in `index.html` via meta tags. Avoid `file://`; use a local HTTP server.

## Getting started

1) Clone the repo and install dependencies (if you use Node as the server):

```bash
npm install
```

2) Start a local server. Options:

- Node (recommended on Windows):

```bash
node server.js
# open http://localhost:3000
```

- Python 3:

```bash
python server.py
# open http://127.0.0.1:8000
```

3) Open the URL and load a video (`.mp4`, etc.).

## Usage

- **Load video**: click "📂 Load video".
- **Cut**: ✂️ at the current playhead. Select segments and delete with 🗑️.
- **Fast export**: "💾 Export"; attempts stream copy (no re-encode).
- **Transcribe**: "🧠 Transcribe"; processes audio locally and shows captions overlay.
- **Export SRT**: "📝 Export .srt"; file name matches the video (e.g., `my_video.srt`).
 - **Zoom**: move the "Zoom" slider or use `Ctrl + mouse wheel` over the timeline.
 - **Scroll**: move the "Scroll" slider or use `Shift + mouse wheel` over the timeline.
 - **Frame-by-frame step**: click the timeline and press `Ctrl + Right/Left Arrow` to move 1 frame.
 - **Delete selected segment**: press `Delete`.
 - **Play/Pause**: use the `▶️/⏸️` button.

## Transcription details (Whisper)

- Model: `Xenova/whisper-tiny` (quantized) for speed/quality balance.
- Flow: extract 16kHz mono WAV → decode → ASR (in a Worker when available).
- Default language: **en**; fallback to auto-detection if no segments.
- Relevant files/functions:
  - `app.js` → `transcribeVideo()` and UI status (`updateExportStatus`).
  - `asrWorker.js` for off-main-thread execution.

## Performance and UI

- Avoid logging large objects/tensors; only the segment count is logged.
- Before/after heavy operations, intermediate statuses are shown and the **main thread yields** (rAF/timeout) so the UI can render.
- If a Worker cannot load (CORS/MIME), a **main-thread fallback** is used (may cause lag). Use the local server to enable Workers.

## Common issues

- "Page freezes after 100%": serve with `server.js`/`server.py` to allow Workers and COOP/COEP.
- Worker creation error (MIME/CORS): serve over HTTP (not `file://`).
- `Cannot call unknown function proxy_main`: ensure compatible FFmpeg versions and proper init. This app uses single-threaded `core-st`.

## License

MIT

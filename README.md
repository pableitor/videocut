# VideoCut (MVP)

Editor de vídeo simple en el navegador con extracción de audio vía FFmpeg.wasm y transcripción local con Whisper (Transformers.js). Incluye exportación rápida por copia de streams y exportación de subtítulos `.srt` con el mismo nombre que el vídeo cargado.

## Características

- **Corte sencillo por timeline** con zoom/scroll y selección de segmentos.
- **Exportación rápida (sin recodificar)** por copia de streams (si es posible según keyframes).
- **Transcripción local (Whisper tiny)** ejecutada en el navegador mediante `@xenova/transformers`.
- **Idioma por defecto: inglés (en)** con fallback a autodetección.
- **Exportación SRT** usando el **mismo nombre base del vídeo** para máxima compatibilidad con reproductores.
- **UI fluida**: ejecución de ASR en **Web Worker** y logs ligeros para evitar bloqueos.

## Tech stack

- UI: HTML/CSS/JS (no framework)
- Video/audio: **FFmpeg.wasm**
  - `@ffmpeg/ffmpeg`: 0.11.6 (recomendado)
  - `@ffmpeg/core-st`: 0.11.0 (single-threaded para evitar restricciones de SharedArrayBuffer)
- ASR: **Transformers.js** (`@xenova/transformers`) con modelo `Xenova/whisper-tiny` (cuantizado)
- Servidor local opcional: `server.js` (Node) o `server.py` (Python) para servir la app con los headers adecuados

## Estructura

- `index.html`: UI principal y carga de dependencias (incluye `#exportStatus`).
- `styles.css`: estilos.
- `app.js`: lógica de la app (timeline, cortes, export, transcripción, estados UI).
- `asrWorker.js`: Web Worker para ejecutar Whisper fuera del hilo principal.
- `server.js` / `server.py`: servidores simples para entorno local.

## Requisitos del navegador

Para FFmpeg.wasm y Workers es recomendable servir la app con cabeceras de seguridad:
- Cross-Origin-Opener-Policy: `same-origin`
- Cross-Origin-Embedder-Policy: `require-corp`

Estas ya están incluidas en `index.html` via meta tags. Evita abrir por `file://`; usa un servidor local.

## Puesta en marcha

1) Clona el repo e instala dependencias (si usas Node para el servidor):

```bash
npm install
```

2) Inicia un servidor local. Opciones:

- Node (recomendado para Windows):

```bash
node server.js
# abre http://localhost:3000
```

- Python 3:

```bash
python server.py
# abre http://127.0.0.1:8000
```

3) Abre la URL y carga un vídeo (`.mp4`, etc.).

## Uso

- **Cargar vídeo**: botón "📂 Cargar video".
- **Cortar**: botón ✂️ en el playhead. Selecciona segmentos y elimina con 🗑️.
- **Exportación rápida**: "💾 Exportar"; intenta copy stream sin recodificar.
- **Transcribir**: "🧠 Transcribir"; procesa el audio localmente y muestra subtítulos en overlay.
- **Exportar SRT**: "📝 Exportar .srt"; el archivo se llamará como el vídeo (p. ej. `mi_video.srt`).
 - **Zoom**: desliza el control "Zoom" o usa `Ctrl + rueda del ratón` sobre el timeline.
 - **Scroll**: desliza el control "Scroll" o usa `Shift + rueda del ratón` sobre el timeline.
 - **Avance/retroceso frame a frame**: haz click en el timeline y pulsa `Ctrl + Flecha Derecha/Izquierda` para mover el playhead 1 frame.
 - **Borrar segmento seleccionado**: pulsa la tecla `Supr/Del`.
 - **Reproducir/Pausar**: usa el botón `▶️/⏸️`.

## Detalles de Transcripción (Whisper)

- Modelo: `Xenova/whisper-tiny` (cuantizado) para equilibrio de velocidad/precisión.
- Flujo: extracción WAV 16kHz mono → decodificación → ASR (en Worker si está disponible).
- Idioma por defecto: **en**; fallback a autodetección si no hay segmentos.
- Archivo/funciones relevantes:
  - `app.js` → `transcribeVideo()` y estado UI (`updateExportStatus`).
  - `asrWorker.js` para ejecución off-main-thread.

## Rendimiento y UI

- Se evita loguear objetos/tensores grandes; se imprime solo el número de segmentos.
- Antes/después de operaciones pesadas se muestran estados intermedios y se **cede el hilo** (rAF/timeout) para que la UI pinte inmediatamente.
- Si un Worker no puede cargarse (CORS/MIME), se usa un **fallback en main thread** (puede notarse lag). Usa el servidor local para habilitar Workers.

## Problemas comunes

- "La página se bloquea tras 100%": asegúrate de servir con `server.js`/`server.py` para permitir Workers y COOP/COEP.
- Error al crear Worker (MIME/CORS): sirve el repo con un servidor HTTP (no `file://`).
- `Cannot call unknown function proxy_main`: comprueba versiones compatibles de FFmpeg y la inicialización. Esta app usa `core-st` single-threaded.

## Licencia

MIT

// asrWorker.js (module worker)
// Runs Whisper ASR off the main thread to keep UI responsive

import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.15.0/dist/transformers.min.js';

let asr = null;

async function ensureASR() {
  if (!asr) {
    // tiny multilingual; quantized to reduce CPU/memory
    asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', { quantized: true });
  }
  return asr;
}

self.addEventListener('message', async (ev) => {
  const { id, type, payload } = ev.data || {};
  try {
    if (type === 'init') {
      await ensureASR();
      self.postMessage({ id, ok: true, type: 'init' });
      return;
    }
    if (type === 'transcribe') {
      const { pcm, opts } = payload;
      const asrFn = await ensureASR();
      const result = await asrFn(pcm, opts);
      // Normalize to a lightweight array of segments
      let segments = [];
      if (Array.isArray(result?.segments)) {
        segments = result.segments.map(s => ({ start: s.start || 0, end: s.end || 0, text: (s.text || '').trim() }));
      } else if (Array.isArray(result?.chunks)) {
        segments = result.chunks.map(s => ({ start: s.timestamp?.[0] ?? 0, end: s.timestamp?.[1] ?? 0, text: (s.text || '').trim() }));
      } else if (result?.text) {
        segments = [{ start: 0, end: 0, text: (result.text || '').trim() }];
      }
      self.postMessage({ id, ok: true, type: 'transcribe', payload: { segments } });
      return;
    }
    self.postMessage({ id, ok: false, error: 'Unknown message type' });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
});

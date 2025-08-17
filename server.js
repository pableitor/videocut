const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const multer = require('multer');

const app = express();
const port = 3000;

// Required headers for SharedArrayBuffer
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

// Parse JSON (limits not too strict since segments is small)
app.use(express.json({ limit: '1mb' }));

// Serve static files
app.use(express.static(__dirname));

// Multer in-memory storage for uploaded video
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB

// NVENC export endpoint (fast): re-encode video with NVENC, copy audio, concat demuxer
// Expects multipart/form-data with fields:
// - video: file (mp4)
// - segments: JSON string [{start:number,end:number}, ...]
app.post('/export-nvenc', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Falta archivo de video' });
    }
    const segments = JSON.parse(req.body.segments || '[]');
    if (!Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ error: 'Faltan segmentos' });
    }

    // Write input to a temp file
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'videocut-'));
    const inPath = path.join(tmpDir, 'input.mp4');
    fs.writeFileSync(inPath, req.file.buffer);

    // Per-segment processing: re-encode video only (NVENC), copy audio; concat with demuxer
    const segFiles = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segPath = path.join(tmpDir, `seg_${i}.mp4`);
      const args = [
        '-y',
        '-ss', String(seg.start),
        '-to', String(seg.end),
        // Enable GPU decode to reduce CPU work (if supported)
        '-hwaccel', 'cuda',
        '-hwaccel_output_format', 'cuda',
        '-i', inPath,
        // Video via NVENC: fastest preset, low-latency, simple settings
        '-c:v', 'h264_nvenc',
        '-preset', 'p1',
        '-tune', 'll',
        '-rc', 'constqp',
        '-qp', '32',
        '-rc-lookahead', '0',
        '-bf', '0',
        '-g', '120',
        '-refs', '1',
        // Audio copy to avoid re-encode when possible
        '-c:a', 'copy',
        segPath,
      ];
      await new Promise((resolve, reject) => {
        const ff = spawn('ffmpeg', args);
        let stderr = '';
        ff.stderr.on('data', (d) => { stderr += d.toString(); });
        ff.on('close', (code) => {
          if (code !== 0) return reject(new Error(stderr));
          resolve();
        });
      });
      segFiles.push(segPath);
    }

    // Write concat list
    const listPath = path.join(tmpDir, 'list.txt');
    fs.writeFileSync(listPath, segFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));

    // Concat with stream copy
    const outPath = path.join(tmpDir, 'output.mp4');
    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', outPath]);
      let stderr = '';
      ff.stderr.on('data', (d) => { stderr += d.toString(); });
      ff.on('close', (code) => {
        if (code !== 0) return reject(new Error(stderr));
        resolve();
      });
    });

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="video_nvenc.mp4"');
    const stream = fs.createReadStream(outPath);
    stream.on('close', () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} });
    stream.pipe(res);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Pure copy (no re-encode) endpoint: fastest, requires keyframe-friendly cuts
app.post('/export-copy', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta archivo de video' });
    const segments = JSON.parse(req.body.segments || '[]');
    if (!Array.isArray(segments) || segments.length === 0) return res.status(400).json({ error: 'Faltan segmentos' });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'videocut-'));
    const inPath = path.join(tmpDir, 'input.mp4');
    fs.writeFileSync(inPath, req.file.buffer);

    const segFiles = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segPath = path.join(tmpDir, `seg_${i}.mp4`);
      await new Promise((resolve, reject) => {
        const ff = spawn('ffmpeg', ['-y', '-ss', String(seg.start), '-to', String(seg.end), '-i', inPath, '-c', 'copy', segPath]);
        let stderr = '';
        ff.stderr.on('data', (d) => { stderr += d.toString(); });
        ff.on('close', (code) => { if (code !== 0) return reject(new Error(stderr)); resolve(); });
      });
      segFiles.push(segPath);
    }

    const listPath = path.join(tmpDir, 'list.txt');
    fs.writeFileSync(listPath, segFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));

    const outPath = path.join(tmpDir, 'output_copy.mp4');
    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', outPath]);
      let stderr = '';
      ff.stderr.on('data', (d) => { stderr += d.toString(); });
      ff.on('close', (code) => { if (code !== 0) return reject(new Error(stderr)); resolve(); });
    });

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="video_copy.mp4"');
    const stream = fs.createReadStream(outPath);
    stream.on('close', () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} });
    stream.pipe(res);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log('Make sure to access the app through this server, not by opening index.html directly');
  console.log('POST /export-nvenc disponible (requiere FFmpeg con NVENC)');
});
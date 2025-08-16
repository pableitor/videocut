// VideoCut MVP (sin miniaturas)
// Lógica principal

(() => {
  const fileInput = document.getElementById('fileInput');
  const player = document.getElementById('player');
  const playPauseBtn = document.getElementById('playPauseBtn');
  const knifeBtn = document.getElementById('knifeBtn');
  const deleteBtn = document.getElementById('deleteBtn');
  const exportBtn = document.getElementById('exportBtn');
  const exportStatus = document.getElementById('exportStatus');
  const timeline = document.getElementById('timelineCanvas');
  const curLbl = document.getElementById('currentTime');
  const totLbl = document.getElementById('totalTime');
  const zoomRange = document.getElementById('zoomRange');
  const zoomLabel = document.getElementById('zoomLabel');
  const scrollRange = document.getElementById('scrollRange');
  const scrollLabel = document.getElementById('scrollLabel');

  // Modelo
  let duration = 0;
  let cuts = []; // segundos (excluye 0 y duration)
  let removed = []; // [{start,end}] rangos eliminados
  let selected = null; // {start,end} segmento seleccionado

  // Viewport del timeline (para zoom/scroll)
  let zoom = 1; // 1..12 (escala de la duración EDITADA)
  let viewportStart = 0; // segundo inicial visible (en TIEMPO EDITADO)

  // Estado de arrastre de cortes
  let isDragging = false;
  let draggingCutIndex = -1;
  let dragStartCanvasX = 0;
  let suppressNextClick = false; // para evitar selección tras drag
  const DRAG_TOL_PX = 8; // tolerancia para enganchar un corte
  const MIN_GAP = 0.02; // separación mínima entre cortes (s)

  function viewportDuration() {
    return editedDuration() / Math.max(zoom, 1e-6);
  }

  function clampViewport() {
    const vd = viewportDuration();
    const maxStart = Math.max(0, editedDuration() - vd);
    viewportStart = Math.min(Math.max(0, viewportStart), maxStart);
  }

  // Helpers de tiempo
  const fmt = (s) => {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  function enableUI(loaded) {
    playPauseBtn.disabled = !loaded;
    knifeBtn.disabled = !loaded;
    deleteBtn.disabled = !loaded || !selected;
    exportBtn.disabled = !loaded;
    zoomRange.disabled = !loaded;
    scrollRange.disabled = !loaded || duration === 0;
  }

  // Canvas HiDPI
  function resizeCanvasToDisplaySize(canvas) {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width * ratio);
    const h = Math.round(rect.height * ratio);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      return true;
    }
    return false;
  }

  function timeToX(t) {
    const rect = timeline.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    // Mapear t dentro del viewport [viewportStart, viewportStart+viewportDuration]
    const vd = viewportDuration();
    const rel = (sourceToEdited(t) - viewportStart) / Math.max(vd, 1e-6);
    const px = rel * rect.width * ratio;
    return px;
  }
  function xToTime(xClient) {
    const rect = timeline.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const x = (xClient - rect.left) * ratio;
    const vd = viewportDuration();
    const e = viewportStart + (x / Math.max(rect.width * ratio, 1)) * vd; // tiempo EDITADO
    const s = editedToSource(e);
    return s;
  }

  function clientXToCanvasX(xClient) {
    const rect = timeline.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    return (xClient - rect.left) * ratio;
  }

  function findNearestCutIndex(xClient) {
    if (!cuts.length) return -1;
    const canvasX = clientXToCanvasX(xClient);
    const ratio = window.devicePixelRatio || 1;
    const tol = DRAG_TOL_PX * ratio;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < cuts.length; i++) {
      if (isInRemoved(cuts[i])) continue; // cortes ocultos no son arrastrables
      const cx = timeToX(cuts[i]);
      const d = Math.abs(cx - canvasX);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestDist <= tol ? bestIdx : -1;
  }

  function snapTime(t, canvasX) {
    // Snap al playhead y a rejilla de ticks dentro de un umbral en píxeles
    const ratio = window.devicePixelRatio || 1;
    const tol = DRAG_TOL_PX * ratio;
    let bestT = t;
    let bestDx = Infinity;
    // playhead
    const ph = Math.min(player.currentTime || 0, duration);
    const phX = timeToX(ph);
    const dxPh = Math.abs(phX - canvasX);
    if (dxPh < bestDx && dxPh <= tol) { bestDx = dxPh; bestT = ph; }
    // rejilla
    const step = chooseTickStep(viewportDuration());
    const gridT = Math.round(t / step) * step;
    const gridX = timeToX(Math.max(0, Math.min(duration, gridT)));
    const dxGrid = Math.abs(gridX - canvasX);
    if (dxGrid < bestDx && dxGrid <= tol) { bestDx = dxGrid; bestT = gridT; }
    return Math.max(0, Math.min(duration, bestT));
  }

  function uniqSortedPush(arr, value) {
    // evita duplicados cerca (tolerancia 0.02s)
    const tol = 0.02;
    for (const v of arr) if (Math.abs(v - value) < tol) return arr;
    arr.push(value);
    arr.sort((a, b) => a - b);
    return arr;
  }

  function mergeRanges(ranges) {
    if (!ranges.length) return [];
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const out = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = out[out.length - 1];
      const cur = sorted[i];
      if (cur.start <= prev.end) {
        prev.end = Math.max(prev.end, cur.end);
      } else {
        out.push({ ...cur });
      }
    }
    return out;
  }

  function isInRemoved(t) {
    for (const r of removed) {
      if (t >= r.start && t < r.end) return r;
    }
    return null;
  }

  function clampSelectionToActive(seg) {
    // si el segmento está completamente eliminado, no es seleccionable
    for (const r of removed) {
      if (seg.start >= r.start && seg.end <= r.end) return null;
    }
    return seg;
  }

  function allBoundaries() {
    return [0, ...cuts, duration];
  }

  function pickSegmentAtTime(t) {
    const b = allBoundaries();
    for (let i = 0; i < b.length - 1; i++) {
      const start = b[i], end = b[i + 1];
      if (t > start && t < end) {
        return { start, end };
      }
    }
    // si cae exactamente en un corte, coge el segmento a la izquierda si existe
    for (let i = 0; i < b.length - 1; i++) {
      const start = b[i], end = b[i + 1];
      if (t === start && i > 0) return { start: b[i - 1], end: start };
      if (t === end && i < b.length - 2) return { start: end, end: b[i + 2] };
    }
    return null;
  }

  function deleteSelected() {
    if (!selected) return;
    removed = mergeRanges([...removed, { start: selected.start, end: selected.end }]);
    selected = null;
    deleteBtn.disabled = true;
    render();
  }

  // Render del timeline
  function render() {
    const ctx = timeline.getContext('2d');
    const changed = resizeCanvasToDisplaySize(timeline);
    const w = timeline.width;
    const h = timeline.height;
    // Fondo
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0c0f14';
    ctx.fillRect(0, 0, w, h);

    // Regla de tiempo
    const padTop = 24;
    const padBottom = 28;
    const midY = (h - padTop - padBottom) / 2 + padTop;

    // Líneas guía
    ctx.strokeStyle = '#1f2633';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // Ticks y etiquetas
    ctx.fillStyle = '#9aa4b2';
    ctx.font = `${12 * (window.devicePixelRatio || 1)}px system-ui`;
    const vd = viewportDuration();
    const eStart = viewportStart;
    const eEnd = Math.min(editedDuration(), viewportStart + vd);
    const step = chooseTickStep(vd);
    // Alinear primer tick (en tiempo EDITADO)
    const firstTick = Math.ceil(eStart / step) * step;
    for (let e = firstTick; e <= eEnd + 1e-6; e += step) {
      const sTick = editedToSource(Math.min(e, eEnd));
      const x = timeToX(sTick);
      const isMajor = Math.round(e) % (step * 2) === 0;
      const tickH = isMajor ? 12 : 6;
      ctx.strokeStyle = '#2a3342';
      ctx.beginPath();
      ctx.moveTo(x, midY - tickH);
      ctx.lineTo(x, midY + tickH);
      ctx.stroke();
      if (isMajor) {
        ctx.fillStyle = '#9aa4b2';
        ctx.fillText(fmt(e), x + 4, padTop - 6 + (12 * (window.devicePixelRatio || 1)));
      }
    }

    // (Modo comprimido) No pintamos zonas eliminadas

    // Segmento seleccionado
    if (selected) {
      const x1 = timeToX(selected.start);
      const x2 = timeToX(selected.end);
      ctx.strokeStyle = '#2bd67b';
      ctx.lineWidth = 2;
      ctx.strokeRect(x1 + 0.5, padTop + 0.5, (x2 - x1) - 1, (h - padTop - padBottom) - 1);
    }

    // Cortes
    for (const c of cuts) {
      if (isInRemoved(c)) continue; // cortes dentro de eliminado no aparecen
      const x = Math.round(timeToX(c)) + 0.5;
      ctx.strokeStyle = '#4da3ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, h - padBottom);
      ctx.stroke();
    }

    // Playhead
    const t = Math.min(player.currentTime || 0, duration);
    const x = Math.round(timeToX(t)) + 0.5; // usa mapping source→edited internamente
    ctx.strokeStyle = '#e7ecf3';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();

    // Etiquetas de tiempo UI
    curLbl.textContent = fmt(t);
    totLbl.textContent = fmt(editedDuration());

    // Labels de zoom y scroll
    zoomLabel.textContent = `${zoom.toFixed(1)}x`;
    const maxStart = Math.max(0, editedDuration() - vd);
    const scrollPct = maxStart > 0 ? (viewportStart / maxStart) * 100 : 0;
    scrollLabel.textContent = `${scrollPct.toFixed(0)}%`;
  }

  function chooseTickStep(dur) {
    if (dur <= 10) return 1;
    if (dur <= 30) return 5;
    if (dur <= 60) return 10;
    if (dur <= 3 * 60) return 15;
    if (dur <= 10 * 60) return 30;
    return 60;
  }

  // Eventos
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    player.src = url;
    player.load();
    cuts = [];
    removed = [];
    selected = null;
    zoom = 1;
    viewportStart = 0;
    enableUI(false);
  });

  player.addEventListener('loadedmetadata', () => {
    duration = player.duration || 0;
    enableUI(true);
    playPauseBtn.textContent = '▶️ Reproducir';
    knifeBtn.textContent = '✂️ Cortar en playhead';
    // sliders
    zoomRange.value = String(zoom);
    scrollRange.value = '0';
    clampViewport();
    render();
  });

  player.addEventListener('timeupdate', () => {
    // saltar segmentos eliminados
    const r = isInRemoved(player.currentTime);
    if (r) {
      // Salta al final del rango
      const next = Math.min(r.end + 0.001, duration);
      if (next < duration) player.currentTime = next; else player.pause();
    }
    // auto-scroll: mantener playhead visible (en tiempo editado)
    followPlayhead();
    render();
  });

  player.addEventListener('seeking', render);
  player.addEventListener('play', () => { playPauseBtn.textContent = '⏸️ Pausar'; });
  player.addEventListener('pause', () => { playPauseBtn.textContent = '▶️ Reproducir'; });

  playPauseBtn.addEventListener('click', () => {
    if (player.paused) player.play(); else player.pause();
  });

  knifeBtn.addEventListener('click', () => {
    if (!duration) return;
    const tCut = Math.min(Math.max(player.currentTime || 0, 0.001), duration - 0.001);
    uniqSortedPush(cuts, tCut);
    render();
  });

  deleteBtn.addEventListener('click', deleteSelected);

  // Interacción con el timeline
  timeline.addEventListener('mousedown', (ev) => {
    if (!duration) return;
    const idx = findNearestCutIndex(ev.clientX);
    if (idx !== -1) {
      isDragging = true;
      draggingCutIndex = idx;
      dragStartCanvasX = clientXToCanvasX(ev.clientX);
      suppressNextClick = false;
      ev.preventDefault();
    }
  });

  timeline.addEventListener('mousemove', (ev) => {
    const ratio = window.devicePixelRatio || 1;
    if (isDragging && draggingCutIndex !== -1) {
      const canvasX = clientXToCanvasX(ev.clientX);
      if (Math.abs(canvasX - dragStartCanvasX) > 3 * ratio) {
        suppressNextClick = true;
      }
      let t = xToTime(ev.clientX);
      // Snap
      t = snapTime(t, canvasX);
      // Limitar entre vecinos
      const i = draggingCutIndex;
      const leftBound = (i === 0 ? 0 : cuts[i - 1]) + MIN_GAP;
      const rightBound = (i === cuts.length - 1 ? duration : cuts[i + 1]) - MIN_GAP;
      t = Math.max(leftBound, Math.min(rightBound, t));
      cuts[i] = t;
      render();
      timeline.style.cursor = 'ew-resize';
    } else {
      // Cambiar cursor cuando se pasa cerca de un corte
      const idx = findNearestCutIndex(ev.clientX);
      timeline.style.cursor = idx !== -1 ? 'ew-resize' : 'default';
    }
  });

  function endDrag() {
    if (isDragging) {
      isDragging = false;
      draggingCutIndex = -1;
    }
  }

  timeline.addEventListener('mouseup', () => { endDrag(); });
  timeline.addEventListener('mouseleave', () => { endDrag(); });

  timeline.addEventListener('click', (ev) => {
    if (!duration) return;
    if (suppressNextClick) { suppressNextClick = false; return; }
    const t = xToTime(ev.clientX);

    // Ignora clicks dentro de un rango eliminado
    if (isInRemoved(t)) {
      selected = null;
      deleteBtn.disabled = true;
      render();
      return;
    }

    // Selección de segmento
    const seg = pickSegmentAtTime(t);
    const clamped = seg ? clampSelectionToActive(seg) : null;
    selected = clamped;
    deleteBtn.disabled = !selected;
    render();
  });

  // Sliders de zoom y scroll
  zoomRange.addEventListener('input', () => {
    zoom = Math.max(1, Math.min(12, Number(zoomRange.value) || 1));
    // Centrar playhead (en editado) tras el zoom
    const e = sourceToEdited(player.currentTime || 0);
    const vd = viewportDuration();
    viewportStart = Math.max(0, e - vd / 2);
    clampViewport();
    updateScrollRangeFromViewport();
    render();
  });

  scrollRange.addEventListener('input', () => {
    const pct = Math.max(0, Math.min(100, Number(scrollRange.value) || 0));
    const vd = viewportDuration();
    const maxStart = Math.max(0, editedDuration() - vd);
    viewportStart = (pct / 100) * maxStart;
    clampViewport();
    render();
  });

  function updateScrollRangeFromViewport() {
    const vd = viewportDuration();
    const maxStart = Math.max(0, editedDuration() - vd);
    const pct = maxStart > 0 ? (viewportStart / maxStart) * 100 : 0;
    scrollRange.value = String(pct);
  }

  function followPlayhead() {
    const e = sourceToEdited(Math.min(player.currentTime || 0, duration));
    const start = viewportStart;
    const end = viewportStart + viewportDuration();
    const margin = (end - start) * 0.15; // margen 15%
    if (e < start + margin) {
      viewportStart = Math.max(0, e - (end - start) * 0.5);
      clampViewport();
      updateScrollRangeFromViewport();
    } else if (e > end - margin) {
      viewportStart = Math.max(0, e - (end - start) * 0.5);
      clampViewport();
      updateScrollRangeFromViewport();
    }
  }

  // Redibujar al redimensionar
  window.addEventListener('resize', render);

  // RANGOS ACTIVOS (duración editada)
  function mergedRemoved() { return mergeRanges(removed); }
  function activeRanges() {
    const rem = mergedRemoved();
    if (!rem.length) return [{ start: 0, end: duration }];
    const ranges = [];
    let cur = 0;
    for (const r of rem) {
      if (r.start > cur) ranges.push({ start: cur, end: r.start });
      cur = Math.max(cur, r.end);
    }
    if (cur < duration) ranges.push({ start: cur, end: duration });
    return ranges;
  }
  function editedDuration() { return activeRanges().reduce((a, r) => a + (r.end - r.start), 0); }

  // MAPEOS source↔edited
  function sourceToEdited(s) {
    // Devuelve la posición en tiempo EDITADO acumulado para el tiempo fuente s
    s = Math.max(0, Math.min(duration, s));
    let acc = 0;
    for (const r of activeRanges()) {
      if (s < r.start) break; // está en una sección eliminada previa
      if (s <= r.end) {
        return acc + (s - r.start);
      }
      acc += (r.end - r.start);
    }
    // Si cae en eliminado al final, colapsa al final del editado
    return editedDuration();
  }
  function editedToSource(e) {
    e = Math.max(0, Math.min(editedDuration(), e));
    let acc = 0;
    for (const r of activeRanges()) {
      const len = r.end - r.start;
      if (e <= acc + len) {
        return r.start + (e - acc);
      }
      acc += len;
    }
    return duration;
  }

  // FFmpeg instance and state - using global instance from index.html
  const ffmpeg = window.ffmpeg;
  let isFFmpegLoading = false;
  let ffmpegLoadPromise = null;

  // Initialize FFmpeg - using global instance
  async function initFFmpeg() {
    if (!window.ffmpeg) {
      throw new Error('FFmpeg no está disponible. Asegúrate de que el script de FFmpeg se cargó correctamente.');
    }
    
    if (isFFmpegLoading) {
      return ffmpegLoadPromise || Promise.resolve(ffmpeg);
    }
    
    isFFmpegLoading = true;
    updateExportStatus('Cargando motor de exportación...', 'progress');
    
    try {
      ffmpegLoadPromise = (async () => {
        try {
          if (!ffmpeg.isLoaded()) {
            await ffmpeg.load();
          }
          updateExportStatus('Motor de exportación listo', 'success');
          return ffmpeg;
        } catch (error) {
          console.error('Error al cargar FFmpeg:', error);
          updateExportStatus('Error al cargar el motor de exportación', 'error');
          throw error;
        }
      })();
      
      return await ffmpegLoadPromise;
    } catch (error) {
      isFFmpegLoading = false;
      throw error;
    }
  }

  // Get or initialize FFmpeg instance
  async function getFFmpeg() {
    if (ffmpeg) return ffmpeg;
    if (!ffmpegLoadPromise) {
      ffmpegLoadPromise = initFFmpeg();
    }
    return ffmpegLoadPromise;
  }

  // Export function
  async function exportVideo() {
    if (!player.src || player.readyState === 0) {
      updateExportStatus('Error: No hay video cargado', 'error');
      return;
    }

    try {
      updateExportStatus('Preparando exportación...', 'progress');
      
      // Get FFmpeg instance
      const ffmpeg = await getFFmpeg();
      
      // Get all segments (both kept and removed)
      const allSegments = [];
      const sortedCuts = [...cuts].sort((a, b) => a - b);
      
      // Create all segments from cuts
      let currentStart = 0;
      for (const cut of sortedCuts) {
        if (cut > currentStart) {
          allSegments.push({ 
            start: currentStart, 
            end: cut,
            keep: true // Default to keeping segments
          });
        }
        currentStart = cut;
      }
      
      // Add the last segment
      if (currentStart < player.duration) {
        allSegments.push({ 
          start: currentStart, 
          end: player.duration,
          keep: true
        });
      }
      
      // Mark removed segments
      for (const removedSeg of removed) {
        for (const seg of allSegments) {
          if (seg.start >= removedSeg.start && seg.end <= removedSeg.end) {
            seg.keep = false;
          }
        }
      }
      
      // Filter to keep only the segments we want
      const segmentsToKeep = allSegments.filter(seg => seg.keep);
      
      if (segmentsToKeep.length === 0) {
        throw new Error('No hay segmentos para exportar');
      }

      updateExportStatus('Procesando video... (esto puede tardar varios minutos)', 'progress');
      
      // Fetch the video file
      const response = await fetch(player.src);
      const videoData = await response.arrayBuffer();
      
      // Write the input file
      ffmpeg.FS('writeFile', 'input.mp4', new Uint8Array(videoData));
      
      // Build the filter complex for cutting and concatenating
      let filterComplex = '';
      const inputSegments = [];
      
      // For each segment to keep, create trim filters
      segmentsToKeep.forEach((seg, i) => {
        filterComplex += `[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[v${i}];`;
        filterComplex += `[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${i}];`;
        inputSegments.push(`[v${i}][a${i}]`);
      });
      
      // Concatenate all segments
      filterComplex += `${inputSegments.join('')}concat=n=${segmentsToKeep.length}:v=1:a=1[outv][outa]`;
      
      // Run FFmpeg with the filter complex
      await ffmpeg.run(
        '-i', 'input.mp4',
        '-filter_complex', filterComplex,
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-preset', 'ultrafast',
        '-crf', '28',
        '-movflags', '+faststart',
        'output.mp4'
      );
      
      // Get the result
      const data = ffmpeg.FS('readFile', 'output.mp4');
      
      // Create download link
      const blob = new Blob([data.buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `video_editado_${new Date().toISOString().slice(0, 10)}.mp4`;
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        ffmpeg.FS('unlink', 'input.mp4');
        ffmpeg.FS('unlink', 'output.mp4');
      }, 100);
      
      updateExportStatus('¡Exportación completada con éxito!', 'success');
      
    } catch (error) {
      console.error('Error al exportar el video:', error);
      updateExportStatus(`Error: ${error.message}`, 'error');
    } finally {
      exportBtn.disabled = false;
    }
  }

  // Update status function
  function updateExportStatus(message, type = 'info') {
    if (!exportStatus) return;
  
    exportStatus.textContent = message;
    exportStatus.className = 'status-message visible';
  
    // Resetear clases
    exportStatus.classList.remove('success', 'error', 'progress');
  
    // Añadir clase de tipo si se especifica
    if (type) {
      exportStatus.classList.add(type);
    }
  }

  // Initialize FFmpeg when the page loads
  document.addEventListener('DOMContentLoaded', () => {
    // Preload FFmpeg when the page loads
    getFFmpeg().catch(console.error);
  
    // Export button click handler
    exportBtn?.addEventListener('click', () => {
      exportBtn.disabled = true;
      exportVideo().catch(console.error);
    });
  });
})();

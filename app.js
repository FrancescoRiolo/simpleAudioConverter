/**
 * app.js — SimpleAudioConverter
 *
 * Input:  any format supported by the browser's Web Audio API
 *         (mp3, wav, ogg, flac, aac, m4a, opus, aiff, …)
 * Output: MP3 (lamejs) or WAV (Web Audio API native)
 *
 * Single file  → direct download
 * Multi files  → ZIP archive named [SimpleAudioConverter]_Conversion_YYYYMMDD_HHMMSS.zip
 *
 * External deps (loaded via CDN in index.html):
 *   - lamejs 1.2.0  → window.lamejs
 *   - JSZip 3.x     → window.JSZip
 */

'use strict';

// ── Easter egg: triple-click logo → dark mode ─────────────────────────────
(function () {
  const CLICKS_NEEDED = 3;
  const WINDOW_MS     = 600; // max ms between clicks

  let clickCount = 0;
  let lastClick  = 0;
  let darkActive = false;

  function triggerEasterEgg() {
    darkActive = !darkActive;
    document.body.classList.toggle('dark', darkActive);

    // Flash overlay
    const flash = document.createElement('div');
    flash.className = 'theme-flash';
    document.body.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove());

    // Logo bounce
    const icon = document.querySelector('.brand-icon');
    if (icon) {
      icon.classList.remove('easter');
      void icon.offsetWidth; // reflow to restart animation
      icon.classList.add('easter');
      icon.addEventListener('animationend', () => icon.classList.remove('easter'), { once: true });
    }

    // Swap logo icon light ↔ dark
    const logoSvg = document.querySelector('.brand-icon svg');
    if (logoSvg) {
      if (darkActive) {
        logoSvg.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
      } else {
        logoSvg.innerHTML = '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>';
      }
    }
  }

  document.addEventListener('click', (e) => {
    const brand = e.target.closest('.brand-icon, .brand-name, .nav-brand');
    if (!brand) return;

    const now = Date.now();
    if (now - lastClick > WINDOW_MS) clickCount = 0;
    lastClick = now;
    clickCount++;

    if (clickCount >= CLICKS_NEEDED) {
      clickCount = 0;
      triggerEasterEgg();
    }
  });
})();

// ── DOM refs ──────────────────────────────────────────────────────────────
const dropZone      = document.getElementById('dropZone');
const fileInput     = document.getElementById('fileInput');
const browseBtn     = document.getElementById('browseBtn');
const removeAllBtn  = document.getElementById('removeAllBtn');
const fileListEl    = document.getElementById('fileList');
const fileCountEl   = document.getElementById('fileCount');
const browseMoreBtn = document.getElementById('browseMoreBtn');

const btnMp3        = document.getElementById('btnMp3');
const btnWav        = document.getElementById('btnWav');
const mp3Options    = document.getElementById('mp3Options');
const bitrateEl     = document.getElementById('bitrate');
const channelsEl    = document.getElementById('channels');

const convertBtn    = document.getElementById('convertBtn');
const convertLabel  = document.getElementById('convertBtnLabel');

const progressBlock = document.getElementById('progressBlock');
const progressFill  = document.getElementById('progressFill');
const progressText  = document.getElementById('progressText');
const progressPct   = document.getElementById('progressPct');

const statusMsg     = document.getElementById('statusMsg');
const downloadLink  = document.getElementById('downloadLink');
const downloadSub   = document.getElementById('downloadSub');

// ── State ─────────────────────────────────────────────────────────────────
let selectedFiles  = [];   // Array<File>
let outputFormat   = 'mp3';
let currentBlobURL = null;

// ── Format toggle ─────────────────────────────────────────────────────────
btnMp3.addEventListener('click', () => setFormat('mp3'));
btnWav.addEventListener('click', () => setFormat('wav'));

function setFormat(fmt) {
  outputFormat = fmt;
  btnMp3.classList.toggle('active', fmt === 'mp3');
  btnWav.classList.toggle('active', fmt === 'wav');
  mp3Options.classList.toggle('hidden', fmt !== 'mp3');
}

// ── File selection ────────────────────────────────────────────────────────
browseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
dropZone.addEventListener('click', (e) => {
  if (removeAllBtn && (e.target === removeAllBtn || removeAllBtn.contains(e.target))) return;
  // Don't open picker when clicking a remove button inside the list
  if (e.target.closest('.file-item-remove')) return;
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) addFiles(Array.from(fileInput.files));
  fileInput.value = '';
});

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/') || isAudioExt(f.name));
  if (files.length) addFiles(files);
});

if (removeAllBtn) {
  removeAllBtn.addEventListener('click', (e) => { e.stopPropagation(); clearAllFiles(); });
}
if (browseMoreBtn) {
  browseMoreBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
}

function isAudioExt(name) {
  return /\.(mp3|wav|ogg|flac|aac|m4a|opus|wma|aiff|aif|ac3|amr|mp2|au|caf|mka)$/i.test(name);
}

function addFiles(newFiles) {
  // Deduplicate by name+size
  const existing = new Set(selectedFiles.map(f => f.name + f.size));
  const toAdd = newFiles.filter(f => !existing.has(f.name + f.size));
  selectedFiles = [...selectedFiles, ...toAdd];
  renderFileList();
  clearStatus();
  hideDownload();
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  renderFileList();
  clearStatus();
  hideDownload();
}

function clearAllFiles() {
  selectedFiles = [];
  renderFileList();
  clearStatus();
  hideDownload();
}

function renderFileList() {
  const hasFiles = selectedFiles.length > 0;
  dropZone.classList.toggle('has-files', hasFiles);
  convertBtn.disabled = !hasFiles;

  if (!hasFiles) {
    fileListEl.innerHTML = '';
    fileCountEl.textContent = '';
    return;
  }

  const plural = selectedFiles.length === 1 ? 'file' : 'files';
  fileCountEl.textContent = `${selectedFiles.length} ${plural} selected`;

  fileListEl.innerHTML = selectedFiles.map((f, i) => `
    <div class="file-item" data-index="${i}">
      <div class="file-item-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
        </svg>
      </div>
      <div class="file-item-info">
        <span class="file-item-name">${escapeHtml(f.name)}</span>
        <span class="file-item-size">${formatBytes(f.size)}</span>
      </div>
      <button class="file-item-remove" data-index="${i}" title="Remove">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `).join('');

  // Attach remove handlers
  fileListEl.querySelectorAll('.file-item-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFile(parseInt(btn.dataset.index, 10));
    });
  });
}

// ── Main conversion ───────────────────────────────────────────────────────
convertBtn.addEventListener('click', async () => {
  if (!selectedFiles.length) return;

  convertBtn.disabled = true;
  convertLabel.textContent = 'Processing…';
  clearStatus();
  hideDownload();

  const opts = {
    bitrate:  parseInt(bitrateEl.value, 10),
    channels: parseInt(channelsEl.value, 10),
  };

  try {
    if (selectedFiles.length === 1) {
      await convertSingle(selectedFiles[0], opts);
    } else {
      await convertBatch(selectedFiles, opts);
    }
  } catch (err) {
    hideProgress();
    showError(err.message);
    console.error(err);
  } finally {
    convertBtn.disabled = false;
    convertLabel.textContent = 'Convert';
  }
});

// ── Single file conversion ────────────────────────────────────────────────
async function convertSingle(file, opts) {
  showProgress(0, `Reading ${file.name}…`);

  const blob = await convertFile(file, opts, (p) => {
    setProgress(p * 100, buildProgressLabel(file.name, p));
  });

  setProgress(100, 'Done!');
  await deliverSingle(blob, file.name);
  setTimeout(() => {
    hideProgress();
    showSuccess(`✓ Conversion complete — ${formatBytes(blob.size)}`);
  }, 500);
}

// ── Batch conversion + ZIP ────────────────────────────────────────────────
async function convertBatch(files, opts) {
  if (typeof JSZip === 'undefined') {
    throw new Error('JSZip not loaded. Check your internet connection.');
  }

  const zip = new JSZip();
  const total = files.length;

  for (let i = 0; i < total; i++) {
    const file = files[i];
    const overallBase = i / total;
    const overallSlice = 1 / total;

    showProgress(
      overallBase * 100,
      `Converting file ${i + 1} of ${total}: ${file.name}`
    );

    let blob;
    try {
      blob = await convertFile(file, opts, (p) => {
        setProgress((overallBase + p * overallSlice) * 100,
          `File ${i + 1}/${total} — ${buildProgressLabel(file.name, p)}`);
      });
    } catch (err) {
      // Skip failed files, collect error but continue
      console.warn(`Skipping ${file.name}:`, err);
      zip.file(`FAILED_${file.name}.txt`, `Conversion failed: ${err.message}`);
      continue;
    }

    // Keep original stem, replace extension
    const stem = file.name.replace(/\.[^.]+$/, '');
    zip.file(`${stem}.${outputFormat}`, blob);
  }

  setProgress(97, 'Creating ZIP archive…');
  await yieldToMain();

  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });

  setProgress(100, 'Done!');
  await deliverZip(zipBlob, total);
  setTimeout(() => {
    hideProgress();
    showSuccess(`✓ ${total} file${total > 1 ? 's' : ''} converted — ${formatBytes(zipBlob.size)}`);
  }, 500);
}

// ── Core converter (single AudioBuffer → Blob) ────────────────────────────
async function convertFile(file, opts, onProgress) {
  const arrayBuffer = await readFileAsArrayBuffer(file);
  onProgress(0.05);

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  let audioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (err) {
    await audioCtx.close();
    throw new Error(`Cannot decode "${file.name}": ${err.message}`);
  }
  await audioCtx.close();
  onProgress(0.2);

  if (outputFormat === 'wav') {
    return audioBufferToWavBlob(audioBuffer, (p) => onProgress(0.2 + p * 0.78));
  } else {
    return audioBufferToMp3Blob(audioBuffer, opts, (p) => onProgress(0.2 + p * 0.78));
  }
}

// ── Deliver helpers ───────────────────────────────────────────────────────
function deliverSingle(blob, originalName) {
  if (currentBlobURL) URL.revokeObjectURL(currentBlobURL);
  currentBlobURL = URL.createObjectURL(blob);
  const stem = originalName.replace(/\.[^.]+$/, '');
  const outName = `${stem}.${outputFormat}`;
  downloadLink.href = currentBlobURL;
  downloadLink.download = outName;
  downloadSub.textContent = `${outName} · ${formatBytes(blob.size)}`;
  downloadLink.classList.add('visible');
}

function deliverZip(blob, fileCount) {
  if (currentBlobURL) URL.revokeObjectURL(currentBlobURL);
  currentBlobURL = URL.createObjectURL(blob);
  const ts = buildTimestamp();
  const zipName = `[SimpleAudioConverter]_Conversion_${ts}.zip`;
  downloadLink.href = currentBlobURL;
  downloadLink.download = zipName;
  downloadSub.textContent = `${zipName} · ${formatBytes(blob.size)}`;
  downloadLink.classList.add('visible');
}

function buildTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function buildProgressLabel(name, p) {
  const pct = Math.round(p * 100);
  if (p < 0.06) return `Reading ${name}…`;
  if (p < 0.22) return `Decoding ${name}…`;
  return `Encoding ${outputFormat.toUpperCase()}… ${pct}%`;
}

// ── WAV encoder ───────────────────────────────────────────────────────────
function audioBufferToWavBlob(buffer, onProgress) {
  const numChannels    = buffer.numberOfChannels;
  const sampleRate     = buffer.sampleRate;
  const numSamples     = buffer.length;
  const bytesPerSample = 2;
  const dataSize       = numChannels * numSamples * bytesPerSample;

  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view      = new DataView(wavBuffer);

  writeString(view, 0,  'RIFF');
  view.setUint32(4,  36 + dataSize, true);
  writeString(view, 8,  'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1,  true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate,  true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const chData = [];
  for (let c = 0; c < numChannels; c++) chData.push(buffer.getChannelData(c));

  let offset = 44;
  const reportEvery = Math.floor(numSamples / 20) || 1;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, chData[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
    if (i % reportEvery === 0) onProgress(i / numSamples);
  }
  onProgress(1);
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

// ── MP3 encoder (lamejs) ──────────────────────────────────────────────────
async function audioBufferToMp3Blob(buffer, opts, onProgress) {
  if (typeof lamejs === 'undefined') {
    throw new Error('lamejs not loaded. Check your internet connection.');
  }

  const { bitrate = 128, channels: outChannels = 2 } = opts;
  const sampleRate  = buffer.sampleRate;
  const numSamples  = buffer.length;
  const srcChannels = buffer.numberOfChannels;

  const leftF32  = buffer.getChannelData(0);
  const rightF32 = srcChannels > 1 ? buffer.getChannelData(1) : leftF32;

  let encLeft = leftF32, encRight = rightF32;
  const encChannels = outChannels;

  if (outChannels === 1 && srcChannels > 1) {
    const mono = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) mono[i] = (leftF32[i] + rightF32[i]) * 0.5;
    encLeft = encRight = mono;
  }

  const mp3Encoder  = new lamejs.Mp3Encoder(encChannels, sampleRate, bitrate);
  const mp3Data     = [];
  const CHUNK       = 1152;
  const reportEvery = Math.max(1, Math.floor(numSamples / CHUNK / 20));

  for (let i = 0; i < numSamples; i += CHUNK) {
    const end    = Math.min(i + CHUNK, numSamples);
    const lChunk = floatToInt16(encLeft.subarray(i, end));
    const rChunk = floatToInt16(encRight.subarray(i, end));
    const encoded = encChannels === 1
      ? mp3Encoder.encodeBuffer(lChunk)
      : mp3Encoder.encodeBuffer(lChunk, rChunk);
    if (encoded.length > 0) mp3Data.push(encoded);

    const chunkIdx = Math.floor(i / CHUNK);
    if (chunkIdx % reportEvery === 0) {
      onProgress(i / numSamples);
      await yieldToMain();
    }
  }

  const flushed = mp3Encoder.flush();
  if (flushed.length > 0) mp3Data.push(flushed);
  onProgress(1);
  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

function floatToInt16(f32) {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return i16;
}

// ── Utils ─────────────────────────────────────────────────────────────────
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = (e) => resolve(e.target.result);
    r.onerror = ()  => reject(new Error(`Error reading "${file.name}".`));
    r.readAsArrayBuffer(file);
  });
}

function yieldToMain() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function formatBytes(bytes) {
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1048576)     return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Progress UI ───────────────────────────────────────────────────────────
function showProgress(pct, text) {
  progressBlock.classList.add('visible');
  progressFill.classList.add('running');
  updateProgress(pct, text ?? 'Processing…');
}
function setProgress(pct, text) { updateProgress(pct, text); }
function updateProgress(pct, text) {
  progressFill.style.width = Math.min(pct, 100) + '%';
  progressText.textContent = text;
  progressPct.textContent  = Math.round(Math.min(pct, 100)) + '%';
}
function hideProgress() {
  progressBlock.classList.remove('visible');
  progressFill.classList.remove('running');
  progressFill.style.width = '0%';
}

function showSuccess(msg) { statusMsg.className = 'status-msg success'; statusMsg.textContent = msg; }
function showError(msg)   { statusMsg.className = 'status-msg error';   statusMsg.textContent = '✕ ' + msg; }
function clearStatus()    { statusMsg.className = 'status-msg';         statusMsg.textContent = ''; }
function hideDownload()   { downloadLink.classList.remove('visible'); }

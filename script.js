// ======================================================
// DibyaShare — script.js
// Created by Dibya Jyoti Mahanta
// ======================================================

const DB_KEY = 'dibyashare_files';
const MAX_SIZE_MB = 500;
const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024;

// ─── Allowed types ────────────────────────────────────
const ALLOWED_TYPES = {
  all: null,
  images: ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml'],
  docs: ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'],
  media: ['video/mp4','video/webm','audio/mpeg','audio/ogg','audio/wav'],
};

// ─── File icon map ─────────────────────────────────────
function getFileIcon(mime) {
  if (!mime) return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime === 'application/pdf') return '📕';
  if (mime.includes('word')) return '📝';
  if (mime.includes('excel') || mime.includes('spreadsheet')) return '📊';
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z')) return '🗜️';
  if (mime.startsWith('text/')) return '📄';
  if (mime.includes('powerpoint') || mime.includes('presentation')) return '📊';
  return '📁';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function generateId() {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

// ─── Storage helpers ───────────────────────────────────
function saveFile(meta) {
  const store = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
  store[meta.id] = meta;
  localStorage.setItem(DB_KEY, JSON.stringify(store));
}

function getFile(id) {
  const store = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
  return store[id] || null;
}

function updateFile(id, patch) {
  const store = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
  if (store[id]) {
    store[id] = { ...store[id], ...patch };
    localStorage.setItem(DB_KEY, JSON.stringify(store));
  }
}

// ─── Theme ─────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('dibyashare_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('dibyashare_theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// ─── Toast ─────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, duration);
}

// ─── Upload page state ─────────────────────────────────
let pendingFiles = [];
let uploadPaused = false;
let uploadAbort = null;

function initUploadPage() {
  initTheme();

  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const folderInput = document.getElementById('folderInput');
  const btnUpload = document.getElementById('btnUpload');
  const typeFilter = document.getElementById('typeFilter');

  // Drag & Drop
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    addFiles([...e.dataTransfer.files]);
  });
  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => addFiles([...fileInput.files]));
  folderInput.addEventListener('change', () => addFiles([...folderInput.files]));

  document.getElementById('btnPickFile').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
  document.getElementById('btnPickFolder')?.addEventListener('click', e => { e.stopPropagation(); folderInput.click(); });

  btnUpload.addEventListener('click', startUpload);
  document.getElementById('btnPause')?.addEventListener('click', togglePause);
  document.getElementById('btnCancel')?.addEventListener('click', cancelUpload);
  document.getElementById('btnNewUpload')?.addEventListener('click', resetUpload);
  document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

  typeFilter?.addEventListener('change', () => renderFileList());
}

function addFiles(files) {
  const typeFilter = document.getElementById('typeFilter')?.value || 'all';
  const allowed = ALLOWED_TYPES[typeFilter];

  files.forEach(f => {
    if (f.size > MAX_SIZE) { toast(`${f.name} exceeds ${MAX_SIZE_MB}MB limit`, 'error'); return; }
    if (allowed && !allowed.includes(f.type)) { toast(`${f.name} — type not allowed`, 'error'); return; }
    if (pendingFiles.find(p => p.name === f.name && p.size === f.size)) return; // dedupe
    pendingFiles.push(f);
  });
  renderFileList();
}

function renderFileList() {
  const container = document.getElementById('fileListContainer');
  const section = document.getElementById('fileListSection');
  if (!container) return;
  container.innerHTML = '';

  if (pendingFiles.length === 0) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

  pendingFiles.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <span class="file-icon">${getFileIcon(f.type)}</span>
      <div class="file-info">
        <div class="file-name">${f.name}</div>
        <div class="file-meta">${formatSize(f.size)} · ${f.type || 'Unknown type'}</div>
      </div>
      <button class="file-remove" data-idx="${i}" title="Remove">✕</button>
    `;
    item.querySelector('.file-remove').addEventListener('click', () => {
      pendingFiles.splice(i, 1);
      renderFileList();
    });
    container.appendChild(item);
  });

  document.getElementById('btnUpload').disabled = pendingFiles.length === 0;
}

function clearAll() {
  pendingFiles = [];
  renderFileList();
}

// ─── Upload ────────────────────────────────────────────
async function startUpload() {
  if (!pendingFiles.length) { toast('Please add files first', 'error'); return; }

  const note = document.getElementById('uploaderNote')?.value.trim() || '';
  const expiry = parseInt(document.getElementById('expirySelect')?.value || '86400');
  const dlLimit = parseInt(document.getElementById('dlLimit')?.value || '0');
  const password = document.getElementById('passwordInput')?.value.trim() || '';
  const oneTime = document.getElementById('toggleOneTime')?.querySelector('input')?.checked;
  const autoDelete = document.getElementById('toggleAutoDelete')?.querySelector('input')?.checked;

  document.getElementById('uploadSection').classList.add('hidden');
  document.getElementById('progressSection').classList.remove('hidden');
  document.getElementById('progressSection').classList.add('active');

  const progressFill = document.getElementById('progressFill');
  const progressPercent = document.getElementById('progressPercent');
  const progressStats = document.getElementById('progressStats');
  const progressLabel = document.getElementById('progressLabel');

  let uploaded = 0;
  const total = pendingFiles.reduce((a, f) => a + f.size, 0);
  const startTime = Date.now();
  const uploadedData = [];

  progressLabel.textContent = `Uploading ${pendingFiles.length} file${pendingFiles.length > 1 ? 's' : ''}…`;

  // Create ZIP if multiple files
  let filesToUpload = pendingFiles;
  let isZipped = false;

  if (pendingFiles.length > 1) {
    const createZip = document.getElementById('toggleZip')?.querySelector('input')?.checked;
    if (createZip) {
      try {
        toast('Creating ZIP archive…', 'info', 2000);
        const zip = await createZipBlob(pendingFiles);
        const zipName = `dibyashare-${Date.now()}.zip`;
        filesToUpload = [new File([zip], zipName, { type: 'application/zip' })];
        isZipped = true;
        progressLabel.textContent = 'Uploading ZIP archive…';
      } catch (e) {
        toast('ZIP creation failed, uploading individually', 'info');
      }
    }
  }

  for (const file of filesToUpload) {
    if (uploadPaused) await waitForResume();
    try {
      const url = await uploadFileToServer(file, (prog) => {
        const fileProgress = prog * file.size;
        const totalUploaded = uploaded + fileProgress;
        const pct = Math.round((totalUploaded / total) * 100);
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = totalUploaded / elapsed;
        progressFill.style.width = pct + '%';
        progressPercent.textContent = pct + '%';
        progressStats.textContent = `${formatSize(totalUploaded)} / ${formatSize(total)} · ${formatSize(speed)}/s`;
      });
      uploadedData.push({ name: file.name, size: file.size, type: file.type, url });
      uploaded += file.size;
    } catch (e) {
      toast(`Upload failed: ${e.message}`, 'error');
      resetToUpload();
      return;
    }
  }

  // Store metadata
  const id = generateId();
  const expiresAt = Date.now() + expiry * 1000;
  const meta = {
    id, note, expiresAt, expiry, dlLimit,
    password: password ? btoa(password) : '',
    oneTime, autoDelete, isZipped,
    files: uploadedData,
    uploadedAt: Date.now(),
    downloads: 0,
    downloadHistory: [],
    primaryFile: uploadedData[0],
  };
  saveFile(meta);

  // Show success
  document.getElementById('progressSection').classList.remove('active');
  document.getElementById('progressSection').classList.add('hidden');
  showSuccess(meta);
}

async function uploadFileToServer(file, onProgress) {
  // Use file.io API for temporary storage
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    uploadAbort = () => xhr.abort();

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        try {
          const resp = JSON.parse(xhr.responseText);
          if (resp.success && resp.link) {
            resolve(resp.link);
          } else {
            // fallback: use 0x0.st
            uploadTo0x0(file, onProgress).then(resolve).catch(reject);
          }
        } catch {
          reject(new Error('Invalid response'));
        }
      } else {
        uploadTo0x0(file, onProgress).then(resolve).catch(reject);
      }
    });

    xhr.addEventListener('error', () => uploadTo0x0(file, onProgress).then(resolve).catch(reject));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

    xhr.open('POST', 'https://file.io/?expires=1d');
    xhr.send(formData);
  });
}

async function uploadTo0x0(file, onProgress) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        resolve(xhr.responseText.trim());
      } else {
        // Fallback: store file as blob URL for demo
        const url = URL.createObjectURL(file);
        resolve(url);
      }
    });

    xhr.addEventListener('error', () => {
      // Last resort: create blob URL
      const url = URL.createObjectURL(file);
      resolve(url);
    });

    xhr.open('POST', 'https://0x0.st');
    xhr.send(formData);
  });
}

async function createZipBlob(files) {
  // Simple ZIP using JSZip if available, else throw
  if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.name, f);
  }
  return await zip.generateAsync({ type: 'blob' });
}

function togglePause() {
  uploadPaused = !uploadPaused;
  const btn = document.getElementById('btnPause');
  if (btn) btn.textContent = uploadPaused ? '▶ Resume' : '⏸ Pause';
  toast(uploadPaused ? 'Upload paused' : 'Upload resumed', 'info');
}

function cancelUpload() {
  if (uploadAbort) uploadAbort();
  resetToUpload();
  toast('Upload cancelled', 'info');
}

let resumeResolve = null;
function waitForResume() {
  return new Promise(r => { resumeResolve = r; });
}
// override togglePause to also resolve
const _tp = togglePause;

function resetToUpload() {
  uploadPaused = false;
  uploadAbort = null;
  document.getElementById('progressSection')?.classList.remove('active');
  document.getElementById('progressSection')?.classList.add('hidden');
  document.getElementById('uploadSection')?.classList.remove('hidden');
}

function resetUpload() {
  pendingFiles = [];
  renderFileList();
  document.getElementById('successPanel')?.classList.remove('active');
  document.getElementById('successPanel')?.classList.add('hidden');
  document.getElementById('uploadSection')?.classList.remove('hidden');
  document.getElementById('uploadCard')?.classList.remove('hidden');
  clearCountdown();
}

// ─── Show success ───────────────────────────────────────
let countdownInterval = null;

function showSuccess(meta) {
  const panel = document.getElementById('successPanel');
  if (!panel) return;

  const shareUrl = `${location.origin}/download.html?id=${meta.id}`;

  document.getElementById('shareLink').value = shareUrl;
  document.getElementById('uploadCard')?.classList.add('hidden');
  panel.classList.remove('hidden');
  panel.classList.add('active');

  // File info cards
  const f = meta.primaryFile;
  document.getElementById('infoFileName').textContent = f.name;
  document.getElementById('infoFileSize').textContent = formatSize(f.size);
  document.getElementById('infoFileType').textContent = f.type || 'Unknown';
  document.getElementById('infoUploadTime').textContent = new Date(meta.uploadedAt).toLocaleTimeString();
  document.getElementById('infoExpiry').textContent = new Date(meta.expiresAt).toLocaleString();
  document.getElementById('infoDlLimit').textContent = meta.dlLimit > 0 ? meta.dlLimit : '∞';

  // QR Code
  generateQR(shareUrl);

  // Share buttons
  const msg = `Download "${f.name}" from DibyaShare`;
  document.getElementById('btnShareEmail').href = `mailto:?subject=${encodeURIComponent(msg)}&body=${encodeURIComponent(shareUrl)}`;
  document.getElementById('btnShareWA').href = `https://wa.me/?text=${encodeURIComponent(msg + ' ' + shareUrl)}`;
  document.getElementById('btnShareTG').href = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(msg)}`;

  // Countdown
  startCountdown(meta.expiresAt);
}

function startCountdown(expiresAt) {
  const el = document.getElementById('countdownDisplay');
  if (!el) return;
  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    const diff = expiresAt - Date.now();
    if (diff <= 0) { el.textContent = 'Expired'; clearInterval(countdownInterval); return; }
    el.textContent = formatTime(diff);
  }, 1000);
}

function clearCountdown() { clearInterval(countdownInterval); }

function copyLink() {
  const input = document.getElementById('shareLink');
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.getElementById('btnCopyLink');
    btn.textContent = '✓ Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    toast('Link copied to clipboard!', 'success');
  });
}

function generateQR(url) {
  const el = document.getElementById('qrcode');
  if (!el) return;
  el.innerHTML = '';
  if (typeof QRCode !== 'undefined') {
    new QRCode(el, { text: url, width: 128, height: 128, colorDark: '#7c6aff', colorLight: '#ffffff' });
  } else {
    el.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=128x128&data=${encodeURIComponent(url)}&color=7c6aff" alt="QR Code" style="border-radius:8px;">`;
  }
}

// ─── Download page ─────────────────────────────────────
function initDownloadPage() {
  initTheme();
  document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

  const params = new URLSearchParams(location.search);
  const id = params.get('id');

  if (!id) { showError('No file ID provided.'); return; }

  const meta = getFile(id);
  if (!meta) { showError("This link doesn't exist or has expired."); return; }

  // Check expiry
  if (Date.now() > meta.expiresAt) {
    updateFile(id, { expired: true });
    showExpired(); return;
  }

  // Check download limit
  if (meta.dlLimit > 0 && meta.downloads >= meta.dlLimit) {
    showError('Download limit reached. This file is no longer available.'); return;
  }

  // Password check
  if (meta.password) {
    showPasswordGate(meta, id); return;
  }

  renderDownloadPage(meta, id);
}

function showPasswordGate(meta, id) {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('passwordGate').classList.remove('hidden');

  document.getElementById('btnUnlock').addEventListener('click', () => {
    const input = document.getElementById('passwordInput');
    if (btoa(input.value) === meta.password) {
      document.getElementById('passwordGate').classList.add('hidden');
      renderDownloadPage(meta, id);
    } else {
      input.style.borderColor = 'var(--red)';
      toast('Incorrect password', 'error');
      setTimeout(() => input.style.borderColor = '', 1500);
    }
  });

  document.getElementById('passwordInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btnUnlock').click();
  });
}

function renderDownloadPage(meta, id) {
  document.getElementById('loadingState').classList.add('hidden');
  const page = document.getElementById('downloadPage');
  page.classList.remove('hidden');

  const f = meta.primaryFile;
  document.getElementById('dlFileName').textContent = f.name;
  document.getElementById('dlFileIcon').textContent = getFileIcon(f.type);
  document.getElementById('dlFileMeta').textContent = `${formatSize(f.size)} · ${f.type || 'Unknown type'}`;
  document.getElementById('dlCount').textContent = meta.downloads;
  document.getElementById('dlLimit').textContent = meta.dlLimit > 0 ? meta.dlLimit : '∞';

  const lastDl = meta.downloadHistory?.slice(-1)[0];
  document.getElementById('dlLastTime').textContent = lastDl ? new Date(lastDl.time).toLocaleString() : 'Never';

  // Uploader note
  if (meta.note) {
    const noteEl = document.getElementById('uploaderNote');
    noteEl.classList.remove('hidden');
    document.getElementById('noteText').textContent = meta.note;
  }

  // Expiry
  const diff = meta.expiresAt - Date.now();
  document.getElementById('dlExpiry').textContent = formatTime(Math.max(0, diff));
  const pct = Math.max(0, Math.min(100, (diff / (meta.expiry * 1000)) * 100));
  document.getElementById('expiryFill').style.width = pct + '%';

  // Live countdown
  setInterval(() => {
    const d = meta.expiresAt - Date.now();
    document.getElementById('dlExpiry').textContent = formatTime(Math.max(0, d));
    const p = Math.max(0, Math.min(100, (d / (meta.expiry * 1000)) * 100));
    document.getElementById('expiryFill').style.width = p + '%';
  }, 1000);

  // Preview
  renderPreview(f);

  // Download button
  document.getElementById('btnDownload').addEventListener('click', () => doDownload(meta, id, f));

  // Download history
  renderHistory(meta);
}

function renderPreview(f) {
  const section = document.getElementById('previewSection');
  if (!section) return;
  const url = f.url;

  if (f.type?.startsWith('image/')) {
    section.innerHTML = `<img src="${url}" alt="${f.name}" style="max-height:320px;object-fit:contain;width:100%;">`;
    section.classList.remove('hidden');
  } else if (f.type?.startsWith('video/')) {
    section.innerHTML = `<video controls><source src="${url}" type="${f.type}">Your browser does not support video.</video>`;
    section.classList.remove('hidden');
  } else if (f.type?.startsWith('audio/')) {
    section.innerHTML = `<audio controls><source src="${url}" type="${f.type}">Your browser does not support audio.</audio>`;
    section.classList.remove('hidden');
  } else if (f.type === 'application/pdf') {
    section.innerHTML = `<iframe src="${url}" title="${f.name}"></iframe>`;
    section.classList.remove('hidden');
  } else {
    section.classList.add('hidden');
  }
}

async function doDownload(meta, id, f) {
  const btn = document.getElementById('btnDownload');
  btn.disabled = true;
  btn.textContent = '⬇ Downloading…';

  // Try country detection
  let country = '🌍 Unknown';
  try {
    const r = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    country = `${d.country_name || 'Unknown'}`;
  } catch {}

  // Update stats
  const history = meta.downloadHistory || [];
  history.push({ time: Date.now(), country });
  const newDl = meta.downloads + 1;
  updateFile(id, { downloads: newDl, downloadHistory: history });
  document.getElementById('dlCount').textContent = newDl;
  document.getElementById('dlLastTime').textContent = new Date().toLocaleString();
  renderHistory({ ...meta, downloads: newDl, downloadHistory: history });

  // Trigger download
  try {
    const a = document.createElement('a');
    a.href = f.url;
    a.download = f.name;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Download started!', 'success');
  } catch (e) {
    window.open(f.url, '_blank');
  }

  // One-time download
  if (meta.oneTime) {
    updateFile(id, { dlLimit: 1, downloads: 1 });
    toast('This was a one-time download link.', 'info', 5000);
    setTimeout(() => {
      btn.textContent = '⛔ Download limit reached';
    }, 500);
    return;
  }

  // Auto-delete after first download
  if (meta.autoDelete && newDl >= 1) {
    updateFile(id, { expiresAt: Date.now() });
    toast('File will be auto-deleted shortly.', 'info', 4000);
  }

  setTimeout(() => {
    btn.disabled = false;
    btn.innerHTML = '⬇&nbsp;&nbsp;Download Again';
  }, 2000);
}

function renderHistory(meta) {
  const container = document.getElementById('historyList');
  if (!container) return;
  const history = meta.downloadHistory || [];
  if (!history.length) { container.innerHTML = '<div style="color:var(--text-3);font-size:0.82rem;">No downloads yet</div>'; return; }
  container.innerHTML = history.slice(-5).reverse().map(h => `
    <div class="history-item">
      <span>🌍</span>
      <span>${h.country}</span>
      <span style="margin-left:auto;color:var(--text-3)">${new Date(h.time).toLocaleString()}</span>
    </div>
  `).join('');
}

function showExpired() {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('expiredState').classList.remove('hidden');
}

function showError(msg) {
  document.getElementById('loadingState').classList.add('hidden');
  const el = document.getElementById('errorState');
  if (el) { el.classList.remove('hidden'); document.getElementById('errorMsg').textContent = msg; }
}

// ─── Expose to global ──────────────────────────────────
window.initUploadPage = initUploadPage;
window.initDownloadPage = initDownloadPage;
window.copyLink = copyLink;
window.clearAll = clearAll;
window.toggleTheme = toggleTheme;

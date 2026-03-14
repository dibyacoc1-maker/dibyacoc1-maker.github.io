// ======================================================
// DibyaShare — script.js
// Created by Dibya Jyoti Mahanta
//
// Storage  : Firebase Realtime Database (REST API)
//            ≤5MB files → base64 stored directly in Firebase
//            >5MB files → file.io / 0x0.st / tmpfiles.org chain
//
// Share IDs: share1 → share2 → share3 … (global counter)
// ======================================================

// ── Firebase config ─────────────────────────────────────
const FB_URL = 'https://share-b5188-default-rtdb.firebaseio.com';

// ⚠️  RULES EXPIRY — 2026-04-12 (timestamp: 1775930400000)
// After that date reads & writes will be blocked (HTTP 403).
// Extend at: Firebase Console → Realtime Database → Rules
// New timestamps: https://currentmillis.com
const RULES_EXPIRY_MS = 1775930400000;

// File size threshold: ≤ this → store as base64 in Firebase (split into separate node)
// Firebase allows 10MB per string, base64 adds ~33% overhead, so 7MB raw ≈ 9.3MB base64 = safe
const BASE64_THRESHOLD = 7 * 1024 * 1024; // 7 MB raw → ~9.3 MB base64 (safe under 10MB limit)

// Max total file size
const MAX_SIZE_MB = 10;
const MAX_SIZE    = MAX_SIZE_MB * 1024 * 1024;

// ── Runtime expiry check ─────────────────────────────────
function checkRulesExpiry() {
  const diff = RULES_EXPIRY_MS - Date.now();
  if (diff < 0) {
    setTimeout(() => toast('⚠️ Firebase rules expired (2026-04-12). Update rules at Firebase Console.', 'error', 12000), 800);
  } else if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.ceil(diff / 86400000);
    setTimeout(() => toast(`⚠️ Firebase rules expire in ${days} day${days > 1 ? 's' : ''}! Update before 2026-04-12.`, 'info', 8000), 800);
  }
}

// ── Firebase REST helpers ────────────────────────────────
const fbRef = path => `${FB_URL}/${path}.json`;

async function fbGet(path) {
  const r = await fetch(fbRef(path));
  if (!r.ok) throw new Error(`DB read failed (${r.status})`);
  return r.json();
}

async function fbSet(path, data) {
  const r = await fetch(fbRef(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`DB write failed (${r.status})`);
  return r.json();
}

async function fbUpdate(path, data) {
  const r = await fetch(fbRef(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`DB update failed (${r.status})`);
  return r.json();
}

// ── Sequential counter → shareN ID ──────────────────────
async function getNextShareId() {
  for (let i = 0; i < 5; i++) {
    try {
      const current = (await fbGet('counter')) || 0;
      const next = current + 1;
      await fbSet('counter', next);
      return `share${next}`;
    } catch (e) {
      if (i === 4) throw e;
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
}

async function saveShareMeta(meta) {
  const sid = await getNextShareId();

  // Separate base64 file data from metadata to avoid large single writes.
  // Firebase silently hangs on large PUT payloads, so we split:
  //   shares/{sid}        → metadata (no base64 blobs)
  //   filedata/{sid}/{i}  → base64 string per file (separate PUT each)
  const filesWithoutData = [];
  for (let i = 0; i < meta.files.length; i++) {
    const f = meta.files[i];
    if (f.storage === 'firebase' && f.url && f.url.startsWith('data:')) {
      // Store base64 separately
      await fbSet(`filedata/${sid}/${i}`, f.url);
      filesWithoutData.push({ ...f, url: `__fb:${sid}/${i}` });
    } else {
      filesWithoutData.push(f);
    }
  }

  // Build primaryFile ref too
  const primaryIdx = meta.files.indexOf(meta.primaryFile);
  const cleanMeta = {
    ...meta,
    id: sid,
    files: filesWithoutData,
    primaryFile: filesWithoutData[primaryIdx >= 0 ? primaryIdx : 0],
  };

  await fbSet(`shares/${sid}`, cleanMeta);
  return sid;
}

async function getShareMeta(sid) {
  const meta = await fbGet(`shares/${sid}`);
  if (!meta) return null;

  // Re-attach base64 data for any firebase-stored files
  const files = await Promise.all((meta.files || []).map(async (f, i) => {
    if (f.url && f.url.startsWith('__fb:')) {
      const path = f.url.replace('__fb:', 'filedata/');
      const data = await fbGet(path);
      return { ...f, url: data || '' };
    }
    return f;
  }));

  // Rebuild primaryFile with real URL
  const primaryIdx = (meta.files || []).findIndex(f => f.url === meta.primaryFile?.url);
  return {
    ...meta,
    files,
    primaryFile: files[primaryIdx >= 0 ? primaryIdx : 0] || files[0],
  };
}

async function updateShareMeta(sid, patch) {
  // Never write base64 blobs through update — strip them out
  const safePatch = { ...patch };
  if (safePatch.files) {
    safePatch.files = safePatch.files.map(f => ({ ...f, url: f.url?.startsWith('data:') ? '__stripped__' : f.url }));
  }
  delete safePatch.primaryFile; // avoid re-writing large field
  return fbUpdate(`shares/${sid}`, safePatch);
}

// ── File → base64 data URL ───────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result); // "data:mime;base64,..."
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

// ── File type utils ──────────────────────────────────────
const ALLOWED_TYPES = {
  all:    null,
  images: ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml'],
  docs:   ['application/pdf','application/msword',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'],
  media:  ['video/mp4','video/webm','audio/mpeg','audio/ogg','audio/wav'],
};

function getFileIcon(mime) {
  if (!mime)                     return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime === 'application/pdf') return '📕';
  if (mime.includes('word'))     return '📝';
  if (mime.includes('excel') || mime.includes('spreadsheet')) return '📊';
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z')) return '🗜️';
  if (mime.startsWith('text/'))  return '📄';
  if (mime.includes('powerpoint') || mime.includes('presentation')) return '📊';
  return '📁';
}

function formatSize(b) {
  if (b < 1024)    return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Theme ────────────────────────────────────────────────
function initTheme() {
  const t = localStorage.getItem('dibyashare_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
  updateThemeIcon(t);
}
function toggleTheme() {
  const cur  = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('dibyashare_theme', next);
  updateThemeIcon(next);
}
function updateThemeIcon(t) {
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
}

// ── Toast ────────────────────────────────────────────────
function toast(msg, type = 'info', dur = 3500) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const wrap  = document.getElementById('toastContainer');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity    = '0';
    setTimeout(() => el.remove(), 300);
  }, dur);
}

// ── Upload page state ────────────────────────────────────
let pendingFiles  = [];
let uploadPaused  = false;
let uploadAbortFn = null;
let pauseResolve  = null;

function initUploadPage() {
  initTheme();
  checkRulesExpiry();

  const dz   = document.getElementById('dropZone');
  const fi   = document.getElementById('fileInput');
  const foli = document.getElementById('folderInput');

  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', ()  => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    addFiles([...e.dataTransfer.files]);
  });
  dz.addEventListener('click', () => fi.click());

  fi.addEventListener('change',   () => addFiles([...fi.files]));
  foli.addEventListener('change', () => addFiles([...foli.files]));

  document.getElementById('btnPickFile')  ?.addEventListener('click', e => { e.stopPropagation(); fi.click(); });
  document.getElementById('btnPickFolder')?.addEventListener('click', e => { e.stopPropagation(); foli.click(); });
  document.getElementById('btnUpload')    ?.addEventListener('click', startUpload);
  document.getElementById('btnPause')     ?.addEventListener('click', togglePause);
  document.getElementById('btnCancel')    ?.addEventListener('click', cancelUpload);
  document.getElementById('btnNewUpload') ?.addEventListener('click', resetUpload);
  document.getElementById('themeToggle')  ?.addEventListener('click', toggleTheme);
  document.getElementById('typeFilter')   ?.addEventListener('change', renderFileList);
}

function addFiles(files) {
  const tf      = document.getElementById('typeFilter')?.value || 'all';
  const allowed = ALLOWED_TYPES[tf];
  files.forEach(f => {
    if (f.size > MAX_SIZE) {
      toast(`${f.name} exceeds ${MAX_SIZE_MB}MB limit`, 'error'); return;
    }
    if (allowed && !allowed.includes(f.type)) {
      toast(`${f.name} — type not allowed`, 'error'); return;
    }
    if (!pendingFiles.find(p => p.name === f.name && p.size === f.size)) {
      pendingFiles.push(f);
    }
  });
  renderFileList();
}

function renderFileList() {
  const wrap = document.getElementById('fileListContainer');
  const sec  = document.getElementById('fileListSection');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!pendingFiles.length) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');

  // Show size warning if any file > BASE64_THRESHOLD
  const bigFiles = pendingFiles.filter(f => f.size > BASE64_THRESHOLD);
  if (bigFiles.length) {
    const note = document.createElement('div');
    note.style.cssText = 'font-size:.8rem;color:var(--yellow);padding:6px 10px;background:var(--yellow-dim);border-radius:8px;margin-bottom:8px;';
    note.textContent = `⚠️ Files >7MB will use external upload (file.io / 0x0.st)`;
    wrap.appendChild(note);
  }

  pendingFiles.forEach((f, i) => {
    const storageMode = f.size <= BASE64_THRESHOLD ? '☁️ Firebase' : '🌐 External';
    const d = document.createElement('div');
    d.className = 'file-item';
    d.innerHTML = `
      <span class="file-icon">${getFileIcon(f.type)}</span>
      <div class="file-info">
        <div class="file-name">${escHtml(f.name)}</div>
        <div class="file-meta">${formatSize(f.size)} · ${f.type || 'Unknown'} · ${storageMode}</div>
      </div>
      <button class="file-remove" title="Remove">✕</button>`;
    d.querySelector('.file-remove').onclick = () => { pendingFiles.splice(i, 1); renderFileList(); };
    wrap.appendChild(d);
  });

  document.getElementById('btnUpload').disabled = false;
}

function clearAll() { pendingFiles = []; renderFileList(); }

// ── Start upload ─────────────────────────────────────────
async function startUpload() {
  if (!pendingFiles.length) { toast('Please add files first', 'error'); return; }

  const note     = document.getElementById('uploaderNote')?.value.trim()              || '';
  const expiry   = parseInt(document.getElementById('expirySelect')?.value            || '86400');
  const dlLimit  = parseInt(document.getElementById('dlLimit')?.value)                 || 0;
  const password = document.getElementById('passwordInput')?.value.trim()             || '';
  const oneTime  = document.getElementById('toggleOneTime')?.querySelector('input')?.checked    || false;
  const autoDel  = document.getElementById('toggleAutoDelete')?.querySelector('input')?.checked || false;
  const wantZip  = document.getElementById('toggleZip')?.querySelector('input')?.checked        || false;

  document.getElementById('uploadSection').classList.add('hidden');
  const ps = document.getElementById('progressSection');
  ps.classList.remove('hidden');
  ps.classList.add('active');

  const pFill = document.getElementById('progressFill');
  const pPct  = document.getElementById('progressPercent');
  const pStat = document.getElementById('progressStats');
  const pLbl  = document.getElementById('progressLabel');

  const total = pendingFiles.reduce((a, f) => a + f.size, 0);
  const t0    = Date.now();
  const uploadedData = [];
  let   done = 0;

  pLbl.textContent = `Processing ${pendingFiles.length} file${pendingFiles.length > 1 ? 's' : ''}…`;

  // Optional ZIP (only for small files — ZIP > 5MB will use external)
  let filesToProcess = pendingFiles;
  if (pendingFiles.length > 1 && wantZip) {
    try {
      toast('Creating ZIP archive…', 'info', 2000);
      const zipBlob = await createZipBlob(pendingFiles);
      filesToProcess = [new File([zipBlob], `dibyashare-${Date.now()}.zip`, { type: 'application/zip' })];
      pLbl.textContent = 'Processing ZIP archive…';
    } catch { toast('ZIP failed, processing individually', 'info'); }
  }

  // Process each file
  for (let idx = 0; idx < filesToProcess.length; idx++) {
    if (uploadPaused) await waitForResume();
    const file = filesToProcess[idx];

    try {
      let fileUrl;

      if (file.size <= BASE64_THRESHOLD) {
        // ── Small file: read as base64, store in Firebase ──
        pLbl.textContent = `Reading "${file.name}"…`;
        const setProgress = (p) => {
          const pct = Math.round(((done + p * file.size) / total) * 100);
          pFill.style.width = pct + '%';
          pPct.textContent  = pct + '%';
          pStat.textContent = `${formatSize(done + p * file.size)} / ${formatSize(total)} · stored in Firebase`;
        };
        setProgress(0);
        fileUrl = await fileToBase64(file);
        setProgress(1);
        pLbl.textContent = `Saving "${file.name}" to Firebase…`;
      } else {
        // ── Large file: upload to external service ──
        pLbl.textContent = `Uploading "${file.name}"…`;
        fileUrl = await uploadFileExternal(file, prog => {
          const pct = Math.round(((done + prog * file.size) / total) * 100);
          const spd = (done + prog * file.size) / ((Date.now() - t0) / 1000);
          pFill.style.width = pct + '%';
          pPct.textContent  = pct + '%';
          pStat.textContent = `${formatSize(done + prog * file.size)} / ${formatSize(total)} · ${formatSize(spd)}/s`;
        });
      }

      uploadedData.push({
        name:    file.name,
        size:    file.size,
        type:    file.type,
        url:     fileUrl,
        storage: file.size <= BASE64_THRESHOLD ? 'firebase' : 'external',
      });
      done += file.size;
    } catch (e) {
      toast(`Failed on "${file.name}": ${e.message}`, 'error');
      resetToUpload(); return;
    }
  }

  // Save metadata + file data to Firebase
  pLbl.textContent  = 'Creating share link…';
  pFill.style.width = '100%';
  pPct.textContent  = '100%';

  try {
    const meta = {
      note, expiry, dlLimit,
      password:        password ? btoa(password) : '',
      oneTime,
      autoDelete:      autoDel,
      files:           uploadedData,
      uploadedAt:      Date.now(),
      expiresAt:       Date.now() + expiry * 1000,
      downloads:       0,
      downloadHistory: [],
      primaryFile:     uploadedData[0],
    };

    const sid = await saveShareMeta(meta);
    meta.id   = sid;

    ps.classList.remove('active');
    ps.classList.add('hidden');
    showSuccess(meta);
  } catch (e) {
    toast('Failed to create share: ' + e.message, 'error');
    resetToUpload();
  }
}

// ── External upload fallback chain ───────────────────────
function uploadFileExternal(file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd  = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    uploadAbortFn = () => xhr.abort();

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        try {
          const r = JSON.parse(xhr.responseText);
          if (r.success && r.link) { resolve(r.link); return; }
        } catch {}
        tryOx0(file, onProgress).then(resolve).catch(reject);
      } else {
        tryOx0(file, onProgress).then(resolve).catch(reject);
      }
    });
    xhr.addEventListener('error',  () => tryOx0(file, onProgress).then(resolve).catch(reject));
    xhr.addEventListener('abort',  () => reject(new Error('Upload cancelled')));
    xhr.open('POST', 'https://file.io/?expires=1d');
    xhr.send(fd);
  });
}

function tryOx0(file, onProgress) {
  return new Promise(resolve => {
    const fd  = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status === 200 && xhr.responseText.startsWith('https')) {
        resolve(xhr.responseText.trim());
      } else {
        tryTmpFiles(file, onProgress).then(resolve);
      }
    });
    xhr.addEventListener('error', () => tryTmpFiles(file, onProgress).then(resolve));
    xhr.open('POST', 'https://0x0.st');
    xhr.send(fd);
  });
}

function tryTmpFiles(file, onProgress) {
  return new Promise(resolve => {
    const fd  = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      try {
        const r = JSON.parse(xhr.responseText);
        if (r.data?.file?.url?.short) { resolve(r.data.file.url.short); return; }
      } catch {}
      toast('⚠️ File >5MB could not be uploaded to external service. Please try a smaller file.', 'error', 6000);
      resolve(null);
    });
    xhr.addEventListener('error', () => {
      toast('⚠️ External upload failed. Use files ≤5MB for best results.', 'error', 6000);
      resolve(null);
    });
    xhr.open('POST', 'https://tmpfiles.org/api/v1/upload');
    xhr.send(fd);
  });
}

async function createZipBlob(files) {
  if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');
  const zip = new JSZip();
  files.forEach(f => zip.file(f.name, f));
  return zip.generateAsync({ type: 'blob' });
}

function togglePause() {
  uploadPaused = !uploadPaused;
  const btn = document.getElementById('btnPause');
  if (btn) btn.textContent = uploadPaused ? '▶ Resume' : '⏸ Pause';
  if (!uploadPaused && pauseResolve) { pauseResolve(); pauseResolve = null; }
  toast(uploadPaused ? 'Paused' : 'Resumed', 'info');
}
function waitForResume() { return new Promise(r => { pauseResolve = r; }); }
function cancelUpload()  { uploadAbortFn?.(); resetToUpload(); toast('Upload cancelled', 'info'); }

function resetToUpload() {
  uploadPaused = false; uploadAbortFn = null;
  document.getElementById('progressSection')?.classList.remove('active');
  document.getElementById('progressSection')?.classList.add('hidden');
  document.getElementById('uploadSection')?.classList.remove('hidden');
}
function resetUpload() {
  pendingFiles = []; renderFileList(); clearCountdown();
  document.getElementById('successPanel')?.classList.remove('active');
  document.getElementById('successPanel')?.classList.add('hidden');
  document.getElementById('uploadCard')?.classList.remove('hidden');
  document.getElementById('uploadSection')?.classList.remove('hidden');
}

// ── Success panel ────────────────────────────────────────
let cdInterval = null;

function showSuccess(meta) {
  const panel = document.getElementById('successPanel');
  if (!panel) return;

  const shareUrl = `${location.origin}/download.html?id=${meta.id}`;

  document.getElementById('shareLink').value = shareUrl;
  document.getElementById('uploadCard')?.classList.add('hidden');
  panel.classList.remove('hidden');
  panel.classList.add('active');

  const f = meta.primaryFile;
  document.getElementById('infoFileName').textContent   = f.name;
  document.getElementById('infoFileSize').textContent   = formatSize(f.size);
  document.getElementById('infoFileType').textContent   = f.type || 'Unknown';
  document.getElementById('infoUploadTime').textContent = new Date(meta.uploadedAt).toLocaleTimeString();
  document.getElementById('infoExpiry').textContent     = new Date(meta.expiresAt).toLocaleString();
  document.getElementById('infoDlLimit').textContent    = meta.dlLimit > 0 ? meta.dlLimit : '∞';
  document.getElementById('infoShareId').textContent    = meta.id;

  generateQR(shareUrl);

  const msg = `Download "${f.name}" via DibyaShare`;
  document.getElementById('btnShareEmail').href =
    `mailto:?subject=${encodeURIComponent(msg)}&body=${encodeURIComponent(shareUrl)}`;
  document.getElementById('btnShareWA').href =
    `https://wa.me/?text=${encodeURIComponent(msg + '\n' + shareUrl)}`;
  document.getElementById('btnShareTG').href =
    `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(msg)}`;

  startCountdown(meta.expiresAt);
}

function startCountdown(expiresAt) {
  clearInterval(cdInterval);
  const el = document.getElementById('countdownDisplay');
  const tick = () => {
    if (!el) return;
    const d = expiresAt - Date.now();
    el.textContent = d > 0 ? formatTime(d) : 'Expired';
    if (d <= 0) clearInterval(cdInterval);
  };
  tick();
  cdInterval = setInterval(tick, 1000);
}
function clearCountdown() { clearInterval(cdInterval); }

function copyLink() {
  const inp = document.getElementById('shareLink');
  navigator.clipboard.writeText(inp.value).then(() => {
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
    el.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=128x128&data=${encodeURIComponent(url)}&color=7c6aff" alt="QR" style="border-radius:8px;">`;
  }
}

// ── Download page ─────────────────────────────────────────
function initDownloadPage() {
  initTheme();
  checkRulesExpiry();
  document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

  const params = new URLSearchParams(location.search);
  const sid    = params.get('id');
  if (!sid) { showError('No file ID in URL.'); return; }
  loadDownloadPage(sid);
}

async function loadDownloadPage(sid) {
  try {
    const meta = await getShareMeta(sid);
    if (!meta)                                              { showError('File not found or already deleted.'); return; }
    if (Date.now() > meta.expiresAt)                        { showExpired(); return; }
    if (meta.dlLimit > 0 && meta.downloads >= meta.dlLimit) { showError('Download limit reached.'); return; }
    if (meta.password)                                      { showPasswordGate(meta, sid); return; }
    renderDownloadPage(meta, sid);
  } catch (e) {
    showError('Could not load file info — ' + e.message);
  }
}

function showPasswordGate(meta, sid) {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('passwordGate').classList.remove('hidden');
  const inp = document.getElementById('passwordInput');
  const btn = document.getElementById('btnUnlock');
  btn.addEventListener('click', () => {
    if (btoa(inp.value) === meta.password) {
      document.getElementById('passwordGate').classList.add('hidden');
      renderDownloadPage(meta, sid);
    } else {
      inp.style.borderColor = 'var(--red)';
      toast('Wrong password', 'error');
      setTimeout(() => inp.style.borderColor = '', 1500);
    }
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
}

function renderDownloadPage(meta, sid) {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('downloadPage').classList.remove('hidden');

  const f = meta.primaryFile;
  document.getElementById('dlFileName').textContent     = f.name;
  document.getElementById('dlFileIcon').textContent     = getFileIcon(f.type);
  document.getElementById('dlFileMeta').textContent     = `${formatSize(f.size)} · ${f.type || 'Unknown'}`;
  document.getElementById('dlShareIdBadge').textContent = sid;
  document.getElementById('dlCount').textContent        = meta.downloads || 0;
  document.getElementById('dlLimit2').textContent       = meta.dlLimit > 0 ? meta.dlLimit : '∞';

  const last = (meta.downloadHistory || []).slice(-1)[0];
  document.getElementById('dlLastTime').textContent = last ? new Date(last.time).toLocaleString() : 'Never';

  if (meta.note) {
    document.getElementById('uploaderNote').classList.remove('hidden');
    document.getElementById('noteText').textContent = meta.note;
  }

  // Live expiry bar
  function updateExpiry() {
    const diff = meta.expiresAt - Date.now();
    document.getElementById('dlExpiry').textContent   = diff > 0 ? formatTime(diff) : 'Expired';
    document.getElementById('expiryFill').style.width =
      Math.max(0, Math.min(100, (diff / (meta.expiry * 1000)) * 100)) + '%';
  }
  updateExpiry();
  setInterval(updateExpiry, 1000);

  renderPreview(f);
  renderHistory(meta);

  document.getElementById('btnDownload').addEventListener('click', e => {
    e.preventDefault();
    doDownload(meta, sid, f);
  });

  // Share buttons
  const url = location.href;
  const msg = 'Check out this shared file on DibyaShare';
  document.getElementById('dlShareWA')?.setAttribute('href', `https://wa.me/?text=${encodeURIComponent(msg + '\n' + url)}`);
  document.getElementById('dlShareTG')?.setAttribute('href', `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(msg)}`);
}

function renderPreview(f) {
  const sec = document.getElementById('previewSection');
  if (!sec) return;
  sec.innerHTML = '';
  const u = f.url;
  if (!u) { sec.classList.add('hidden'); return; }

  if (f.type?.startsWith('image/')) {
    sec.innerHTML = `<img src="${u}" alt="${escHtml(f.name)}" style="max-height:320px;object-fit:contain;width:100%;">`;
  } else if (f.type?.startsWith('video/')) {
    sec.innerHTML = `<video controls style="width:100%;max-height:320px;"><source src="${u}" type="${f.type}"></video>`;
  } else if (f.type?.startsWith('audio/')) {
    sec.innerHTML = `<audio controls style="width:100%;padding:16px;"><source src="${u}" type="${f.type}"></audio>`;
  } else if (f.type === 'application/pdf') {
    sec.innerHTML = `<iframe src="${u}" style="width:100%;height:380px;border:none;"></iframe>`;
  } else {
    sec.classList.add('hidden'); return;
  }
  sec.classList.remove('hidden');
}

// ── base64 data URL → Blob ───────────────────────────────
function dataURLtoBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ── Universal download — works on mobile Chrome ──────────
// Strategy:
//   1. Build a Blob from the file data
//   2. Open a new tab showing a minimal HTML page with the file embedded
//   3. The new page auto-triggers download AND shows the file inline
//      so the user can long-press → Save / Share on mobile
function triggerDownload(fileUrl, fileName, fileMime) {
  if (fileUrl.startsWith('data:')) {
    // Convert base64 → Blob → Object URL
    const blob      = dataURLtoBlob(fileUrl);
    const objectUrl = URL.createObjectURL(blob);
    openDownloadTab(objectUrl, fileName, fileMime, true);
  } else {
    // External URL — open directly
    openDownloadTab(fileUrl, fileName, fileMime, false);
  }
}

function openDownloadTab(url, fileName, fileMime, isBlob) {
  // Build a self-contained HTML page that:
  //   • Shows the file inline (image/video/audio/pdf/text)
  //   • Has a big "Save File" button
  //   • Auto-clicks download on desktop
  const isImage  = fileMime?.startsWith('image/');
  const isVideo  = fileMime?.startsWith('video/');
  const isAudio  = fileMime?.startsWith('audio/');
  const isPdf    = fileMime === 'application/pdf';
  const isText   = fileMime?.startsWith('text/');

  let previewHtml = '';
  if (isImage)  previewHtml = `<img src="${url}" style="max-width:100%;max-height:60vh;border-radius:12px;display:block;margin:0 auto 20px;">`;
  else if (isVideo) previewHtml = `<video src="${url}" controls style="max-width:100%;max-height:60vh;border-radius:12px;display:block;margin:0 auto 20px;"></video>`;
  else if (isAudio) previewHtml = `<audio src="${url}" controls style="width:100%;margin-bottom:20px;"></audio>`;
  else if (isPdf)   previewHtml = `<iframe src="${url}" style="width:100%;height:60vh;border:none;border-radius:12px;margin-bottom:20px;"></iframe>`;
  else previewHtml = `<div style="background:#1a1a2e;border-radius:12px;padding:24px;margin-bottom:20px;font-size:48px;text-align:center;">📄</div>`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Download — ${fileName}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0a0a0f;color:#f0f0f8;font-family:system-ui,sans-serif;
         min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#18181f;border:1px solid #2e2e3e;border-radius:20px;
          padding:28px;max-width:520px;width:100%;text-align:center}
    h2{font-size:1.1rem;font-weight:700;margin-bottom:6px;word-break:break-all}
    p{color:#a8a8c0;font-size:.85rem;margin-bottom:20px}
    .btn{display:inline-flex;align-items:center;gap:8px;padding:14px 32px;
         background:linear-gradient(135deg,#7c6aff,#a855f7);color:#fff;
         border:none;border-radius:12px;font-size:1rem;font-weight:700;
         cursor:pointer;text-decoration:none;width:100%;justify-content:center;margin-bottom:12px}
    .hint{font-size:.78rem;color:#6a6a88;line-height:1.5}
  </style>
</head>
<body>
<div class="card">
  <div style="font-size:2.5rem;margin-bottom:12px">⬇️</div>
  <h2>${fileName}</h2>
  <p>DibyaShare — tap the button below to save</p>
  ${previewHtml}
  <a class="btn" href="${url}" download="${fileName}" id="dlBtn">⬇&nbsp;&nbsp;Save File</a>
  <p class="hint">On mobile: tap & hold the button → "Download link" or "Save"<br>
  Or long-press the preview above → "Save image/video"</p>
</div>
<script>
  // Auto-click on desktop
  setTimeout(() => document.getElementById('dlBtn').click(), 500);
</script>
</body>
</html>`;

  // Write into a new tab
  const tab = window.open('', '_blank');
  if (tab) {
    tab.document.write(html);
    tab.document.close();
    if (isBlob) {
      // Revoke blob URL when tab closes (best-effort)
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } else {
    // Popup blocked — fallback: navigate current tab
    if (isBlob) {
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
    } else {
      window.location.href = url;
    }
  }
}

async function doDownload(meta, sid, f) {
  const btn = document.getElementById('btnDownload');
  btn.disabled    = true;
  btn.textContent = '⬇ Preparing…';

  // Country detection (best-effort, short timeout)
  let country = 'Unknown';
  try {
    const r = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(2000) });
    const d = await r.json();
    country = d.country_name || 'Unknown';
  } catch {}

  const history = [...(meta.downloadHistory || []), { time: Date.now(), country }];
  const newDl   = (meta.downloads || 0) + 1;

  try { await updateShareMeta(sid, { downloads: newDl, downloadHistory: history }); } catch {}

  document.getElementById('dlCount').textContent    = newDl;
  document.getElementById('dlLastTime').textContent = new Date().toLocaleString();
  meta.downloadHistory = history;
  meta.downloads       = newDl;
  renderHistory(meta);

  // Trigger download
  if (f.url) {
    triggerDownload(f.url, f.name, f.type);
    toast('Opening download tab… 📥', 'success');
  } else {
    toast('File URL not available', 'error');
  }

  if (meta.oneTime) {
    try { await updateShareMeta(sid, { dlLimit: 1, downloads: 1 }); } catch {}
    toast('One-time link — now expired.', 'info', 5000);
    setTimeout(() => { btn.textContent = '⛔ Already downloaded'; }, 600);
    return;
  }
  if (meta.autoDelete) {
    try { await updateShareMeta(sid, { expiresAt: Date.now() - 1 }); } catch {}
    toast('File auto-deleted after download.', 'info', 4000);
  }

  setTimeout(() => { btn.disabled = false; btn.innerHTML = '⬇&nbsp;&nbsp;Download Again'; }, 2500);
}

function renderHistory(meta) {
  const wrap = document.getElementById('historyList');
  if (!wrap) return;
  const h = meta.downloadHistory || [];
  if (!h.length) {
    wrap.innerHTML = '<div style="color:var(--text-3);font-size:.82rem;">No downloads yet</div>';
    return;
  }
  wrap.innerHTML = h.slice(-5).reverse().map(x => `
    <div class="history-item">
      <span>🌍</span><span>${escHtml(x.country)}</span>
      <span style="margin-left:auto;color:var(--text-3)">${new Date(x.time).toLocaleString()}</span>
    </div>`).join('');
}

function showExpired() {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('expiredState').classList.remove('hidden');
}
function showError(msg) {
  document.getElementById('loadingState').classList.add('hidden');
  const el = document.getElementById('errorState');
  if (el) {
    el.classList.remove('hidden');
    const m = document.getElementById('errorMsg');
    if (m) m.textContent = msg;
  }
}

// ── Expose globals ───────────────────────────────────────
window.initUploadPage   = initUploadPage;
window.initDownloadPage = initDownloadPage;
window.copyLink         = copyLink;
window.clearAll         = clearAll;
window.toggleTheme      = toggleTheme;
window.toast            = toast;

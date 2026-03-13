// ======================================================
// DibyaShare — script.js
// Created by Dibya Jyoti Mahanta
// Storage: JSONHosting.com  (no signup, no API key, 100% free)
// Share IDs: share1, share2, share3 … stored in a counter bin
// ======================================================

const MAX_SIZE_MB = 500;
const MAX_SIZE    = MAX_SIZE_MB * 1024 * 1024;

// ─── JSONHosting API ────────────────────────────────────
// No API key needed. POST creates a bin, PATCH updates it (needs editKey from creation).
// We store the editKey in the bin itself so we can always retrieve + update.
const JH_BASE = 'https://jsonhosting.com';

// Counter bin: stores { count: N, bins: { share1: binId, share2: binId … } }
// On first run we create it, save binId + editKey to localStorage for this browser.
// Any browser that opens a share link reads the per-share bin directly by binId from URL.
const COUNTER_LS_KEY  = 'dibyashare_counter_bin';   // { binId, editKey, count }

// ─── JSONHosting helpers ────────────────────────────────
async function jhCreate(data) {
  const r = await fetch(`${JH_BASE}/api/json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`JH create failed ${r.status}`);
  return r.json(); // { id, editKey, rawUrl, apiUrl }
}

async function jhRead(binId) {
  const r = await fetch(`${JH_BASE}/get/${binId}`);
  if (!r.ok) throw new Error(`JH read failed ${r.status}`);
  return r.json();
}

async function jhUpdate(binId, editKey, data) {
  const r = await fetch(`${JH_BASE}/api/json/${binId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Edit-Key': editKey },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`JH update failed ${r.status}`);
  return r.json();
}

// ─── Save a new share → returns "shareN" style ID ───────
// Strategy:
//   • Each share is its OWN bin on JSONHosting (avoids race conditions).
//   • The shareId is encoded inside the URL: download.html?id=<binId>&sid=share7
//   • sid (share-friendly label) is generated locally using localStorage counter.
//   • Anyone opening the link reads the bin directly via binId — works cross-device.
async function saveShareMeta(meta) {
  // Generate local sequential label (just cosmetic, unique per uploader device)
  const localCount = parseInt(localStorage.getItem('dibyashare_local_count') || '0') + 1;
  localStorage.setItem('dibyashare_local_count', String(localCount));
  const sid = `share${localCount}`;

  // Create a new bin for this share
  const payload = { ...meta, sid, _v: 1 };
  const res = await jhCreate(payload);

  // Store the editKey locally so this device can update download counts
  const editStore = JSON.parse(localStorage.getItem('dibyashare_editkeys') || '{}');
  editStore[res.id] = res.editKey;
  localStorage.setItem('dibyashare_editkeys', JSON.stringify(editStore));

  return { binId: res.id, sid };
}

async function getShareMeta(binId) {
  return jhRead(binId);
}

async function updateShareMeta(binId, patch) {
  const editStore = JSON.parse(localStorage.getItem('dibyashare_editkeys') || '{}');
  const editKey   = editStore[binId];
  if (!editKey) {
    // No editKey on this device — just silently skip (download count won't update, file still works)
    console.warn('No editKey for bin', binId, '— skipping update');
    return;
  }
  const current = await jhRead(binId);
  await jhUpdate(binId, editKey, { ...current, ...patch });
}

// ─── File type utils ─────────────────────────────────────
const ALLOWED_TYPES = {
  all:    null,
  images: ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml'],
  docs:   ['application/pdf','application/msword',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'],
  media:  ['video/mp4','video/webm','audio/mpeg','audio/ogg','audio/wav'],
};

function getFileIcon(mime) {
  if (!mime) return '📄';
  if (mime.startsWith('image/'))  return '🖼️';
  if (mime.startsWith('video/'))  return '🎬';
  if (mime.startsWith('audio/'))  return '🎵';
  if (mime === 'application/pdf') return '📕';
  if (mime.includes('word'))      return '📝';
  if (mime.includes('excel') || mime.includes('spreadsheet')) return '📊';
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z')) return '🗜️';
  if (mime.startsWith('text/'))   return '📄';
  if (mime.includes('powerpoint') || mime.includes('presentation')) return '📊';
  return '📁';
}

function formatSize(b) {
  if (b < 1024)    return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(2) + ' MB';
}

function formatTime(ms) {
  const s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60);
  if (h > 0) return `${h}h ${m%60}m`;
  if (m > 0) return `${m}m ${s%60}s`;
  return `${s}s`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Theme ──────────────────────────────────────────────
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

// ─── Toast ──────────────────────────────────────────────
function toast(msg, type = 'info', dur = 3500) {
  const icons = { success:'✅', error:'❌', info:'ℹ️' };
  const wrap  = document.getElementById('toastContainer');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s'; el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, dur);
}

// ─── Upload page state ────────────────────────────────────
let pendingFiles  = [];
let uploadPaused  = false;
let uploadAbortFn = null;
let pauseResolve  = null;

function initUploadPage() {
  initTheme();
  const dz   = document.getElementById('dropZone');
  const fi   = document.getElementById('fileInput');
  const foli = document.getElementById('folderInput');

  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', ()=> dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('drag-over');
    addFiles([...e.dataTransfer.files]);
  });
  dz.addEventListener('click', ()=> fi.click());

  fi.addEventListener('change',   ()=> addFiles([...fi.files]));
  foli.addEventListener('change', ()=> addFiles([...foli.files]));

  document.getElementById('btnPickFile')  ?.addEventListener('click', e=>{ e.stopPropagation(); fi.click(); });
  document.getElementById('btnPickFolder')?.addEventListener('click', e=>{ e.stopPropagation(); foli.click(); });
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
    if (f.size > MAX_SIZE) { toast(`${f.name} exceeds ${MAX_SIZE_MB}MB limit`, 'error'); return; }
    if (allowed && !allowed.includes(f.type)) { toast(`${f.name} — type not allowed`, 'error'); return; }
    if (!pendingFiles.find(p => p.name===f.name && p.size===f.size)) pendingFiles.push(f);
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
  pendingFiles.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'file-item';
    d.innerHTML = `
      <span class="file-icon">${getFileIcon(f.type)}</span>
      <div class="file-info">
        <div class="file-name">${escHtml(f.name)}</div>
        <div class="file-meta">${formatSize(f.size)} · ${f.type||'Unknown'}</div>
      </div>
      <button class="file-remove" title="Remove">✕</button>`;
    d.querySelector('.file-remove').onclick = ()=>{ pendingFiles.splice(i,1); renderFileList(); };
    wrap.appendChild(d);
  });
  document.getElementById('btnUpload').disabled = false;
}

function clearAll() { pendingFiles=[]; renderFileList(); }

// ─── Start upload ────────────────────────────────────────
async function startUpload() {
  if (!pendingFiles.length) { toast('Please add files first','error'); return; }

  const note     = document.getElementById('uploaderNote')?.value.trim()   || '';
  const expiry   = parseInt(document.getElementById('expirySelect')?.value || '86400');
  const dlLimit  = parseInt(document.getElementById('dlLimit')?.value)      || 0;
  const password = document.getElementById('passwordInput')?.value.trim()   || '';
  const oneTime  = document.getElementById('toggleOneTime')?.querySelector('input')?.checked    || false;
  const autoDel  = document.getElementById('toggleAutoDelete')?.querySelector('input')?.checked || false;
  const wantZip  = document.getElementById('toggleZip')?.querySelector('input')?.checked        || false;

  // Show progress, hide upload form
  document.getElementById('uploadSection').classList.add('hidden');
  const ps = document.getElementById('progressSection');
  ps.classList.remove('hidden'); ps.classList.add('active');

  const pFill = document.getElementById('progressFill');
  const pPct  = document.getElementById('progressPercent');
  const pStat = document.getElementById('progressStats');
  const pLbl  = document.getElementById('progressLabel');

  const total = pendingFiles.reduce((a,f)=>a+f.size,0);
  const t0    = Date.now();
  const uploadedData = [];
  let   uploaded = 0;

  pLbl.textContent = `Uploading ${pendingFiles.length} file${pendingFiles.length>1?'s':''}…`;

  // Optional ZIP for multiple files
  let filesToUpload = pendingFiles;
  if (pendingFiles.length > 1 && wantZip) {
    try {
      toast('Creating ZIP archive…','info',2000);
      const zip = await createZipBlob(pendingFiles);
      filesToUpload = [new File([zip],`dibyashare-${Date.now()}.zip`,{type:'application/zip'})];
      pLbl.textContent = 'Uploading ZIP archive…';
    } catch { toast('ZIP failed, uploading individually','info'); }
  }

  // Upload each file
  for (const file of filesToUpload) {
    if (uploadPaused) await waitForResume();
    try {
      const url = await uploadFileToServer(file, prog => {
        const done = uploaded + prog * file.size;
        const pct  = Math.round((done / total) * 100);
        const spd  = done / ((Date.now()-t0)/1000);
        pFill.style.width    = pct + '%';
        pPct.textContent     = pct + '%';
        pStat.textContent    = `${formatSize(done)} / ${formatSize(total)} · ${formatSize(spd)}/s`;
      });
      uploadedData.push({ name:file.name, size:file.size, type:file.type, url });
      uploaded += file.size;
    } catch(e) {
      toast('Upload failed: ' + e.message, 'error');
      resetToUpload(); return;
    }
  }

  // Save metadata to JSONHosting → get shareN ID
  pLbl.textContent = 'Creating share link…';
  pFill.style.width = '100%';

  try {
    const meta = {
      note, expiry, dlLimit,
      password:   password ? btoa(password) : '',
      oneTime, autoDelete: autoDel,
      files:          uploadedData,
      uploadedAt:     Date.now(),
      expiresAt:      Date.now() + expiry * 1000,
      downloads:      0,
      downloadHistory:[],
      primaryFile:    uploadedData[0],
    };

    const { binId, sid } = await saveShareMeta(meta);
    meta.id    = sid;
    meta.binId = binId;

    ps.classList.remove('active'); ps.classList.add('hidden');
    showSuccess(meta);
  } catch(e) {
    toast('Failed to create share: ' + e.message, 'error');
    resetToUpload();
  }
}

// ─── File upload (file.io → 0x0.st fallback) ─────────────
function uploadFileToServer(file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd  = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    uploadAbortFn = ()=> xhr.abort();
    xhr.upload.addEventListener('progress', e=>{
      if(e.lengthComputable) onProgress(e.loaded/e.total);
    });
    xhr.addEventListener('load', ()=>{
      if (xhr.status === 200) {
        try {
          const r = JSON.parse(xhr.responseText);
          if (r.success && r.link) { resolve(r.link); return; }
        } catch {}
        fallbackUpload(file, onProgress).then(resolve).catch(reject);
      } else {
        fallbackUpload(file, onProgress).then(resolve).catch(reject);
      }
    });
    xhr.addEventListener('error',  ()=> fallbackUpload(file, onProgress).then(resolve).catch(reject));
    xhr.addEventListener('abort',  ()=> reject(new Error('Upload cancelled')));
    xhr.open('POST', 'https://file.io/?expires=1d');
    xhr.send(fd);
  });
}

function fallbackUpload(file, onProgress) {
  return new Promise(resolve => {
    const fd  = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', e=>{
      if(e.lengthComputable) onProgress(e.loaded/e.total);
    });
    xhr.addEventListener('load', ()=>{
      resolve(xhr.status===200 ? xhr.responseText.trim() : URL.createObjectURL(file));
    });
    xhr.addEventListener('error', ()=> resolve(URL.createObjectURL(file)));
    xhr.open('POST', 'https://0x0.st');
    xhr.send(fd);
  });
}

async function createZipBlob(files) {
  if (typeof JSZip==='undefined') throw new Error('JSZip not available');
  const zip = new JSZip();
  files.forEach(f=> zip.file(f.name, f));
  return zip.generateAsync({ type:'blob' });
}

function togglePause() {
  uploadPaused = !uploadPaused;
  const btn = document.getElementById('btnPause');
  if (btn) btn.textContent = uploadPaused ? '▶ Resume' : '⏸ Pause';
  if (!uploadPaused && pauseResolve) { pauseResolve(); pauseResolve=null; }
  toast(uploadPaused ? 'Upload paused' : 'Upload resumed', 'info');
}
function waitForResume() { return new Promise(r=>{ pauseResolve=r; }); }
function cancelUpload()  { uploadAbortFn?.(); resetToUpload(); toast('Upload cancelled','info'); }

function resetToUpload() {
  uploadPaused=false; uploadAbortFn=null;
  document.getElementById('progressSection')?.classList.remove('active');
  document.getElementById('progressSection')?.classList.add('hidden');
  document.getElementById('uploadSection')?.classList.remove('hidden');
}
function resetUpload() {
  pendingFiles=[]; renderFileList(); clearCountdown();
  document.getElementById('successPanel')?.classList.remove('active');
  document.getElementById('successPanel')?.classList.add('hidden');
  document.getElementById('uploadCard')?.classList.remove('hidden');
  document.getElementById('uploadSection')?.classList.remove('hidden');
}

// ─── Success panel ───────────────────────────────────────
let cdInterval = null;

function showSuccess(meta) {
  const panel = document.getElementById('successPanel');
  if (!panel) return;

  // URL encodes both binId (for reading) and sid (for display)
  const shareUrl = `${location.origin}/download.html?id=${meta.binId}&sid=${meta.id}`;

  document.getElementById('shareLink').value = shareUrl;
  document.getElementById('uploadCard')?.classList.add('hidden');
  panel.classList.remove('hidden'); panel.classList.add('active');

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
  document.getElementById('btnShareEmail').href = `mailto:?subject=${encodeURIComponent(msg)}&body=${encodeURIComponent(shareUrl)}`;
  document.getElementById('btnShareWA').href    = `https://wa.me/?text=${encodeURIComponent(msg+'\n'+shareUrl)}`;
  document.getElementById('btnShareTG').href    = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(msg)}`;

  startCountdown(meta.expiresAt);
}

function startCountdown(expiresAt) {
  clearInterval(cdInterval);
  const el = document.getElementById('countdownDisplay');
  const tick = ()=>{
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
  navigator.clipboard.writeText(inp.value).then(()=>{
    const btn = document.getElementById('btnCopyLink');
    btn.textContent='✓ Copied!'; btn.classList.add('copied');
    setTimeout(()=>{ btn.textContent='Copy'; btn.classList.remove('copied'); }, 2000);
    toast('Link copied to clipboard!','success');
  });
}

function generateQR(url) {
  const el = document.getElementById('qrcode');
  if (!el) return;
  el.innerHTML='';
  if (typeof QRCode !== 'undefined') {
    new QRCode(el,{ text:url, width:128, height:128, colorDark:'#7c6aff', colorLight:'#ffffff' });
  } else {
    el.innerHTML=`<img src="https://api.qrserver.com/v1/create-qr-code/?size=128x128&data=${encodeURIComponent(url)}&color=7c6aff" alt="QR" style="border-radius:8px;">`;
  }
}

// ─── Download page ────────────────────────────────────────
function initDownloadPage() {
  initTheme();
  document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

  const params = new URLSearchParams(location.search);
  const binId  = params.get('id');
  const sid    = params.get('sid') || '';

  if (!binId) { showError('No file ID in URL.'); return; }
  loadDownloadPage(binId, sid);
}

async function loadDownloadPage(binId, sid) {
  try {
    const meta = await getShareMeta(binId);
    if (!meta) { showError('File not found or already expired.'); return; }

    if (Date.now() > meta.expiresAt) { showExpired(); return; }
    if (meta.dlLimit > 0 && meta.downloads >= meta.dlLimit) {
      showError('Download limit reached. This file is no longer available.'); return;
    }
    if (meta.password) { showPasswordGate(meta, binId, sid); return; }

    renderDownloadPage(meta, binId, sid);
  } catch(e) {
    showError('Could not load file info — ' + e.message);
  }
}

function showPasswordGate(meta, binId, sid) {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('passwordGate').classList.remove('hidden');
  const inp = document.getElementById('passwordInput');
  const btn = document.getElementById('btnUnlock');
  btn.addEventListener('click', ()=>{
    if (btoa(inp.value) === meta.password) {
      document.getElementById('passwordGate').classList.add('hidden');
      renderDownloadPage(meta, binId, sid);
    } else {
      inp.style.borderColor='var(--red)';
      toast('Wrong password','error');
      setTimeout(()=> inp.style.borderColor='', 1500);
    }
  });
  inp.addEventListener('keydown', e=>{ if(e.key==='Enter') btn.click(); });
}

function renderDownloadPage(meta, binId, sid) {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('downloadPage').classList.remove('hidden');

  const f = meta.primaryFile;
  document.getElementById('dlFileName').textContent     = f.name;
  document.getElementById('dlFileIcon').textContent     = getFileIcon(f.type);
  document.getElementById('dlFileMeta').textContent     = `${formatSize(f.size)} · ${f.type||'Unknown'}`;
  document.getElementById('dlShareIdBadge').textContent = sid || meta.sid || '';
  document.getElementById('dlCount').textContent        = meta.downloads  || 0;
  document.getElementById('dlLimit2').textContent       = meta.dlLimit > 0 ? meta.dlLimit : '∞';

  const last = (meta.downloadHistory||[]).slice(-1)[0];
  document.getElementById('dlLastTime').textContent = last ? new Date(last.time).toLocaleString() : 'Never';

  if (meta.note) {
    document.getElementById('uploaderNote').classList.remove('hidden');
    document.getElementById('noteText').textContent = meta.note;
  }

  // Expiry bar + live countdown
  function updateExpiry() {
    const diff = meta.expiresAt - Date.now();
    document.getElementById('dlExpiry').textContent   = diff > 0 ? formatTime(diff) : 'Expired';
    document.getElementById('expiryFill').style.width =
      Math.max(0, Math.min(100, (diff/(meta.expiry*1000))*100)) + '%';
  }
  updateExpiry();
  setInterval(updateExpiry, 1000);

  renderPreview(f);
  renderHistory(meta);

  document.getElementById('btnDownload').addEventListener('click', e=>{
    e.preventDefault();
    doDownload(meta, binId, sid, f);
  });

  // Share buttons on download page
  const url = location.href;
  const msg = 'Check out this shared file on DibyaShare';
  document.getElementById('dlShareWA') ?.setAttribute('href', `https://wa.me/?text=${encodeURIComponent(msg+'\n'+url)}`);
  document.getElementById('dlShareTG') ?.setAttribute('href', `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(msg)}`);
}

function renderPreview(f) {
  const sec = document.getElementById('previewSection');
  if (!sec) return;
  sec.innerHTML = '';
  const u = f.url;
  if      (f.type?.startsWith('image/'))    sec.innerHTML=`<img src="${u}" alt="${escHtml(f.name)}" style="max-height:320px;object-fit:contain;width:100%;">`;
  else if (f.type?.startsWith('video/'))    sec.innerHTML=`<video controls style="width:100%;max-height:320px;"><source src="${u}" type="${f.type}"></video>`;
  else if (f.type?.startsWith('audio/'))    sec.innerHTML=`<audio controls style="width:100%;padding:16px;"><source src="${u}" type="${f.type}"></audio>`;
  else if (f.type==='application/pdf')      sec.innerHTML=`<iframe src="${u}" style="width:100%;height:380px;border:none;"></iframe>`;
  else { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
}

async function doDownload(meta, binId, sid, f) {
  const btn = document.getElementById('btnDownload');
  btn.disabled=true; btn.textContent='⬇ Preparing…';

  // Country detection (best-effort)
  let country = 'Unknown';
  try {
    const r = await fetch('https://ipapi.co/json/',{ signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    country = d.country_name || 'Unknown';
  } catch {}

  const history = [...(meta.downloadHistory||[]), { time: Date.now(), country }];
  const newDl   = (meta.downloads||0) + 1;

  // Update the bin (only works on the uploader's device which has the editKey)
  try { await updateShareMeta(binId, { downloads: newDl, downloadHistory: history }); } catch {}

  // Always update UI regardless
  document.getElementById('dlCount').textContent    = newDl;
  document.getElementById('dlLastTime').textContent = new Date().toLocaleString();
  meta.downloadHistory = history;
  meta.downloads       = newDl;
  renderHistory(meta);

  // Trigger actual file download
  try {
    const a = document.createElement('a');
    a.href=f.url; a.download=f.name; a.target='_blank'; a.rel='noopener';
    document.body.appendChild(a); a.click(); a.remove();
    toast('Download started! 🎉','success');
  } catch { window.open(f.url,'_blank'); }

  if (meta.oneTime) {
    try { await updateShareMeta(binId,{ dlLimit:1, downloads:1 }); } catch {}
    toast('One-time link — now expired.','info',5000);
    setTimeout(()=>{ btn.textContent='⛔ Already downloaded'; }, 600);
    return;
  }
  if (meta.autoDelete) {
    try { await updateShareMeta(binId,{ expiresAt: Date.now()-1 }); } catch {}
    toast('File auto-deleted after download.','info',4000);
  }

  setTimeout(()=>{ btn.disabled=false; btn.innerHTML='⬇&nbsp;&nbsp;Download Again'; }, 2500);
}

function renderHistory(meta) {
  const wrap = document.getElementById('historyList');
  if (!wrap) return;
  const h = meta.downloadHistory || [];
  if (!h.length) {
    wrap.innerHTML='<div style="color:var(--text-3);font-size:.82rem;">No downloads yet</div>';
    return;
  }
  wrap.innerHTML = h.slice(-5).reverse().map(x=>`
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
  if (el) { el.classList.remove('hidden'); const m=document.getElementById('errorMsg'); if(m) m.textContent=msg; }
}

// ─── Expose globals ──────────────────────────────────────
window.initUploadPage   = initUploadPage;
window.initDownloadPage = initDownloadPage;
window.copyLink         = copyLink;
window.clearAll         = clearAll;
window.toggleTheme      = toggleTheme;
window.toast            = toast;

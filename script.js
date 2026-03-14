// ======================================================
// DibyaShare — script.js
// Created by Dibya Jyoti Mahanta
// Firebase Realtime Database · share1/share2/share3 IDs
// ======================================================

const FB_URL          = 'https://share-b5188-default-rtdb.firebaseio.com';
const RULES_EXPIRY_MS = 1775930400000; // 2026-04-12
const BASE64_LIMIT    = 7 * 1024 * 1024; // 7 MB → ~9.3 MB base64 (safe < 10MB)
const MAX_SIZE_MB     = 10;
const MAX_SIZE        = MAX_SIZE_MB * 1024 * 1024;

// ── Expiry check ─────────────────────────────────────────
function checkRulesExpiry() {
  const diff = RULES_EXPIRY_MS - Date.now();
  if (diff < 0)
    setTimeout(() => toast('⚠️ Firebase rules expired! Update at Firebase Console.', 'error', 12000), 1000);
  else if (diff < 7 * 86400000)
    setTimeout(() => toast(`⚠️ Firebase rules expire in ${Math.ceil(diff/86400000)} days!`, 'info', 8000), 1000);
}

// ── Firebase helpers ──────────────────────────────────────
const fbRef = p => `${FB_URL}/${p}.json`;

async function fbGet(path) {
  const r = await fetch(fbRef(path));
  if (!r.ok) throw new Error('DB read ' + r.status);
  return r.json();
}
async function fbSet(path, data) {
  const r = await fetch(fbRef(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error('DB write ' + r.status);
  return r.json();
}
async function fbPatch(path, data) {
  const r = await fetch(fbRef(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error('DB patch ' + r.status);
  return r.json();
}

// ── Counter → shareN ──────────────────────────────────────
async function getNextSid() {
  for (let i = 0; i < 5; i++) {
    try {
      const n = ((await fbGet('counter')) || 0) + 1;
      await fbSet('counter', n);
      return 'share' + n;
    } catch (e) {
      if (i === 4) throw e;
      await sleep(400 * (i + 1));
    }
  }
}

// ── Save share ────────────────────────────────────────────
// File data (base64) stored at  filedata/{sid}/{fileIndex}
// Metadata stored at            shares/{sid}  (no blobs)
async function saveShare(meta) {
  const sid = await getNextSid();

  // Separate file blobs from metadata
  const fileRefs = [];
  for (let i = 0; i < meta.files.length; i++) {
    const f = meta.files[i];
    if (f.storage === 'firebase' && f.url?.startsWith('data:')) {
      await fbSet(`filedata/${sid}/${i}`, { data: f.url, name: f.name, type: f.type, size: f.size });
      fileRefs.push({ name: f.name, type: f.type, size: f.size, storage: 'firebase', ref: i });
    } else {
      fileRefs.push({ name: f.name, type: f.type, size: f.size, storage: 'external', url: f.url });
    }
  }

  const shareMeta = {
    ...meta,
    id: sid,
    files: fileRefs,
    primaryRef: 0, // index of primary file in fileRefs
  };
  delete shareMeta.primaryFile; // don't store blob in meta

  await fbSet(`shares/${sid}`, shareMeta);
  return sid;
}

// ── Load share ────────────────────────────────────────────
async function loadShare(sid) {
  const meta = await fbGet(`shares/${sid}`);
  if (!meta) return null;

  // Re-attach file data
  const files = [];
  for (let i = 0; i < (meta.files || []).length; i++) {
    const ref = meta.files[i];
    if (ref.storage === 'firebase') {
      const fd = await fbGet(`filedata/${sid}/${ref.ref ?? i}`);
      files.push({ name: ref.name, type: ref.type, size: ref.size, storage: 'firebase', url: fd?.data || '' });
    } else {
      files.push(ref);
    }
  }

  return { ...meta, files, primaryFile: files[meta.primaryRef ?? 0] || files[0] };
}

// ── Update share stats ────────────────────────────────────
async function updateShare(sid, patch) {
  // Never write blobs
  const safe = { ...patch };
  delete safe.files;
  delete safe.primaryFile;
  return fbPatch(`shares/${sid}`, safe);
}

// ── File utilities ────────────────────────────────────────
const ALLOWED_TYPES = {
  all: null,
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
  return '📁';
}

function formatSize(b) {
  if (b < 1024)    return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(2) + ' MB';
}

function formatTime(ms) {
  const s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60);
  if (h > 0) return h + 'h ' + (m%60) + 'm';
  if (m > 0) return m + 'm ' + (s%60) + 's';
  return s + 's';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── FileReader → base64 ───────────────────────────────────
function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = () => rej(new Error('FileReader error'));
    r.readAsDataURL(file);
  });
}

// ── base64 → Blob ─────────────────────────────────────────
function b64toBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = head.match(/:(.*?);/)[1];
  const raw  = atob(b64);
  const arr  = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ── Theme ─────────────────────────────────────────────────
function initTheme() {
  const t = localStorage.getItem('ds_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
  const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('ds_theme', t);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
}

// ── Toast ─────────────────────────────────────────────────
function toast(msg, type = 'info', dur = 3500) {
  const wrap = document.getElementById('toastContainer');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<span>${{success:'✅',error:'❌',info:'ℹ️'}[type]}</span><span>${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => { el.style.transition='opacity .3s'; el.style.opacity='0'; setTimeout(()=>el.remove(),300); }, dur);
}

// ════════════════════════════════════════════════════════
// UPLOAD PAGE
// ════════════════════════════════════════════════════════
let pendingFiles = [], uploadPaused = false, uploadAbortFn = null, pauseResolve = null;

function initUploadPage() {
  initTheme();
  checkRulesExpiry();

  const dz  = document.getElementById('dropZone');
  const fi  = document.getElementById('fileInput');
  const foi = document.getElementById('folderInput');

  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', ()  => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); addFiles([...e.dataTransfer.files]); });
  dz.addEventListener('click', () => fi.click());
  fi.addEventListener('change',   () => addFiles([...fi.files]));
  foi.addEventListener('change',  () => addFiles([...foi.files]));

  document.getElementById('btnPickFile')  ?.addEventListener('click', e => { e.stopPropagation(); fi.click(); });
  document.getElementById('btnPickFolder')?.addEventListener('click', e => { e.stopPropagation(); foi.click(); });
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
    if (f.size > MAX_SIZE) { toast(`${f.name} exceeds ${MAX_SIZE_MB}MB`, 'error'); return; }
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
    const mode = f.size <= BASE64_LIMIT ? '☁️ Firebase' : '🌐 External';
    const d = document.createElement('div');
    d.className = 'file-item';
    d.innerHTML = `
      <span class="file-icon">${getFileIcon(f.type)}</span>
      <div class="file-info">
        <div class="file-name">${escHtml(f.name)}</div>
        <div class="file-meta">${formatSize(f.size)} · ${f.type||'Unknown'} · ${mode}</div>
      </div>
      <button class="file-remove" title="Remove">✕</button>`;
    d.querySelector('.file-remove').onclick = () => { pendingFiles.splice(i,1); renderFileList(); };
    wrap.appendChild(d);
  });
  document.getElementById('btnUpload').disabled = false;
}

function clearAll() { pendingFiles=[]; renderFileList(); }

// ── Start upload ──────────────────────────────────────────
async function startUpload() {
  if (!pendingFiles.length) { toast('Add files first','error'); return; }

  const note    = document.getElementById('uploaderNote')?.value.trim() || '';
  const expiry  = parseInt(document.getElementById('expirySelect')?.value || '86400');
  const dlLimit = parseInt(document.getElementById('dlLimit')?.value) || 0;
  const pw      = document.getElementById('passwordInput')?.value.trim() || '';
  const oneTime = document.getElementById('toggleOneTime')?.querySelector('input')?.checked || false;
  const autoDel = document.getElementById('toggleAutoDelete')?.querySelector('input')?.checked || false;
  const wantZip = document.getElementById('toggleZip')?.querySelector('input')?.checked || false;

  document.getElementById('uploadSection').classList.add('hidden');
  const ps = document.getElementById('progressSection');
  ps.classList.remove('hidden'); ps.classList.add('active');

  const pFill = document.getElementById('progressFill');
  const pPct  = document.getElementById('progressPercent');
  const pStat = document.getElementById('progressStats');
  const pLbl  = document.getElementById('progressLabel');

  const total = pendingFiles.reduce((a,f) => a+f.size, 0);
  const t0    = Date.now();
  const uploadedFiles = [];
  let done = 0;

  pLbl.textContent = `Processing ${pendingFiles.length} file${pendingFiles.length>1?'s':''}…`;

  let toProcess = pendingFiles;
  if (pendingFiles.length > 1 && wantZip) {
    try {
      toast('Creating ZIP…','info',2000);
      const blob = await makeZip(pendingFiles);
      toProcess  = [new File([blob], `dibyashare-${Date.now()}.zip`, {type:'application/zip'})];
      pLbl.textContent = 'Processing ZIP…';
    } catch { toast('ZIP failed, uploading individually','info'); }
  }

  for (const file of toProcess) {
    if (uploadPaused) await new Promise(r => { pauseResolve = r; });

    pLbl.textContent = `Reading "${file.name}"…`;
    try {
      let url, storage;

      if (file.size <= BASE64_LIMIT) {
        // Store as base64 in Firebase
        url     = await readAsDataURL(file);
        storage = 'firebase';
        done   += file.size;
        pFill.style.width = Math.round((done/total)*100) + '%';
        pPct.textContent  = Math.round((done/total)*100) + '%';
        pStat.textContent = `${formatSize(done)} / ${formatSize(total)} · Firebase`;
      } else {
        // External upload
        pLbl.textContent = `Uploading "${file.name}"…`;
        url = await externalUpload(file, prog => {
          const pct = Math.round(((done + prog*file.size)/total)*100);
          pFill.style.width = pct+'%'; pPct.textContent = pct+'%';
          pStat.textContent = `${formatSize(done+prog*file.size)} / ${formatSize(total)} · ${formatSize((done+prog*file.size)/((Date.now()-t0)/1000))}/s`;
        });
        storage = 'external';
        done   += file.size;
      }

      uploadedFiles.push({ name:file.name, size:file.size, type:file.type, url, storage });
    } catch (e) {
      toast('Failed: ' + e.message, 'error');
      resetToUpload(); return;
    }
  }

  pLbl.textContent = 'Saving to Firebase…';
  pFill.style.width = '100%'; pPct.textContent = '100%';

  try {
    const meta = {
      note, expiry, dlLimit,
      password:    pw ? btoa(pw) : '',
      oneTime, autoDelete: autoDel,
      files:           uploadedFiles,
      uploadedAt:      Date.now(),
      expiresAt:       Date.now() + expiry*1000,
      downloads:       0,
      downloadHistory: [],
      primaryFile:     uploadedFiles[0],
    };
    const sid = await saveShare(meta);
    ps.classList.remove('active'); ps.classList.add('hidden');
    showSuccess({ ...meta, id: sid });
  } catch (e) {
    toast('Failed to create share: ' + e.message, 'error');
    resetToUpload();
  }
}

// ── External upload chain: file.io → 0x0.st ──────────────
function externalUpload(file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData(); fd.append('file', file);
    const xhr = new XMLHttpRequest();
    uploadAbortFn = () => xhr.abort();
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded/e.total); };
    xhr.onload = () => {
      if (xhr.status === 200) {
        try { const r=JSON.parse(xhr.responseText); if(r.success&&r.link){resolve(r.link);return;} } catch{}
        try0x0(file, onProgress).then(resolve).catch(reject);
      } else { try0x0(file, onProgress).then(resolve).catch(reject); }
    };
    xhr.onerror = () => try0x0(file, onProgress).then(resolve).catch(reject);
    xhr.onabort = () => reject(new Error('Cancelled'));
    xhr.open('POST','https://file.io/?expires=1d'); xhr.send(fd);
  });
}
function try0x0(file, onProg) {
  return new Promise(resolve => {
    const fd=new FormData(); fd.append('file',file);
    const xhr=new XMLHttpRequest();
    xhr.upload.onprogress = e => { if(e.lengthComputable) onProg(e.loaded/e.total); };
    xhr.onload  = () => resolve(xhr.status===200 && xhr.responseText.startsWith('https') ? xhr.responseText.trim() : null);
    xhr.onerror = () => resolve(null);
    xhr.open('POST','https://0x0.st'); xhr.send(fd);
  });
}

async function makeZip(files) {
  if (typeof JSZip==='undefined') throw new Error('JSZip not loaded');
  const z = new JSZip();
  files.forEach(f => z.file(f.name, f));
  return z.generateAsync({type:'blob'});
}

function togglePause() {
  uploadPaused = !uploadPaused;
  const btn = document.getElementById('btnPause');
  if (btn) btn.textContent = uploadPaused ? '▶ Resume' : '⏸ Pause';
  if (!uploadPaused && pauseResolve) { pauseResolve(); pauseResolve=null; }
  toast(uploadPaused?'Paused':'Resumed','info');
}
function cancelUpload()  { uploadAbortFn?.(); resetToUpload(); toast('Cancelled','info'); }

function resetToUpload() {
  uploadPaused=false; uploadAbortFn=null;
  document.getElementById('progressSection')?.classList.remove('active');
  document.getElementById('progressSection')?.classList.add('hidden');
  document.getElementById('uploadSection')?.classList.remove('hidden');
}
function resetUpload() {
  pendingFiles=[]; renderFileList(); clearCd();
  document.getElementById('successPanel')?.classList.remove('active');
  document.getElementById('successPanel')?.classList.add('hidden');
  document.getElementById('uploadCard')?.classList.remove('hidden');
  document.getElementById('uploadSection')?.classList.remove('hidden');
}

// ── Success panel ─────────────────────────────────────────
let cdTimer = null;
function showSuccess(meta) {
  const panel = document.getElementById('successPanel');
  if (!panel) return;
  const shareUrl = location.origin + '/download.html?id=' + meta.id;
  document.getElementById('shareLink').value = shareUrl;
  document.getElementById('uploadCard')?.classList.add('hidden');
  panel.classList.remove('hidden'); panel.classList.add('active');

  const f = meta.files[0];
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
  startCd(meta.expiresAt);
}
function startCd(exp) {
  clearCd();
  const el = document.getElementById('countdownDisplay');
  const tick = () => { if(!el)return; const d=exp-Date.now(); el.textContent=d>0?formatTime(d):'Expired'; if(d<=0)clearCd(); };
  tick(); cdTimer = setInterval(tick, 1000);
}
function clearCd() { clearInterval(cdTimer); }

function copyLink() {
  const v = document.getElementById('shareLink').value;
  navigator.clipboard.writeText(v).then(() => {
    const b = document.getElementById('btnCopyLink');
    b.textContent='✓ Copied!'; b.classList.add('copied');
    setTimeout(()=>{ b.textContent='Copy'; b.classList.remove('copied'); },2000);
    toast('Copied!','success');
  });
}
function generateQR(url) {
  const el = document.getElementById('qrcode');
  if (!el) return; el.innerHTML='';
  if (typeof QRCode!=='undefined')
    new QRCode(el,{text:url,width:128,height:128,colorDark:'#7c6aff',colorLight:'#ffffff'});
  else
    el.innerHTML=`<img src="https://api.qrserver.com/v1/create-qr-code/?size=128x128&data=${encodeURIComponent(url)}&color=7c6aff" style="border-radius:8px;">`;
}

// ════════════════════════════════════════════════════════
// DOWNLOAD PAGE
// ════════════════════════════════════════════════════════
function initDownloadPage() {
  initTheme();
  checkRulesExpiry();
  document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
  const sid = new URLSearchParams(location.search).get('id');
  if (!sid) { showError('No file ID in URL.'); return; }
  loadPage(sid);
}

async function loadPage(sid) {
  try {
    const meta = await loadShare(sid);
    if (!meta)                                              return showError('File not found or deleted.');
    if (Date.now() > meta.expiresAt)                        return showExpired();
    if (meta.dlLimit > 0 && meta.downloads >= meta.dlLimit) return showError('Download limit reached.');
    if (meta.password)                                      return showPwGate(meta, sid);
    renderDL(meta, sid);
  } catch(e) { showError('Load failed: ' + e.message); }
}

function showPwGate(meta, sid) {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('passwordGate').classList.remove('hidden');
  const inp = document.getElementById('passwordInput');
  const btn = document.getElementById('btnUnlock');
  btn.onclick = () => {
    if (btoa(inp.value) === meta.password) {
      document.getElementById('passwordGate').classList.add('hidden');
      renderDL(meta, sid);
    } else {
      inp.style.borderColor='var(--red)';
      toast('Wrong password','error');
      setTimeout(()=>inp.style.borderColor='',1500);
    }
  };
  inp.onkeydown = e => { if(e.key==='Enter') btn.click(); };
}

function renderDL(meta, sid) {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('downloadPage').classList.remove('hidden');

  const f = meta.primaryFile;
  document.getElementById('dlFileName').textContent     = f.name;
  document.getElementById('dlFileIcon').textContent     = getFileIcon(f.type);
  document.getElementById('dlFileMeta').textContent     = formatSize(f.size) + ' · ' + (f.type||'Unknown');
  document.getElementById('dlShareIdBadge').textContent = sid;
  document.getElementById('dlCount').textContent        = meta.downloads || 0;
  document.getElementById('dlLimit2').textContent       = meta.dlLimit > 0 ? meta.dlLimit : '∞';

  const last = (meta.downloadHistory||[]).slice(-1)[0];
  document.getElementById('dlLastTime').textContent = last ? new Date(last.time).toLocaleString() : 'Never';

  if (meta.note) {
    document.getElementById('uploaderNote').classList.remove('hidden');
    document.getElementById('noteText').textContent = meta.note;
  }

  // Live expiry bar
  const tick = () => {
    const d = meta.expiresAt - Date.now();
    document.getElementById('dlExpiry').textContent   = d > 0 ? formatTime(d) : 'Expired';
    document.getElementById('expiryFill').style.width = Math.max(0,Math.min(100,(d/(meta.expiry*1000))*100))+'%';
  };
  tick(); setInterval(tick, 1000);

  // Preview
  renderPreview(f);

  // Download button — wire directly, no async before click
  const dlBtn = document.getElementById('btnDownload');
  dlBtn.onclick = e => {
    e.preventDefault();
    doDownload(meta, sid, f);
  };

  // Share buttons
  const url = location.href;
  const msg = 'Check out this shared file on DibyaShare';
  document.getElementById('dlShareWA')?.setAttribute('href',`https://wa.me/?text=${encodeURIComponent(msg+'\n'+url)}`);
  document.getElementById('dlShareTG')?.setAttribute('href',`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(msg)}`);

  renderHistory(meta);
}

// ── Preview ───────────────────────────────────────────────
function renderPreview(f) {
  const sec = document.getElementById('previewSection');
  if (!sec) return;
  sec.innerHTML = '';

  const url  = f.url;
  const mime = f.type || '';

  if (!url) { sec.classList.add('hidden'); return; }

  if (mime.startsWith('image/')) {
    const img = new Image();
    img.onload = () => sec.classList.remove('hidden');
    img.onerror = () => sec.classList.add('hidden');
    img.src   = url;
    img.style = 'max-height:320px;object-fit:contain;width:100%;display:block;border-radius:8px;';
    sec.appendChild(img);

  } else if (mime.startsWith('video/')) {
    const v = document.createElement('video');
    v.controls = true;
    v.style    = 'width:100%;max-height:320px;display:block;border-radius:8px;';
    v.src      = url;
    sec.appendChild(v);
    sec.classList.remove('hidden');

  } else if (mime.startsWith('audio/')) {
    const a = document.createElement('audio');
    a.controls = true;
    a.style    = 'width:100%;display:block;padding:16px;';
    a.src      = url;
    sec.appendChild(a);
    sec.classList.remove('hidden');

  } else if (mime === 'application/pdf') {
    const em = document.createElement('embed');
    em.src   = url;
    em.type  = 'application/pdf';
    em.style = 'width:100%;height:380px;border:none;border-radius:8px;display:block;';
    sec.appendChild(em);
    sec.classList.remove('hidden');

  } else if (mime.startsWith('text/') && url.startsWith('data:')) {
    try {
      const text = decodeURIComponent(escape(atob(url.split(',')[1])));
      const pre  = document.createElement('pre');
      pre.style = 'padding:16px;overflow:auto;max-height:280px;font-size:.82rem;text-align:left;white-space:pre-wrap;word-break:break-word;color:var(--text-2);';
      pre.textContent = text;
      sec.appendChild(pre);
      sec.classList.remove('hidden');
    } catch { sec.classList.add('hidden'); }
  } else {
    sec.classList.add('hidden');
  }
}

// ── Download ──────────────────────────────────────────────
// CRITICAL: download must be triggered synchronously within the user gesture.
// No await before the click — mobile Chrome blocks otherwise.
function doDownload(meta, sid, f) {
  const btn = document.getElementById('btnDownload');
  btn.disabled = true;
  btn.textContent = '⬇ Starting…';

  if (!f.url) {
    toast('No file URL', 'error');
    btn.disabled = false;
    return;
  }

  // Build blob and trigger download immediately (still in click handler = user gesture)
  let blobUrl;
  try {
    const blob = b64toBlob(f.url);
    blobUrl = URL.createObjectURL(blob);
  } catch {
    // Not a data URL — use as-is (external URL)
    blobUrl = f.url;
  }

  const a = document.createElement('a');
  a.href     = blobUrl;
  a.download = f.name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  if (blobUrl !== f.url) setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

  toast('Download started! 🎉', 'success');
  setTimeout(() => { btn.disabled=false; btn.innerHTML='⬇&nbsp;&nbsp;Download Again'; }, 3000);

  // Async stats update (after download triggered)
  ;(async () => {
    let country = 'Unknown';
    try {
      const r = await fetch('https://ipapi.co/json/', {signal:AbortSignal.timeout(2000)});
      country = (await r.json()).country_name || 'Unknown';
    } catch {}
    const history = [...(meta.downloadHistory||[]), {time:Date.now(), country}];
    const newDl   = (meta.downloads||0) + 1;
    meta.downloads = newDl; meta.downloadHistory = history;
    document.getElementById('dlCount').textContent    = newDl;
    document.getElementById('dlLastTime').textContent = new Date().toLocaleString();
    renderHistory(meta);
    try { await updateShare(sid, {downloads:newDl, downloadHistory:history}); } catch {}

    if (meta.oneTime) {
      try { await updateShare(sid, {dlLimit:1}); } catch {}
      btn.textContent = '⛔ One-time link used';
      btn.disabled = true;
    }
    if (meta.autoDelete) {
      try { await updateShare(sid, {expiresAt:Date.now()-1}); } catch {}
    }
  })();
}

function renderHistory(meta) {
  const wrap = document.getElementById('historyList');
  if (!wrap) return;
  const h = meta.downloadHistory || [];
  wrap.innerHTML = h.length
    ? h.slice(-5).reverse().map(x=>`<div class="history-item"><span>🌍</span><span>${escHtml(x.country)}</span><span style="margin-left:auto;color:var(--text-3)">${new Date(x.time).toLocaleString()}</span></div>`).join('')
    : '<div style="color:var(--text-3);font-size:.82rem;">No downloads yet</div>';
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

// ── Expose ────────────────────────────────────────────────
window.initUploadPage   = initUploadPage;
window.initDownloadPage = initDownloadPage;
window.copyLink         = copyLink;
window.clearAll         = clearAll;
window.toggleTheme      = toggleTheme;
window.toast            = toast;

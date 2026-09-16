/* ==========================================================================
 * GM Scan Pro — js/ui.js
 * --------------------------------------------------------------------------
 * App shell UI: tab switching, scan form (counts, expected rules),
 * PWA install/standalone behavior, service-worker registration,
 * and the single startup sequence at the bottom of this file.
 * Load order (plain <script> tags, NOT ES modules — this keeps the app working
 * from file:// and plain intranet hosting with no build step):
 *   config -> utils -> dpm -> parser -> scanner -> history -> settings -> ui
 * ========================================================================== */

function stepVal(id,delta){
  let el=document.getElementById(id);
  if(!el) return;
  let v=(parseInt(el.value,10)||0)+delta;
  v=Math.max(0,Math.min(1000,v));
  el.value=v;
  buildExpectedRules();
  persistSettings();
}

function toggleExpected(){
    let box = document.getElementById('expectedBox');
    if(document.getElementById('showExpected').checked){
        box.style.display = 'block';
    } else {
        box.style.display = 'none';
    }
}

function buildExpectedRules(){let h='';let f=+faCountInput.value,c=+saCountInput.value;for(let i=1;i<=f;i++)h+=`<div class="assembly-block"><div class="assembly-title">FA SCAN #${i} (FINAL ASSEMBLY)</div><label class="field"><span>Part #${i}</span><input id=fp${i} placeholder="e.g. 12345678"></label><label class="field"><span>VPPS #${i}</span><input id=fv${i} placeholder="e.g. 6060383620001"></label></div>`;for(let i=1;i<=c;i++)h+=`<div class="assembly-block"><div class="assembly-title">SA SCAN #${i} (SUB-ASSEMBLY / CONVERTER)</div><label class="field"><span>Part #${i}</span><input id=cp${i} placeholder="e.g. 12345678"></label><label class="field"><span>VPPS #${i}</span><input id=cv${i} placeholder="e.g. 6060383620001"></label></div>`;expectedRulesBox.innerHTML=h;}

function clearScan(){scanInput.value='';} function resetAll(){faCountInput.value=1;saCountInput.value=1;scanInput.value='';resultBox.innerHTML='';buildExpectedRules();}

/* Shared element handles. Defined once here; read by parser.js,
   scanner.js and settings.js at runtime (every script is loaded
   before any of them runs). The id="..." values in index.html
   are unchanged. */

const faCountInput=document.getElementById('f'),saCountInput=document.getElementById('c'),expectedRulesBox=document.getElementById('rules'),scanInput=document.getElementById('scan'),resultBox=document.getElementById('out');

/* Restore persisted history + form settings (survives app close/reload).
   Called once at startup from ui.js. */
function restorePersistedState(){
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) historyRecords = arr; }
  } catch(e){}
  try {
    const st = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (typeof st.f === 'number') faCountInput.value = st.f;
    if (typeof st.c === 'number') saCountInput.value = st.c;
    const sh = document.getElementById('showExpected');
    const cd = document.getElementById('checkDup');
    if (sh) sh.checked = !!st.showExpected;
    if (cd) cd.checked = !!st.checkDup;
  } catch(e){}
}

function persistSettings(){
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      f: +faCountInput.value, c: +saCountInput.value,
      showExpected: !!document.getElementById('showExpected').checked,
      checkDup: !!document.getElementById('checkDup').checked
    }));
  } catch(e){}
}
// Keep other open instances in sync (same app, not a fresh copy).

window.addEventListener('storage', (e) => {
  if (e.key === HISTORY_KEY) {
    try { const arr = JSON.parse(e.newValue||'[]'); if (Array.isArray(arr)) historyRecords = arr; updateHistoryCount(); } catch(err){}
  } else if (e.key === SETTINGS_KEY) {
    try {
      const st = JSON.parse(e.newValue||'{}');
      if (typeof st.f === 'number') faCountInput.value = st.f;
      if (typeof st.c === 'number') saCountInput.value = st.c;
      const sh = document.getElementById('showExpected'); if (sh) sh.checked = !!st.showExpected;
      const cd = document.getElementById('checkDup'); if (cd) cd.checked = !!st.checkDup;
      buildExpectedRules();
    } catch(err){}
  }
});

window.addEventListener('keydown', e => {
    if(e.key === 'Escape') {
        closeHistoryModal();
        stopCameraScan(true);
        closeHelpModal();
    }
});

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

function showPwaInstallGuide() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                showToast("📱 Installing GM Barcode App...");
            }
            deferredPrompt = null;
        });
        return;
    }
    let msg = `<b>📱 How to Install on your Phone (100% Full-Screen):</b><br><br>
               <b>1.</b> Tap your browser's <b>Share / Menu button</b> (square with up arrow in Safari, or 3 dots in Edge/Chrome).<br>
               <b>2.</b> Tap <b>"Add to Home Screen"</b> (or "Add to Phone").<br>
               <b>3.</b> Tap <b>"Add"</b> in the top right.<br><br>
               👉 An app icon titled <b>"GM Barcode App"</b> will be on your Home Screen! It opens full-screen without any browser address bar and allows live camera auto-scanning!`;
    let body = document.getElementById('historyModalBody');
    let modal = document.getElementById('historyModal');
    if (body && modal) {
        body.innerHTML = `<div style="padding:16px;text-align:left;line-height:1.5;color:var(--text);font-size:0.95rem;">${msg}</div>`;
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    } else {
        alert("To install: Tap Share in your browser -> Add to Home Screen -> Add!");
    }
}

/* ============ PWA APP-LIKE BEHAVIOUR ============ */

// Open or focus the existing app window instead of launching a fresh browser copy.
// A fixed window name means the browser reuses an already-open GM Scan Pro window.

function openOrFocusApp(){
  const url = location.href.split('#')[0];
  let w = null;
  try { w = window.open(url, APP_WINDOW_NAME); } catch(e){ w = null; }
  if (w) { try { w.focus(); } catch(e){} }
  return !!w;
}
// Install button: if app already installed, just bring it forward; else trigger prompt.

function launchInstalledApp(){
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((c) => { if (c.outcome === 'accepted') showToast("📱 Installing GM Scan Pro..."); deferredPrompt = null; });
    return;
  }
  showPwaInstallGuide();
}

// Standalone detection: run like a mobile app (no browser chrome), full-screen.

function isStandalone(){
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || window.navigator.standalone === true;
}
// Tell the user when it's running as an app.

function announceStandalone(){
  try { if (isStandalone()) document.title = 'GM Scan Pro · App'; } catch(e){}
}

// Robust service worker registration with update handling (keeps a single cached app shell).

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('PWA SW registered:', reg.scope);
        // auto-update the running app when a new SW takes over
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('GM Scan Pro update available (applied on next launch).');
            }
          });
        });
      })
      .catch(err => console.log('PWA SW registration failed:', err));
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // new version active: reload only if user had no unsaved scan text
    const sc = document.getElementById('scan');
    if (!sc || !sc.value) { try { location.reload(); } catch(e){} }
  });
}

// Launch-mode: if this is being opened as a duplicate while an app window is open,
// bring that window forward instead of showing a second copy (best effort, browsers permitting).

try {
  if (window.opener && !isStandalone()) {
    // opened as a popup from the app -> just sync; do not duplicate
  }
} catch(e){}

/* ================= APP-LIKE SHELL + SERVER DUPLICATE CHECK ================= */
function switchTab(name){
  document.body.dataset.tab=name;
  // The Dot Pin tab reuses the Scan panel (same inputs, parser, validation,
  // history): only the decode order changes, via body[data-scanmode].
  const page=(name==='dotpin')?'scan':name;
  const dpm=(name==='dotpin');
  document.body.dataset.scanmode=dpm?'dpm':'label';
  document.querySelectorAll('.tabpage').forEach(s=>s.classList.toggle('active',s.id==='tab-'+page));
  document.querySelectorAll('.tabbar button').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  const banner=document.getElementById('dpmModeBanner');
  if(banner) banner.style.display=dpm?'block':'none';
  const cap=document.getElementById('heroCap');
  if(cap) cap.textContent=dpm?'DOT-PIN · needle-etched metal':'READY · Data Matrix / Code 128';
  if(name==='history') renderHistoryTab();
  try{window.scrollTo({top:0});}catch(e){window.scrollTo(0,0);}
}

/* --------------------------------------------------------------------------
 * Startup — the single entry point. Runs after every module above
 * has loaded (scripts are at the end of <body>).
 * -------------------------------------------------------------------------- */
restorePersistedState();
buildExpectedRules();
updateHistoryCount();
announceStandalone();
applySettingsToUI();
renderHistoryTab();
updateConnPill();

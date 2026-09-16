/* ==========================================================================
 * GM Scan Pro — js/settings.js
 * --------------------------------------------------------------------------
 * Settings tab UI (DUNS, duplicate-check server) and the optional
 * company-server duplicate check. Parsing/validation untouched.
 * Load order (plain <script> tags, NOT ES modules — this keeps the app working
 * from file:// and plain intranet hosting with no build step):
 *   config -> utils -> dpm -> parser -> scanner -> history -> settings -> ui
 * ========================================================================== */

function applySettingsToUI(){
  let d=document.getElementById('setDuns'); if(d) d.value=expectedDunsDigits();
  let u=document.getElementById('setSrvUrl'); if(u) u.value=appSettings.serverUrl||'';
  let k=document.getElementById('setSrvKey'); if(k) k.value=appSettings.serverKey||'';
  document.querySelectorAll('input[name="srvMode"]').forEach(r=>{r.checked=(r.value===appSettings.serverMode);});
  syncSrvFields();
}

function onDunsInput(){
  let el=document.getElementById('setDuns'); let err=document.getElementById('dunsErr');
  if(!el) return;
  let raw=el.value;
  let n=normalizeDunsInput(raw);
  if(validDunsFormat(n)){ appSettings.duns=n; if(el.value!==n) el.value=n; if(err) err.textContent=''; saveAppSettings(); }
  else { if(err) err.textContent = raw.trim() ? 'Enter 9 digits (e.g. 606038362).' : ''; }
  updateConnPill();
}

function onSrvSettingsInput(){
  let u=document.getElementById('setSrvUrl'), k=document.getElementById('setSrvKey');
  appSettings.serverUrl=u?u.value.trim():'';
  appSettings.serverKey=k?k.value:'';
  saveAppSettings(); updateConnPill();
  let st=document.getElementById('srvTestStatus');
  if(st && appSettings.serverUrl){ st.className='srv-status'; st.textContent='Settings saved — tap Test connection to verify.'; }
}

function onSrvModeChange(v){ appSettings.serverMode=v; saveAppSettings(); syncSrvFields(); updateConnPill(); }

function syncSrvFields(){ let f=document.getElementById('srvFields'); if(f) f.style.display=(appSettings.serverMode!=='off')?'block':'none'; }

function toggleKeyVis(){ let k=document.getElementById('setSrvKey'); if(k) k.type=(k.type==='password'?'text':'password'); }

function resetAppSettings(){
  if(!confirm('Reset DUNS and server settings to defaults?')) return;
  appSettings={duns:DEFAULT_DUNS_DIGITS,serverUrl:'',serverKey:'',serverMode:'off'};
  saveAppSettings(); applySettingsToUI(); updateConnPill(); showToast('Settings reset.');
}

function updateConnPill(state){
  let p=document.getElementById('connPill'); if(!p) return;
  let on=appSettings.serverMode!=='off' && !!String(appSettings.serverUrl||'').trim();
  if(on){
    if(state==='ok'){ p.className='conn-pill srv ok'; p.textContent='● Server ✓'; }
    else if(state==='warn'){ p.className='conn-pill warn'; p.textContent='● Server ⚠'; }
    else { p.className='conn-pill srv'; p.textContent='● Server'; }
  } else { p.className='conn-pill'; p.textContent='● Local'; }
}
// keep a second device tab in sync when settings change elsewhere

window.addEventListener('storage',(e)=>{
  if(e.key===APP_SETTINGS_KEY){
    try{const s=JSON.parse(e.newValue||'{}');
      if(s&&typeof s==='object'){appSettings=Object.assign({duns:DEFAULT_DUNS_DIGITS,serverUrl:'',serverKey:'',serverMode:'off'},s);if(/^12V\d{9}$/i.test(String(appSettings.duns||'')))appSettings.duns=String(appSettings.duns).slice(3).toUpperCase();applySettingsToUI();updateConnPill();}
    }catch(err){}
  }
});

/* ---------- company server duplicate check ---------- */

function serverApiUrl(path){
  let base=String(appSettings.serverUrl||'').trim().replace(/\/+$/,'');
  if(!base) return path;
  return base+path;
}

function serverApiHeaders(extra){
  let h=Object.assign({},extra||{});
  if(appSettings.serverKey) h['X-API-Key']=appSettings.serverKey;
  return h;
}

async function checkServerDuplicates(traces){
  let base=String(appSettings.serverUrl||'').trim();
  if(typeof location!=='undefined' && location.protocol==='https:' && /^http:\/\//i.test(base))
    return {ok:false,error:'mixed-content'};
  let ctrl=new AbortController(); let timer=setTimeout(()=>ctrl.abort(),6000);
  try{
    let r=await fetch(serverApiUrl('/api/duplicates/check'),{
      method:'POST', headers:serverApiHeaders({'Content-Type':'application/json'}),
      body:JSON.stringify({traces:traces,device:getDeviceId(),duns:expectedDuns()}),
      signal:ctrl.signal
    });
    clearTimeout(timer);
    if(!r.ok) return {ok:false,error:'http-'+r.status};
    let j=await r.json();
    let dups=Array.isArray(j.duplicates)?j.duplicates:(Array.isArray(j.duplicate_traces)?j.duplicate_traces:[]);
    return {ok:true,duplicates:dups.map(String),meta:j};
  }catch(e){ clearTimeout(timer); return {ok:false,error:(e&&e.name==='AbortError')?'timeout':'unreachable'}; }
}

let srvCheckSeq=0, lastSrvCheckRaw='', lastSrvVerdictHTML='';

async function refreshServerDupStatus(){
  let host=document.getElementById('out'); if(!host) return;
  let old=document.getElementById('serverDupStatus'); if(old) old.remove();
  let box=document.createElement('div'); box.id='serverDupStatus'; host.appendChild(box);
  let raw=(document.getElementById('scan')||{value:''}).value||'';
  let traces=(lastScanAssemblies||[]).map(a=>a.trace).filter(Boolean);
  if(appSettings.serverMode==='off' || !String(appSettings.serverUrl||'').trim() || !traces.length){ box.innerHTML=''; return; }
  if(raw===lastSrvCheckRaw && lastSrvVerdictHTML){ box.innerHTML=lastSrvVerdictHTML; return; }
  let my=++srvCheckSeq;
  box.innerHTML='<span class="srv-chip checking">⟳ Checking company server…</span>';
  let res=await checkServerDuplicates(traces);
  if(my!==srvCheckSeq) return;
  if(!res.ok){
    let msg = res.error==='mixed-content' ? 'Server URL must use HTTPS — this app runs over HTTPS, so browsers block plain-HTTP.'
      : res.error==='timeout' ? 'Server timed out — only the on-device check ran.'
      : res.error && res.error.indexOf('http-')===0 ? 'Server answered with HTTP '+res.error.slice(5)+' — check the URL.'
      : 'Server unreachable — only the on-device check ran.';
    lastSrvVerdictHTML='<span class="srv-chip warn">⚠ '+msg+'</span>';
    box.innerHTML=lastSrvVerdictHTML; updateConnPill('warn'); return;
  }
  updateConnPill('ok');
  let dups=res.duplicates||[];
  if(dups.length){
    lastSrvVerdictHTML='<span class="srv-chip dup">⛔ SERVER DUPLICATE: '+dups.map(escapeHtml).join(', ')+'</span>';
  } else {
    lastSrvVerdictHTML='<span class="srv-chip ok">✓ Server: no duplicates found</span>';
  }
  lastSrvCheckRaw=raw; box.innerHTML=lastSrvVerdictHTML;
}

async function testServerConnection(){
  let st=document.getElementById('srvTestStatus');
  let base=String(appSettings.serverUrl||'').trim();
  if(!base){ if(st){st.className='srv-status bad';st.textContent='Enter the server URL first.';} updateConnPill('warn'); return; }
  if(typeof location!=='undefined' && location.protocol==='https:' && /^http:\/\//i.test(base)){
    if(st){st.className='srv-status bad';st.textContent='Blocked: this app runs over HTTPS, so the server URL must also be HTTPS (browsers block plain HTTP).';}
    updateConnPill('warn'); return;
  }
  if(st){st.className='srv-status';st.textContent='Testing…';}
  let ctrl=new AbortController(); let t=setTimeout(()=>ctrl.abort(),7000);
  try{
    let r=await fetch(serverApiUrl('/api/health'),{headers:serverApiHeaders({}),signal:ctrl.signal});
    clearTimeout(t);
    if(r.ok){
      let j=null; try{j=await r.json();}catch(e){}
      if(st){st.className='srv-status ok';st.textContent='✓ Connected to server.'+(j&&j.version?(' Server version '+j.version+'.'):'')+' Duplicate checks will run after each scan.';}
      updateConnPill('ok');
    } else {
      if(st){st.className='srv-status bad';st.textContent='Server answered with HTTP '+r.status+'. Check the URL path.';}
      updateConnPill('warn');
    }
  }catch(e){
    clearTimeout(t);
    if(st){st.className='srv-status bad';st.textContent='Could not reach the server. Check the URL, the phone\u2019s Wi-Fi/VPN, and that the server allows this app (CORS).';}
    updateConnPill('warn');
  }
}

/* ---------- init ---------- */

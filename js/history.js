/* ==========================================================================
 * GM Scan Pro — js/history.js
 * --------------------------------------------------------------------------
 * On-device scan history: records, localStorage persistence, CSV
 * export, history tab rendering, history/help modals.
 * Load order (plain <script> tags, NOT ES modules — this keeps the app working
 * from file:// and plain intranet hosting with no build step):
 *   config -> utils -> dpm -> parser -> scanner -> history -> settings -> ui
 * ========================================================================== */

function persistHistory(){
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(historyRecords)); } catch(e){}
}

function updateHistoryCount(){
    // FIX: element is 'historyBadgeCount'; guard against missing element so validation can never be aborted.
    let badge = document.getElementById('historyBadgeCount') || document.getElementById('historyCount');
    if (badge) badge.textContent = historyRecords.length;
    let tb = document.getElementById('tabHistoryBadge');
    if (tb) { tb.textContent = historyRecords.length; tb.style.display = historyRecords.length ? 'flex' : 'none'; }
}

function saveHistory(result,raw,errorReason,assemblies){
    historyRecords.push({timestamp:new Date().toISOString(),result:result,errorReason:errorReason,assemblies:assemblies,rawScanData:raw});
    persistHistory();
    updateHistoryCount();
    playScanFeedback(result);
    try {
        let fa = assemblies.find(a => a.type === 'Final') || {};
        let sa = assemblies.find(a => a.type === 'Converter') || {};
        fetch(serverApiUrl('/api/scan'), {
            method: 'POST',
            headers: serverApiHeaders({'Content-Type': 'application/json'}),
            body: JSON.stringify({
                device: getDeviceId(),
                result: result,
                raw_data: raw,
                error_reason: errorReason,
                fa_vpps: fa.vpps || '',
                fa_part: fa.part || '',
                fa_trace: fa.trace || '',
                sa_vpps: sa.vpps || '',
                sa_part: sa.part || '',
                sa_trace: sa.trace || ''
            })
        }).catch(()=>{});
    } catch(e) {}
}

function clearHistory(){
    if(confirm('Clear all stored validation history?')){
        historyRecords = [];
        persistHistory();
        updateHistoryCount();
        showToast('History cleared.');
    }
}

function exportHistoryCsv(){
    if(historyRecords.length === 0){showToast('No history available yet.');return;}
    let maxFinal = 0; let maxConverter = 0;
    historyRecords.forEach(h=>{
        let f = h.assemblies.filter(a=>a.type==='Final').length;
        let c = h.assemblies.filter(a=>a.type==='Converter').length;
        if(f > maxFinal) maxFinal = f;
        if(c > maxConverter) maxConverter = c;
    });
    let headers = ['Timestamp','Result','ErrorReason'];
    for(let i=1;i<=maxFinal;i++){headers.push(`Final${i}_VPPS`);headers.push(`Final${i}_Part`);headers.push(`Final${i}_Trace`);}
    for(let i=1;i<=maxConverter;i++){headers.push(`Converter${i}_VPPS`);headers.push(`Converter${i}_Part`);headers.push(`Converter${i}_Trace`);}
    let csv = headers.join(',') + '\n';
    historyRecords.forEach(h=>{
        let row = [h.timestamp,h.result,h.errorReason || ''];
        let finals = h.assemblies.filter(a=>a.type==='Final');
        let converters = h.assemblies.filter(a=>a.type==='Converter');
        for(let i=0;i<maxFinal;i++){
            let f = finals[i];
            row.push(f ? f.vpps : '');row.push(f ? f.part : '');row.push(f ? f.trace : '');
        }
        for(let i=0;i<maxConverter;i++){
            let c = converters[i];
            row.push(c ? c.vpps : '');row.push(c ? c.part : '');row.push(c ? c.trace : '');
        }
        csv += row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',') + '\n';
    });
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'GM_Validation_History.csv'; link.style.display = 'none';
    document.body.appendChild(link);
    let downloadWorked = true;
    try{link.click();}catch(e){downloadWorked = false;}
    document.body.removeChild(link);
    let downloadSupported = typeof HTMLAnchorElement !== 'undefined' && 'download' in HTMLAnchorElement.prototype;
    if(!downloadWorked || !downloadSupported){
        window.open(url, '_blank');
        alert('If the file did not download automatically, use your browser Share/Save option on the page that just opened to save the CSV.');
    }
    setTimeout(()=>URL.revokeObjectURL(url), 10000);
}

function openHistoryModal(){
    let body = document.getElementById('historyModalBody');
    let modal = document.getElementById('historyModal');
    if(!body || !modal) return;
    let last20 = historyRecords.slice(-20).reverse();
    if(last20.length === 0){
        body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted);font-size:0.95rem;">No recent scans stored in this session yet.</div>';
    } else {
        let h = '';
        last20.forEach((rec, idx) => {
            let isPass = rec.result === 'PASS';
            let badgeClass = isPass ? 'badge-pass' : 'badge-fail';
            let timeStr = formatHistoryTime(rec.timestamp);
            h += `<div class="history-item">
                <div class="history-item-header">
                    <span><b>#${historyRecords.length - idx}</b> &bull; ${timeStr}</span>
                    <span class="${badgeClass}">${rec.result}</span>
                </div>
                ${rec.errorReason ? `<div class="history-reason">${rec.errorReason}</div>` : `<div style="font-size:0.85rem;color:var(--green);font-weight:600;margin-top:4px;">GMW 15862 Compliant &bull; All checks passed</div>`}
                <div class="history-raw">${escapeHtml(rec.rawScanData || '')}</div>
            </div>`;
        });
        body.innerHTML = h;
    }
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeHistoryModal(){
    let modal = document.getElementById('historyModal');
    if(modal) modal.classList.remove('open');
    document.body.style.overflow = '';
}

function handleModalClick(event){
    let modal = document.getElementById('historyModal');
    if(event.target === modal){
        closeHistoryModal();
    }
}

function openHelpModal() {
    let m = document.getElementById('helpModal');
    if (m) m.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeHelpModal() {
    let m = document.getElementById('helpModal');
    if (m) m.classList.remove('open');
    document.body.style.overflow = '';
}

function handleHelpModalClick(event) {
    let m = document.getElementById('helpModal');
    if (event.target === m) closeHelpModal();
}

function historyListHtml(){
  let last20=historyRecords.slice(-20).reverse();
  if(!last20.length) return '<div style="text-align:center;padding:32px;color:var(--muted);font-size:.95rem;">No scans yet — validated labels will appear here.</div>';
  let h='';
  last20.forEach((rec,idx)=>{
    let isPass=rec.result==='PASS';
    h+='<div class="history-item"><div class="history-item-header"><span><b>#'+(historyRecords.length-idx)+'</b> &bull; '+escapeHtml(formatHistoryTime(rec.timestamp))+'</span><span class="'+(isPass?'badge-pass':'badge-fail')+'">'+rec.result+'</span></div>'
      +(rec.errorReason?'<div class="history-reason">'+escapeHtml(rec.errorReason)+'</div>':'<div style="font-size:.85rem;color:var(--green);font-weight:600;margin-top:4px;">GMW 15862 Compliant &bull; All checks passed</div>')
      +'<div class="history-raw">'+escapeHtml(rec.rawScanData||'')+'</div></div>';
  });
  return h;
}

function renderHistoryTab(){ let b=document.getElementById('historyTabBody'); if(b) b.innerHTML=historyListHtml(); }

/* ---------- settings UI ---------- */

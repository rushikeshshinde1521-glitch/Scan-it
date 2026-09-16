/* ==========================================================================
 * GM Scan Pro — js/utils.js
 * --------------------------------------------------------------------------
 * Small shared helpers: string normalization, HTML escaping, toasts,
 * device id, time formatting. No app logic.
 * Load order (plain <script> tags, NOT ES modules — this keeps the app working
 * from file:// and plain intranet hosting with no build step):
 *   config -> utils -> dpm -> parser -> scanner -> history -> settings -> ui
 * ========================================================================== */

function getDeviceId(){try{let id=localStorage.getItem('gmscanpro_device');if(!id){id='dev-'+Math.random().toString(36).slice(2,10)+Date.now().toString(36);localStorage.setItem('gmscanpro_device',id);}return id;}catch(e){return 'dev-unknown';}}

function showToast(msg,duration=2200){
    let t=document.getElementById('toast');
    t.textContent=msg;
    t.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer=setTimeout(()=>t.classList.remove('show'),duration);
}

function normalizeSeparators(s){
return String(s||'')
.replace(/[\x1E\u241E]/g,'<RS>')
.replace(/[\x1D\u241D]/g,'<GS>')
.replace(/[\x04\u2404]/g,'')
.replace(/[\x1F\u241F]/g,'<US>')
.replace(/[\x1C\u241C]/g,'<FS>')
.replace(/<0x1E>|␞/gi,'<RS>')
.replace(/<0x1D>|␝/gi,'<GS>')
.replace(/<0x4>|<EOT>|␄/gi,'');
}
// Rigorous GM GMW 15862 header verification:
// 1. Accepts standard ISO/IEC 15434 compliance envelopes with explicit '06' (iOS, Scandit, Plant scanners).
// 2. Accepts Android hardware scans where '06' is dropped only if the payload strictly verifies as a valid GM assembly structure ([)>Y... or Y...P...12V...).
// 3. Genuinely malformed headers or missing data fields FAIL.

function formatHistoryTime(isoStr){
    try {
        let d = new Date(isoStr);
        return d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'}) + ' (' + d.toLocaleDateString() + ')';
    } catch(e) {
        return isoStr || '';
    }
}

function escapeHtml(str){
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

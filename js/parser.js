/* ==========================================================================
 * GM Scan Pro — js/parser.js
 * --------------------------------------------------------------------------
 * GMW 15862 label parsing + validation. Pure functions over scan text,
 * plus runLabelValidation() which renders the PASS/FAIL result.
 * Parser choice is unchanged: DPM shape -> parseDPM, separators ->
 * parseGSRS, otherwise count-driven/continuous.
 * Load order (plain <script> tags, NOT ES modules — this keeps the app working
 * from file:// and plain intranet hosting with no build step):
 *   config -> utils -> dpm -> parser -> scanner -> history -> settings -> ui
 * ========================================================================== */

function validateAndShow(){
    runLabelValidation();
    refreshServerDupStatus();
    let outEl=document.getElementById('out');
    if(outEl) outEl.scrollIntoView({behavior:'smooth',block:'start'});
}

function validateHeader(t){
    let s=normalizeSeparators(t).trim();
    let isDotMatrix = false;
    let surfEl = document.querySelector('input[name="surfaceType"]:checked');
    if (surfEl && surfEl.value === 'dotmatrix') isDotMatrix = true;
    
    if (isDotMatrix) return '';

    if (s.startsWith('[)>') || s.startsWith('[)<')) {
        // Must contain 06 OR have valid GM assembly structure starting immediately with Y (Android omission case)
        if (s.includes('06') || /\[\)>Y\d{13}|\[\)>YP/i.test(s) || /Y\d{13}P\d{8}/i.test(s)) {
            return '';
        }
        return 'Header Validation: Missing 06 format indicator in ISO envelope';
    }
    
    if (/^(?:Y\d{13}|P\d{8}|12V)/i.test(s)) {
        return '';
    }
    
    return 'Header Validation: Invalid Data Header (must start with [)>06 or valid GM structure)';
}

function parseGSRS(s){s=normalizeSeparators(s);let o=[];s.split(/<RS>/i).forEach(r=>{let a={VPPS:'',Part:'',DUNS:'',Trace:''};r.split(/<GS>/i).forEach(f=>{f=f.trim();if(f.startsWith('Y'))a.VPPS=f;else if(f.startsWith('P'))a.Part=f;else if(f.startsWith('12V'))a.DUNS=f;else if(f.startsWith('T'))a.Trace=f;});if(a.VPPS||a.Trace)o.push(a)});return o;}

// FIX #2: Correct substring boundaries so single-assembly counts don't capture trailing secondary assemblies
// Additionally locate Trace Codes after DUNS so malformed/shorter Trace Codes are reported with their true length

function parseScanditCountDriven(s,count){
    s=normalizeSeparators(s).replace(/^\[\)>06/,'').replace(/^\[\)<RS>06/,'');
    let resultBox=[],pos=0;
    while(resultBox.length<count && pos<s.length){
        let y=s.indexOf('Y',pos); if(y<0) break;
        let p=s.indexOf('P',y); 
        let d=s.indexOf('12V',p); 
        let t=s.indexOf('T',d);
        if(p<0||d<0||t<0) break;
        
        // GM Trace code is 16 characters after T (total 17 chars including T).
        // A new assembly VPPS 'Y' should only be recognized AFTER the 16-character trace code is completed (t + 17).
        let n=s.indexOf('Y',t+17); 
        if(n<0) n=s.length;
        
        let vppsVal=s.substring(y,p);
        let partVal=s.substring(p,d);
        let dunsVal=s.substring(d,t);
        let traceVal=s.substring(t,n);
        
        resultBox.push({VPPS:vppsVal,Part:partVal,DUNS:dunsVal,Trace:traceVal});
        pos=n;
    }
    let extra=''; 
    if(pos<s.length && s.substring(pos).trim().length>0){
        extra='Unexpected extra assembly data detected: ' + s.substring(pos).trim();
    }
    return {arr:resultBox,extra:extra};
}

function validateVpps(v) {
    if (!v || v === 'Y') return 'VPPS Missing';
    if (!/^Y\d{13}[A-Z]$/i.test(v)) {
        if (v.length !== 15) return 'VPPS length 14 required (Found ' + (v.length - 1) + ')';
        return 'VPPS format invalid - expected Y + 13 digits + 1 uppercase letter';
    }
    return '';
}

function validatePart(v){if(!v||v==='P')return'Part Number Missing - Expected field beginning with P';if(!/^P\d{8}$/.test(v))return'P + 8 digits required';return'';}

function validateDuns(v){let D=expectedDuns();if(!v||v==='12V')return'DUNS Missing';if(String(v).toUpperCase()!==D)return'Expected DUNS '+D;return'';}

function validateTrace(v,t){if(!v||v==='T'||v==='TY')return'Trace Code Missing - Expected field beginning with T';let x=v.substring(1);if(t==='Final'&&x.length!==16)return'Final Trace length 16 required';if(t==='Converter'&&x.length!==16)return'Converter Trace length 16 required';return'';}

function fieldLengthWithoutDi(n,v){if(!v)return 0;if(n==='DUNS')return v.length-3;return v.length-1;}

function getScanMode(){let m=document.querySelector('input[name="scanMode"]:checked');return m?m.value:'single';}

/* ============ PWA PERSISTENCE ============ */

let lastScanAssemblies=[];

function hasSeparators(s){s=normalizeSeparators(s);return s.includes('<GS>')||s.includes('<RS>');}

function parseContinuous(s,count){
    s=normalizeSeparators(s).replace(/^\[\)>06/,'').replace(/^\[\)<RS>06/,'').replace(/<GS>|<RS>/gi,'');
    let resultBox=[],pos=0;
    while(resultBox.length<count){
        let y=s.indexOf('Y',pos); if(y<0) break;
        let p=s.indexOf('P',y); let d=s.indexOf('12V',p); let t=s.indexOf('T',d);
        if(p<0||d<0||t<0) break;
        let n=s.indexOf('Y',t+1); if(n<0) n=s.length;
        resultBox.push({VPPS:s.substring(y,p),Part:s.substring(p,d),DUNS:s.substring(d,t),Trace:s.substring(t,n)});
        pos=n;
    }
    return resultBox;
}
// Dot-peen direct-part marks: one concatenated assembly, no separators, with
// characters between the fields that the continuous parser glues to the wrong
// field (e.g. Y9310100000000J1P1272638312V606038362T82262581869F0RL0).
// Only fires on the DPM shape; every other label keeps its existing parser.

function parseDPM(s){
    s=normalizeSeparators(s);
    if(hasSeparators(s)) return null;
    const cnt=(re)=>(s.match(re)||[]).length;
    if(cnt(/Y\d{13}[A-Z]/gi)!==1) return null;
    if(cnt(/P\d{8}/g)!==1) return null;
    if(cnt(/12V\d{9}/gi)!==1) return null;
    if(cnt(/T[A-Z0-9]{16}/gi)!==1) return null;
    const full=s.match(/^Y\d{13}[A-Z](.*?)P\d{8}(.*?)12V\d{9}(.*?)T[A-Z0-9]{16}$/i);
    if(!full) return null;
    if(!full[1]&&!full[2]&&!full[3]) return null; // contiguous: not DPM, old parser handles it
    const vpps=(s.match(/^Y\d{13}[A-Z]/i)||[])[0];
    const part=(s.match(/P\d{8}/)||[])[0];
    const duns=(s.match(/12V\d{9}/i)||[])[0];
    const trace=(s.match(/T[A-Z0-9]{16}$/i)||[])[0];
    if(!vpps||!part||!duns||!trace) return null;
    const pi=s.indexOf(part),di=s.indexOf(duns),ti=s.indexOf(trace);
    if(!(pi>0&&di>pi&&ti>di)) return null;
    return {VPPS:vpps.toUpperCase(),Part:part,DUNS:duns.toUpperCase(),Trace:trace.toUpperCase()};
}

function runLabelValidation(){
    if(+faCountInput.value > 1000 || +saCountInput.value > 1000){resultBox.innerHTML ='<div class="fail"><b>FAIL</b><br>Out of Range - Final and Converter values must be between 0 and 1000.</div>';return;}
    let errs=[],rows='',raw=scanInput.value;let exp=+faCountInput.value + +saCountInput.value;
    let h=validateHeader(raw);if(h)errs.push('Header Validation: '+h);
    let arr=[];
    let dpmA=parseDPM(raw);
    if(dpmA){
        // A dot-peen mark carries exactly one assembly: validate what is there.
        arr=[dpmA];exp=1;
    }else if(hasSeparators(raw)){
        arr=parseGSRS(raw);
    }else{
        let p=parseScanditCountDriven(raw,exp);
        arr=p.arr;
        if(arr.length===0){arr=parseContinuous(raw,exp);}
        if(p.extra) errs.push(p.extra);
    } 
    if(arr.length!==exp)errs.push('Expected Assemblies '+exp+' Found '+arr.length);
    arr.forEach((a,i)=>{
        let typ=i<+faCountInput.value?'Final':'Converter';
        let idx=i<+faCountInput.value?i+1:i-(+faCountInput.value)+1;
        let ep=document.getElementById((typ==='Final'?'fp':'cp')+idx);
        let ev=document.getElementById((typ==='Final'?'fv':'cv')+idx);
        if(document.getElementById('showExpected').checked && ep && ep.value && a.Part.replace(/^P/,'')!==ep.value)
            errs.push(`${typ} Part #${idx}: Expected ${ep.value} Found ${a.Part.replace(/^P/,'')}`);
        if(document.getElementById('showExpected').checked && ev && ev.value && !a.VPPS.substring(1).startsWith(ev.value.replace(/^Y/i, '')))
            errs.push(`${typ} VPPS #${idx}: Expected ${ev.value}`);
        
        [['VPPS',validateVpps(a.VPPS),a.VPPS],
         ['Part',validatePart(a.Part),a.Part],
         ['DUNS',validateDuns(a.DUNS),a.DUNS],
         ['Trace',validateTrace(a.Trace,typ),a.Trace]].forEach(r=>{
            if(r[1])errs.push(typ+' '+r[0]+': '+r[1]);
            let typLabel = typ === 'Final' ? 'FA' : 'SA';
            rows+=`<tr><td>${typLabel} ${r[0]}</td><td>${r[2]}</td><td>${fieldLengthWithoutDi(r[0],r[2])}</td><td>${r[1]?'FAIL':'PASS'}</td><td>${r[1]}</td></tr>`;
        });
    }); 
    let assemblies = [];
    arr.forEach((a,i)=>{
        let record = {
            type: i < +faCountInput.value ? 'Final' : 'Converter',
            vpps: a.VPPS,
            part: a.Part.replace(/^P/,''),
            trace: a.Trace,
            duns: a.DUNS
        };
        assemblies.push(record);
    });
    lastScanAssemblies=assemblies;

    if(errs.length === 0 && document.getElementById('checkDup').checked){
        let duplicateReason = '';
        assemblies.forEach(a=>{
            historyRecords.forEach(h=>{
                if(!h.assemblies) return;
                h.assemblies.forEach(old=>{
                    if(a.trace && old.trace === a.trace){
                        duplicateReason = 'Duplicate Trace Found | ' + a.trace + ' | Previous Scan: ' + h.timestamp;
                    }
                });
            });
        });
        if(duplicateReason){
            errs.push(duplicateReason);
        }
    }
    let result = errs.length ? 'FAIL' : 'PASS';
    let errorReason = errs.length ? errs.join(' | ') : '';
    if(raw.trim() !== ''){
        // FIX: never let history-save abort validation before the result is shown.
        try { saveHistory(result, raw, errorReason, assemblies); } catch(e){}
    }
    let manualMatchHtml = '';
    if (document.getElementById('showExpected').checked) {
        let matchItems = [];
        arr.forEach((a, i) => {
            let typ = i < +faCountInput.value ? 'Final' : 'Converter';
            let idx = i < +faCountInput.value ? i + 1 : i - (+faCountInput.value) + 1;
            let ep = document.getElementById((typ === 'Final' ? 'fp' : 'cp') + idx);
            let ev = document.getElementById((typ === 'Final' ? 'fv' : 'cv') + idx);
            let typLabel = typ === 'Final' ? 'FA' : 'SA';
            if (ep && ep.value) {
                let isMatch = a.Part.replace(/^P/, '') === ep.value;
                matchItems.push(`<div style="display:flex;justify-content:space-between;padding:6px 10px;background:${isMatch?'#e8f5e9':'#ffebee'};border-radius:8px;margin-top:6px;font-size:0.88rem;"><b>${typLabel} #${idx} Part #: Scanned ${a.Part.replace(/^P/,'')} == Expected ${ep.value}</b><span style="color:${isMatch?'#2e7d32':'#c62828'};font-weight:700;">${isMatch?'MATCH ✓':'MISMATCH ✕'}</span></div>`);
            }
            if (ev && ev.value) {
                let cleanExp = ev.value.replace(/^Y/i, '');
                let isMatch = a.VPPS.substring(1).startsWith(cleanExp);
                matchItems.push(`<div style="display:flex;justify-content:space-between;padding:6px 10px;background:${isMatch?'#e8f5e9':'#ffebee'};border-radius:8px;margin-top:6px;font-size:0.88rem;"><b>${typLabel} #${idx} VPPS Prefix: Scanned ${a.VPPS.substring(0,12)}... == Expected ${ev.value}</b><span style="color:${isMatch?'#2e7d32':'#c62828'};font-weight:700;">${isMatch?'MATCH ✓':'MISMATCH ✕'}</span></div>`);
            }
        });
        if (matchItems.length > 0) {
            manualMatchHtml = `<div style="background:#e3f2fd;border:1px solid #90caf9;border-radius:12px;padding:12px;margin-bottom:14px;text-align:left;"><div style="color:#0d47a1;font-weight:700;font-size:0.92rem;margin-bottom:4px;">🎯 MANUAL EXPECTED RULES VERIFICATION:</div>${matchItems.join('')}</div>`;
        }
    }
    if (getScanMode() === 'multi') {
        let fa = assemblies.find(a => a.type === 'Final') || {};
        if (errs.length === 0) {
            resultBox.innerHTML = `<div class="pass" style="padding:22px 16px;border-radius:20px;text-align:center;box-shadow:0 4px 12px rgba(30,126,52,0.25);margin-bottom:10px;">
                <div style="font-size:1.7rem;font-weight:900;margin-bottom:6px;">✓ PASS</div>
                <div style="font-size:1.05rem;font-weight:700;margin-bottom:6px;">100% GMW 15862 COMPLIANT</div>
                <div style="font-size:0.92rem;opacity:0.95;margin-bottom:10px;">FA Part #: <b>${fa.part || 'N/A'}</b> &bull; Trace: <b>${fa.trace || 'N/A'}</b></div>
                <div style="display:inline-block;background:#fff;color:#1e7e34;padding:5px 14px;border-radius:20px;font-size:0.82rem;font-weight:800;">⚡ Scan Recorded (🕒 #${historyRecords.length}) • Ready for Next Label...</div>
            </div>` + manualMatchHtml;
        } else {
            resultBox.innerHTML = `<div class="fail" style="padding:22px 16px;border-radius:20px;text-align:center;box-shadow:0 4px 12px rgba(203,36,49,0.25);margin-bottom:10px;">
                <div style="font-size:1.7rem;font-weight:900;margin-bottom:6px;">✕ FAIL</div>
                <div style="font-size:1.05rem;font-weight:700;margin-bottom:8px;">NON-COMPLIANT LABEL</div>
                <div style="font-size:0.92rem;font-weight:700;color:#900;background:#ffebee;padding:10px;border-radius:12px;margin-bottom:10px;">${errs.join('<br>')}</div>
                <div style="display:inline-block;background:#fff;color:#cb2431;padding:5px 14px;border-radius:20px;font-size:0.82rem;font-weight:800;">Scan Recorded (🕒 #${historyRecords.length})</div>
            </div>` + manualMatchHtml;
        }
    } else {
        resultBox.innerHTML = (errs.length ? '<div class="fail"><b>✕ FAIL — NON-COMPLIANT</b><br>' + errs.join('<br>') + '</div>' : '<div class="pass"><b>✓ PASS — 100% GMW 15862 COMPLIANT</b><br>All Assembly Rules &amp; Traces Verified</div>') + manualMatchHtml + '<table><tr><th>Field</th><th>Value</th><th>Length</th><th>Status</th><th>Reason</th></tr>' + rows + '</table>';
    }
}

function formatScanDisplay(s) {
    s = String(s || '').trim();
    // If it already contains explicit separators or control characters, normalize them
    if (s.includes('<RS>') || s.includes('\x1E') || s.includes('<GS>') || s.includes('\x1D')) {
        let formatted = s
            .replace(/[\x1E\u241E]/g, '<RS>')
            .replace(/[\x1D\u241D]/g, '<GS>')
            .replace(/[\x04\u2404]/g, '<EOT>')
            .replace(/[\x1F\u241F]/g, '<US>')
            .replace(/[\x1C\u241C]/g, '<FS>')
            .replace(/<0x1E>|␞/gi, '<RS>')
            .replace(/<0x1D>|␝/gi, '<GS>')
            .replace(/<0x4>|␄/gi, '<EOT>');
        if ((formatted.startsWith('[)>') || formatted.includes('<RS>06')) && !formatted.endsWith('<EOT>')) {
            formatted += '<EOT>';
        }
        return formatted;
    }
    
    // For Android or continuous scans lacking explicit ASCII control separators,
    // format them professionally into Barcode Data Decoder style ([)<RS>06<GS>...<RS><EOT>)
    let clean = s.replace(/^\[\)\>0?6?/, '');
    let resultBox = [];
    let pos = 0;
    while(pos < clean.length){
        let y = clean.indexOf('Y', pos); if(y < 0) break;
        let p = clean.indexOf('P', y); 
        let d = clean.indexOf('12V', p); 
        let t = clean.indexOf('T', d);
        if(p < 0 || d < 0 || t < 0) break;
        let n = clean.indexOf('Y', t+17); 
        if(n < 0) n = clean.length;
        
        let vpps = clean.substring(y, p);
        let part = clean.substring(p, d);
        let duns = clean.substring(d, t);
        let trace = clean.substring(t, n);
        
        resultBox.push(`<GS>${vpps}<GS>${part}<GS>${duns}<GS>${trace}`);
        pos = n;
    }
    
    if (resultBox.length > 0) {
        return '[)<RS>06' + resultBox.join('<RS>') + '<RS><EOT>';
    }
    return s;
}

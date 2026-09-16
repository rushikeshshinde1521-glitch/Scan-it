/* ==========================================================================
 * GM Scan Pro — js/config.js
 * --------------------------------------------------------------------------
 * App-wide constants and persisted settings (DUNS, server, history keys).
 * No DOM access and no dependencies — safe to load first.
 * Load order (plain <script> tags, NOT ES modules — this keeps the app working
 * from file:// and plain intranet hosting with no build step):
 *   config -> utils -> dpm -> parser -> scanner -> history -> settings -> ui
 * ========================================================================== */

const DUNS_PREFIX='12V';

const DEFAULT_DUNS_DIGITS='606038362';
/* ===== app settings (persisted on this device) ===== */

const APP_SETTINGS_KEY='gmscanpro_appsettings_v1';

let appSettings={duns:DEFAULT_DUNS_DIGITS,serverUrl:'',serverKey:'',serverMode:'off'};

try{const _s=JSON.parse(localStorage.getItem(APP_SETTINGS_KEY)||'{}');if(_s&&typeof _s==='object')appSettings=Object.assign(appSettings,_s);}catch(e){}
/* Migrate installs that stored the old full "12Vxxxxxxxxx" form: keep just the 9 digits. */

if(/^12V\d{9}$/i.test(String(appSettings.duns||'')))appSettings.duns=String(appSettings.duns).slice(3).toUpperCase();

function saveAppSettings(){try{localStorage.setItem(APP_SETTINGS_KEY,JSON.stringify(appSettings));}catch(e){}}

function expectedDunsDigits(){return String(appSettings.duns||DEFAULT_DUNS_DIGITS).toUpperCase().replace(/\D/g,'').slice(0,9);}

function expectedDuns(){return DUNS_PREFIX+expectedDunsDigits();}

function normalizeDunsInput(v){v=String(v||'').trim().toUpperCase().replace(/\s+/g,'');if(v.indexOf(DUNS_PREFIX)===0)v=v.slice(DUNS_PREFIX.length);return v.replace(/\D/g,'').slice(0,9);}

function validDunsFormat(v){return /^\d{9}$/.test(v);}

const HISTORY_KEY = 'gmscanpro_history';

const SETTINGS_KEY = 'gmscanpro_settings';

let historyRecords = [];

// Load persisted history + settings on startup (survives app close/reload).

const APP_WINDOW_NAME = 'gmScanProApp';

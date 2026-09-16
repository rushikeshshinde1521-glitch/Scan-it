# GM Scan Pro — app source (refactored for IT handoff)

Barcode / DataMatrix label validator PWA for GMW 15862. This refactor splits the
original single-file `index.html` into documented modules. **No behavior changed:**
the parser, validation rules, scan flows, and offline behavior are byte-for-byte
equivalent to the previous build (verified by automated diff + 25 logic tests).

## File layout

| File | What it is |
|---|---|
| `index.html` | Page structure only. No inline CSS or JS — just markup + `<script src>` tags. |
| `css/app.css` | All styles, extracted verbatim. |
| `js/engine-boot.js` | `<head>` bootstrap: points the vendored WASM decoder at its `.wasm` file and warms it up. Loaded right after `vendor/zxing_reader.js`. |
| `js/config.js` | App-wide constants + persisted settings (DUNS, server URL/key, history keys). No DOM, no dependencies — loads first. |
| `js/utils.js` | Small shared helpers: separator normalization, HTML escaping, toasts, device id, time formatting. |
| `js/dpm.js` | Dot-peen (needle-etched metal) image enhancement: box blur → 2× upscale → invert → contrast. |
| `js/parser.js` | GMW 15862 parsing + validation. Pure functions over scan text, plus `runLabelValidation()` which renders PASS/FAIL. Parser choice is unchanged: DPM shape → `parseDPM`, separators → `parseGSRS`, otherwise count-driven / continuous. |
| `js/scanner.js` | Decode engine + camera: live scan (native `BarcodeDetector` with WASM fallback), the DPM background sweep, the photo pipeline (multi-scale → DPM → last-resort), torch/autofocus, clipboard + scan-box input, scan beep. |
| `js/history.js` | On-device scan history: records, localStorage, CSV export, history tab + modals. |
| `js/settings.js` | Settings tab UI and the optional company-server duplicate check. |
| `js/ui.js` | App shell: tab switching, scan form, PWA install/standalone, service-worker registration, and the single startup sequence at the bottom of the file. |
| `sw.js` | Service worker — caches the app shell for full offline use. Bump `CACHE_NAME` on every release. |
| `server.py` | Sample company-server for shopfloor duplicate checking (see below). |
| `vendor/` | Third-party ZXing-C++ decoder (JS + WASM), vendored so the app works offline / on the intranet. Not our code — do not edit. |

Scripts are plain `<script>` tags in the documented load order
(`config → utils → dpm → parser → scanner → history → settings → ui`) —
**not** ES modules, so the app works from `file://` and plain intranet hosting
with no build step. Inline `onclick`/`onchange` handlers in the markup call the
same function names as before.

### Scan paths (unchanged)

- **Scan tab (paper labels):** decode attempts run label-first; DPM code is never touched, so label speed is unaffected.
- **Dot Pin tab (etched metal):** the same inputs, parser, validation, history and reset — only the decode order changes (DPM enhancement first, label attempts as fallback). Live camera runs a DPM sweep on every ~12th frame in the background without stalling the fast loop.

### What changed in this refactor (and nothing else)

1. One 2,291-line `index.html` → `index.html` + `css/app.css` + 9 documented `js/` modules.
2. Deleted 3 dead functions (`detect`, `startHtml5QrcodeLiveScanner`, `startZXingLiveScan`) — none was reachable.
3. `startCameraScan` now calls `startWasmLiveCamera()` directly (it previously went through a one-line alias to the same function).
4. The persisted-state IIFE is now a named `restorePersistedState()`, called once from the startup block in `js/ui.js` (same position in the init order as before).

## What's in the app (user-facing)

1. **App-like interface** — bottom tab bar: **Scan** | **Dot Pin** | **History** | **Settings**.
2. **DUNS is a setting** (Settings tab → DUNS field). The `12V` prefix is hard-coded; you enter just the 9 digits. Default is `606038362`.
3. **Company-server duplicate check** (optional) — Settings → Company Server:
   - **Off / Local only** (default): duplicates are caught against the phone's own scan history. Works fully offline.
   - **Local + Server**: on every validation the app also asks your company server "were these trace codes already scanned?" and shows a separate **"Server duplicate"** / **"Server check unavailable"** chip. If the server is unreachable, normal validation still runs — nothing breaks offline.
   - Fields: server URL (e.g. `https://yourserver:5000`) + optional API key.
   - **Test connection** button shows reachable / unauthorized / unreachable.
   - The app must be served over **https** to talk to the server (browser security). Use https on the server, or test with the phone's browser open to the server's `http://` address directly.

## For company IT (the server side)

`server.py` is a starting point you can hand to IT. They need to change 2 things
(both marked `TODO` in the file):

1. Set a real `API_KEY` (must match the key entered in the app's Settings).
2. Replace the in-memory `SEEN_TRACES` set with a lookup in your real database
   (there's a commented SQLite example to copy from).

Run it:
```
pip install flask
python server.py
```

The app talks to it with this contract:

- `GET /api/health` → `{"ok": true, "service": "gm-scan-pro-duplicates", "version": "1.0"}`
- `POST /api/duplicates/check`
  - sends: `{"traces": ["TABC...", ...], "device": "dev-...", "duns": "12V606038362"}`
  - replies: `{"duplicates": ["TABC..."]}` — only the already-seen ones
  - optional request header: `X-API-Key: <key>`
- `POST /api/scan` (optional logging hook — the app sends every validated scan here with `fa_trace` / `sa_trace`, which is how traces get indexed for other devices)

CORS headers are already included, so the phone's app can reach it.

## Deploying to your GitHub repo

The repo needs **all** of these files (new files since the last deploy are `css/` and `js/`):

- `index.html`, `sw.js` (replace existing)
- `css/app.css`
- `js/config.js`, `js/utils.js`, `js/dpm.js`, `js/parser.js`, `js/scanner.js`, `js/history.js`, `js/settings.js`, `js/ui.js`, `js/engine-boot.js`
- `vendor/` is unchanged — already in the repo

Commit them all, then fully close and reopen the installed PWA on each phone so the
new service worker (`gm-scan-pro-v12`) takes over.

## Server hookup later (when IT gives you the link)

Settings tab → **Company Server** → mode = **Local + Server** → paste the URL
(e.g. `https://scanapi.company.com:5000`) → API key → **Test connection**.
You should see "Reachable". Done — scan as normal.

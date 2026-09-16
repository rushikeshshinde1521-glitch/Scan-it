/* ==========================================================================
 * GM Scan Pro — js/engine-boot.js
 * --------------------------------------------------------------------------
 * Points the vendored ZXing-C++ WASM decoder at its .wasm file and
 * warms it up at page load so the first scan is fast.
 * Loaded in <head> right after vendor/zxing_reader.js.
 * window.__wasmEngineState: loading | ready | missing-script | error: ...
 * Load order (plain <script> tags, NOT ES modules — this keeps the app working
 * from file:// and plain intranet hosting with no build step):
 *   config -> utils -> dpm -> parser -> scanner -> history -> settings -> ui
 * ========================================================================== */

// Point the ZXing-C++ WebAssembly decoder at the vendored .wasm file,
// kept local so the app works offline and on the company intranet.
if (typeof ZXingWASM !== 'undefined' && ZXingWASM.setZXingModuleOverrides) {
    ZXingWASM.setZXingModuleOverrides({
        locateFile: function(path) {
            return path.endsWith('.wasm') ? 'vendor/zxing_reader.wasm' : path;
        }
    });
}

// Warm up the decoder engine at page load so the first scan is fast, and record
// the engine state so failures can tell "engine didn't load" apart from
// "engine loaded but couldn't read this photo".
window.__wasmEngineState = 'loading';
if (typeof ZXingWASM !== 'undefined' && ZXingWASM.readBarcodes) {
    ZXingWASM.readBarcodes(
        { width: 4, height: 4, data: new Uint8ClampedArray(64).fill(255) },
        { formats: ['DataMatrix'], maxNumberOfSymbols: 1 }
    ).then(() => { window.__wasmEngineState = 'ready'; })
     .catch(err => { window.__wasmEngineState = 'error: ' + String((err && err.message) || err); });
} else {
    window.__wasmEngineState = 'missing-script';
}

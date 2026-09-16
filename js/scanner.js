/* ==========================================================================
 * GM Scan Pro — js/scanner.js
 * --------------------------------------------------------------------------
 * Decode engine + camera. Live scanning (native BarcodeDetector with
 * WASM fallback), the DPM background sweep, the photo pipeline
 * (multi-scale attempts -> DPM attempts -> last-resort decode),
 * torch/autofocus, clipboard + scan-box input, scan feedback beep.
 * Load order (plain <script> tags, NOT ES modules — this keeps the app working
 * from file:// and plain intranet hosting with no build step):
 *   config -> utils -> dpm -> parser -> scanner -> history -> settings -> ui
 * ========================================================================== */

let currentFacingMode = "environment";

let isTorchOn = false;

let liveScanInterval = null;

let activeVideoStream = null;

let nativeBarcodeDetector = null;

let wasmVideoCanvas = null;
// Decode an ImageData through the WASM engine. Resolves to the decoded text or null.

function stopCameraScan(closeModal) {
    if (closeModal) {
        let modal = document.getElementById('cameraModal');
        if (modal) modal.classList.remove('open');
        document.body.style.overflow = '';
    }
    if (liveScanInterval) {
        clearInterval(liveScanInterval);
        liveScanInterval = null;
    }
    if (activeVideoStream) {
        try {
            activeVideoStream.getTracks().forEach(t => t.stop());
        } catch(e) {}
        activeVideoStream = null;
    }
    isTorchOn = false;
    let torchBtn = document.getElementById('torchBtn');
    if (torchBtn) torchBtn.innerHTML = "⚡ Light";
    let cameraStatus = document.getElementById('cameraStatus');
    if (cameraStatus) cameraStatus.innerHTML = '';
}

function handleCameraModalClick(event) {
    let modal = document.getElementById('cameraModal');
    if (event.target === modal) {
        stopCameraScan(true);
    }
}

function switchCameraFacing() {
    currentFacingMode = (currentFacingMode === "environment") ? "user" : "environment";
    showToast("Switching camera lens...");
    stopCameraScan(false);
    setTimeout(() => {
        startCameraScan();
    }, 350);
}

function applyAutoFocusToVideo(videoEl, forceToast) {
    let video = videoEl || document.querySelector('#qr-reader video') || document.getElementById('qr-reader-video');
    if (!video || !video.srcObject) return;
    try {
        const stream = video.srcObject;
        const tracks = stream.getVideoTracks();
        if (tracks && tracks.length > 0) {
            const track = tracks[0];
            const capabilities = track.getCapabilities ? track.getCapabilities() : {};
            const constraints = { advanced: [] };
            let advancedObj = {};
            if (capabilities.focusMode && Array.isArray(capabilities.focusMode)) {
                if (capabilities.focusMode.includes('continuous')) {
                    advancedObj.focusMode = 'continuous';
                } else if (capabilities.focusMode.includes('auto')) {
                    advancedObj.focusMode = 'auto';
                }
            }
            if (capabilities.focusDistance) {
                advancedObj.focusDistance = Math.max(capabilities.focusDistance.min || 0.05, 0.1);
            }
            if (capabilities.zoom && !forceToast) {
                let defaultZoom = Math.min(capabilities.zoom.max || 1.5, 1.35);
                advancedObj.zoom = Math.max(capabilities.zoom.min || 1.0, defaultZoom);
            }
            if (Object.keys(advancedObj).length > 0 && track.applyConstraints) {
                constraints.advanced.push(advancedObj);
                track.applyConstraints(constraints).then(() => {
                    if (forceToast) showToast("🎯 Auto-Focus locked on Data Matrix!");
                }).catch(() => {
                    if (forceToast) showToast("🎯 Focusing camera lens...");
                });
            } else if (forceToast) {
                showToast("🎯 Auto-Focus active on lens");
            }
        }
    } catch (e) {
        if (forceToast) showToast("🎯 Auto-Focus active on lens");
    }
}

function triggerAutoFocus() {
    let video = document.querySelector('#qr-reader video') || document.getElementById('qr-reader-video');
    if (!video || !video.srcObject) {
        showToast("Camera not active yet...");
        return;
    }
    applyAutoFocusToVideo(video, true);
}

function toggleCameraTorch() {
    let video = document.querySelector('#qr-reader video') || document.getElementById('qr-reader-video');
    if (!video || !video.srcObject) {
        showToast("Camera not active yet...");
        return;
    }
    try {
        const stream = video.srcObject;
        const tracks = stream.getVideoTracks();
        if (tracks && tracks.length > 0) {
            const track = tracks[0];
            const capabilities = track.getCapabilities ? track.getCapabilities() : {};
            if (capabilities.torch) {
                isTorchOn = !isTorchOn;
                track.applyConstraints({ advanced: [{ torch: isTorchOn }] }).then(() => {
                    let btn = document.getElementById('torchBtn');
                    if (btn) btn.innerHTML = isTorchOn ? "⚡ Light ON" : "⚡ Light";
                    showToast(isTorchOn ? "⚡ Flashlight ON" : "⚡ Flashlight OFF");
                }).catch(() => {
                    showToast("Flashlight not supported on this device");
                });
            } else {
                showToast("Flashlight not supported on this lens");
            }
        }
    } catch (e) {
        showToast("Flashlight not available");
    }
}

function getLocalFileNoticeCard() {
    return `<div style="color:#0f385c;background:#eaf3fc;padding:14px;border-radius:10px;font-size:0.92rem;text-align:left;line-height:1.45;border:1px solid #bce0fd;margin-bottom:14px;">
                <b>📱 iOS OneDrive / Edge Local File Notice:</b><br>
                Apple iOS security blocks live video streaming (<code>getUserMedia</code>) inside app previewers and local files (<code>edge://...</code> / <code>file://...</code>).<br><br>
                👉 <b>Please tap "📸 Launch iPhone Photo Scan" below!</b><br>
                It opens your iPhone's camera directly to snap &amp; decode the Data Matrix label instantly 100% offline!
            </div>
            <button class="tool-btn btn-primary-tool" style="padding:14px 22px;font-size:1.05rem;margin-top:4px;" onclick="triggerPhotoScan(); stopCameraScan(true);" type="button">
                📸 Launch iPhone Photo Scan
            </button>`;
}

function checkLocalFileCameraRestriction() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        document.getElementById('cameraStatus').innerHTML = getLocalFileNoticeCard();
        return true;
    }
    return false;
}

function startCameraScan() {
    let modal = document.getElementById('cameraModal');
    if (modal) modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    
    if (checkLocalFileCameraRestriction()) return;
    
    document.getElementById('cameraStatus').innerHTML = '<div style="color:var(--muted);font-size:0.9rem;">Activating live camera continuous auto-scanner...</div>';

    // 1. If native OS BarcodeDetector is supported in browser, use hardware-accelerated continuous live stream scanning!
    if ('BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        startNativeLiveVideoScanner();
        return;
    }

    // 2. Otherwise use the ZXing-C++ WASM live scanner
    startWasmLiveCamera();
}

// ---- ZXing-C++ WebAssembly decode engine (fast, replaces ZXing-JS / html5-qrcode) ----

function wasmDecodeImageData(imageData, opts) {
    opts = opts || {};
    if (typeof ZXingWASM === 'undefined' || !ZXingWASM.readBarcodes) {
        return Promise.resolve(null);
    }
    return ZXingWASM.readBarcodes(imageData, {
        formats: ['DataMatrix', 'Code128'],
        tryHarder: !!opts.harder,
        tryRotate: true,
        tryDenoise: !!opts.denoise,
        maxNumberOfSymbols: 1
    }).then(results => {
        if (results && results.length > 0 && results[0].text) return results[0].text;
        return null;
    }).catch(() => null);
}
// DPM background sweep for live camera (Dot Pin tab): runs the same dot-peen
// enhancement (macro region + 4 overlapping tiles) on a captured frame.
// At most one sweep runs at a time; the fast raw-decode loop keeps running
// between sweeps, so the camera never stalls waiting on it.

let dpmSweepBusy = false;

function runDpmLiveSweep(imageData) {
    if (dpmSweepBusy || liveScanInterval === null) return Promise.resolve(null);
    dpmSweepBusy = true;
    const w = imageData.width, h = imageData.height;
    const src = document.createElement('canvas');
    src.width = w; src.height = h;
    try { src.getContext('2d').putImageData(imageData, 0, 0); }
    catch (e) { dpmSweepBusy = false; return Promise.resolve(null); }
    // Same regions as the photo-path DPM attempts, as fractions of the frame.
    const regions = [
        { x: 0.12, y: 0.40, rw: 0.50, rh: 0.50 }, // macro close-up
        { x: 0,    y: 0,    rw: 2 / 3, rh: 2 / 3 }, // 2x2 overlapping tiles
        { x: 1 / 3, y: 0,   rw: 2 / 3, rh: 2 / 3 },
        { x: 0,    y: 1 / 3, rw: 2 / 3, rh: 2 / 3 },
        { x: 1 / 3, y: 1 / 3, rw: 2 / 3, rh: 2 / 3 },
    ];
    let ri = 0;
    const done = (text) => { dpmSweepBusy = false; return text; };
    const next = () => {
        if (liveScanInterval === null || ri >= regions.length) return Promise.resolve(done(null));
        const r = regions[ri++];
        const cw = Math.max(120, Math.round(w * r.rw)), ch = Math.max(120, Math.round(h * r.rh));
        const cx = Math.max(0, Math.round(w * r.x)), cy = Math.max(0, Math.round(h * r.y));
        let c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        c.getContext('2d').drawImage(src, cx, cy, cw, ch, 0, 0, cw, ch);
        try { c = dpmEnhanceCanvas(c); }
        catch (e) { return next(); }
        let id = null;
        try { id = c.getContext('2d').getImageData(0, 0, c.width, c.height); }
        catch (e) { return next(); }
        return wasmDecodeImageData(id, { denoise: true }).then(text => text ? done(text) : next());
    };
    return next();
}

// Continuous live-scan loop: grabs video frames and decodes them with the WASM
// engine. Chained (never overlapping) so the CPU stays free for the camera.

let dpmLiveFrameCounter = 0;

function startWasmFrameLoop(videoEl) {
    if (liveScanInterval) clearInterval(liveScanInterval);
    if (!wasmVideoCanvas) wasmVideoCanvas = document.createElement('canvas');
    let wasmBusy = false;
    let wasmWarned = false;
    const loop = () => {
        if (liveScanInterval === null) return; // scanner stopped
        if (typeof ZXingWASM === 'undefined' || !ZXingWASM.readBarcodes) {
            if (!wasmWarned) {
                wasmWarned = true;
                window.__wasmEngineState = 'missing-script';
                document.getElementById('cameraStatus').innerHTML = '<div style="color:var(--red);font-size:0.9rem;">\u26a0\ufe0f Scanner engine didn\'t load &mdash; refresh the page and try again.</div>';
            }
            liveScanInterval = setTimeout(loop, 500);
            return;
        }
        if (!videoEl || videoEl.readyState !== videoEl.HAVE_ENOUGH_DATA || wasmBusy) {
            liveScanInterval = setTimeout(loop, 90);
            return;
        }
        wasmBusy = true;
        const armNext = (delay) => {
            wasmBusy = false;
            if (liveScanInterval !== null) liveScanInterval = setTimeout(loop, delay || 30);
        };
        let imageData = null;
        try {
            const vw = videoEl.videoWidth || 1280, vh = videoEl.videoHeight || 720;
            const scale = Math.min(1, 960 / vw);
            wasmVideoCanvas.width = Math.max(320, Math.round(vw * scale));
            wasmVideoCanvas.height = Math.max(240, Math.round(vh * scale));
            const ctx = wasmVideoCanvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(videoEl, 0, 0, wasmVideoCanvas.width, wasmVideoCanvas.height);
            imageData = ctx.getImageData(0, 0, wasmVideoCanvas.width, wasmVideoCanvas.height);
        } catch (e) { imageData = null; }
        if (!imageData) { armNext(90); return; }
        wasmDecodeImageData(imageData, {}).then(text => {
            if (text) {
                stopCameraScan(true);
                onPhotoDecodeSuccess(text);
                return;
            }
            // Dot Pin tab: every ~12th frame gets the dot-peen enhancement sweep
            // in the background while the fast loop keeps running. The raw decode
            // above stays as the cheap path (paper labels still work here too).
            if (document.body.dataset.scanmode === 'dpm') {
                dpmLiveFrameCounter++;
                if (dpmLiveFrameCounter % 12 === 0 && !dpmSweepBusy) {
                    runDpmLiveSweep(imageData).then(dpmText => {
                        if (dpmText && liveScanInterval !== null) {
                            stopCameraScan(true);
                            onPhotoDecodeSuccess(dpmText);
                        }
                    });
                }
            }
            armNext();
        });
    };
    liveScanInterval = setTimeout(loop, 120);
}

// WASM live camera: used whenever the native BarcodeDetector path is unavailable.

function startWasmLiveCamera() {
    if (checkLocalFileCameraRestriction()) {
        document.getElementById('cameraStatus').innerHTML = getLocalFileNoticeCard();
        return;
    }
    let container = document.getElementById('qr-reader');
    container.innerHTML = '<video id="qr-reader-video" autoplay playsinline muted style="width:100%;min-height:260px;object-fit:cover;border-radius:8px;background:#000;"></video>';
    let videoEl = document.getElementById('qr-reader-video');
    const constraints = {
        video: {
            facingMode: { ideal: currentFacingMode || "environment" },
            width: { ideal: 1280, min: 720 },
            height: { ideal: 720, min: 480 },
            focusMode: { ideal: "continuous" },
            advanced: [
                { focusMode: "continuous" },
                { focusMode: "auto" }
            ]
        }
    };
    document.getElementById('cameraStatus').innerHTML = '<div style="color:var(--muted);font-size:0.9rem;">Activating camera...</div>';
    navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
            activeVideoStream = stream;
            videoEl.srcObject = stream;
            videoEl.play();
            const dpmModeNow = document.body.dataset.scanmode === 'dpm';
            document.getElementById('cameraStatus').innerHTML = '<div style="color:var(--green);font-size:0.88rem;font-weight:600;">&#127919; Scanner Active &bull; Auto-Scanning ' + (dpmModeNow ? 'dot-peen marks' : 'Data Matrix code') + '...</div>';
            setTimeout(() => applyAutoFocusToVideo(videoEl), 400);
            setTimeout(() => applyAutoFocusToVideo(videoEl), 1500);
            startWasmFrameLoop(videoEl);
        })
        .catch(err => {
            document.getElementById('cameraStatus').innerHTML = '<div style="color:var(--red);font-size:0.9rem;">&#9888;&#65039; Camera unavailable. Check permission or use Photo Scan.</div>';
        });
}

function startNativeLiveVideoScanner() {
    let container = document.getElementById('qr-reader');
    container.innerHTML = '<video id="qr-reader-video" autoplay playsinline muted style="width:100%;min-height:260px;object-fit:cover;border-radius:8px;background:#000;"></video>';
    let videoEl = document.getElementById('qr-reader-video');

    const constraints = {
        video: {
            facingMode: { ideal: currentFacingMode || "environment" },
            width: { ideal: 1280, min: 720 },
            height: { ideal: 720, min: 480 },
            focusMode: { ideal: "continuous" },
            advanced: [
                { focusMode: "continuous" },
                { focusMode: "auto" }
            ]
        }
    };

    navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
            activeVideoStream = stream;
            videoEl.srcObject = stream;
            videoEl.play();
            document.getElementById('cameraStatus').innerHTML = '<div style="color:var(--green);font-size:0.88rem;font-weight:600;">🎯 Native OS Scanner Active &bull; Auto-Scanning Data Matrix code...</div>';
            setTimeout(() => applyAutoFocusToVideo(videoEl), 400);
            setTimeout(() => applyAutoFocusToVideo(videoEl), 1500);

            if (!nativeBarcodeDetector) {
                try {
                    nativeBarcodeDetector = new BarcodeDetector({
                        formats: ['data_matrix', 'code_128']
                    });
                } catch(e) {
                    nativeBarcodeDetector = null;
                }
            }

            // Chained detect loop: a new frame is decoded only after the previous
            // detect() finished. The old 50ms setInterval stacked overlapping
            // decodes and thrashed the CPU, which slowed time-to-first-scan.
            if (liveScanInterval) clearInterval(liveScanInterval);
            let nativeDetectBusy = false;
            const runNativeDetect = () => {
                if (liveScanInterval === null) return; // scanner stopped
                if (!videoEl || videoEl.readyState !== videoEl.HAVE_ENOUGH_DATA || nativeDetectBusy) {
                    liveScanInterval = setTimeout(runNativeDetect, 90);
                    return;
                }
                nativeDetectBusy = true;
                const armNext = (delay) => {
                    nativeDetectBusy = false;
                    if (liveScanInterval !== null) liveScanInterval = setTimeout(runNativeDetect, delay || 25);
                };
                if (nativeBarcodeDetector) {
                    nativeBarcodeDetector.detect(videoEl)
                        .then(barcodes => {
                            if (barcodes && barcodes.length > 0) {
                                let text = barcodes[0].rawValue;
                                if (text) {
                                    stopCameraScan(true);
                                    onPhotoDecodeSuccess(text);
                                    return;
                                }
                            }
                            armNext();
                        })
                        .catch(() => armNext(90));
                } else {
                    // No native BarcodeDetector (e.g. iOS Safari): switch this
                    // video element over to the ZXing-C++ WASM frame loop.
                    startWasmFrameLoop(videoEl);
                    return;
                }
            };
            liveScanInterval = setTimeout(runNativeDetect, 120);
        })
        .catch(err => {
            startWasmLiveCamera();
        });
}

function triggerPhotoScan() {
    let imgInput = document.getElementById('imageInput');
    if (imgInput) imgInput.click();
}

function handleImageScan(event) {
    let file = event.target.files[0];
    if (!file) return;

    showToast("Decoding GM Data Matrix from photo...");

    let reader = new FileReader();
    reader.onload = function(e) {
        let dataUrl = e.target.result;
        let img = new Image();
        img.onload = async function() {
            if ('BarcodeDetector' in window) {
                try {
                    let detector = new BarcodeDetector({
                        formats: ['data_matrix', 'code_128']
                    });
                    let barcodes = await detector.detect(img);
                    if (barcodes && barcodes.length > 0) {
                        onPhotoDecodeSuccess(barcodes[0].rawValue);
                        return;
                    }
                    let c = document.createElement('canvas');
                    let ctx = c.getContext('2d');
                    c.width = img.width * 2;
                    c.height = img.height * 2;
                    ctx.drawImage(img, 0, 0, c.width, c.height);
                    barcodes = await detector.detect(c);
                    if (barcodes && barcodes.length > 0) {
                        onPhotoDecodeSuccess(barcodes[0].rawValue);
                        return;
                    }
                    let cropW = Math.round(img.width * 0.65);
                    let cropH = Math.round(img.height * 0.65);
                    let cropY = Math.round((img.height - cropH) / 2);
                    c.width = cropW * 2;
                    c.height = cropH * 2;
                    ctx.drawImage(img, 0, cropY, cropW, cropH, 0, 0, c.width, c.height);
                    barcodes = await detector.detect(c);
                    if (barcodes && barcodes.length > 0) {
                        onPhotoDecodeSuccess(barcodes[0].rawValue);
                        return;
                    }
                    let cropX = Math.round((img.width - cropW) / 2);
                    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, c.width, c.height);
                    barcodes = await detector.detect(c);
                    if (barcodes && barcodes.length > 0) {
                        onPhotoDecodeSuccess(barcodes[0].rawValue);
                        return;
                    }
                } catch(err) {}
            }
            runWasmMultiScaleDecoder(img, file, dataUrl);
        };
        img.onerror = function() {
            runWasmFinalAttempt(file, dataUrl);
        };
        img.src = dataUrl;
    };
    reader.readAsDataURL(file);
}

// DPM (dot-peen / needle-etched metal) helpers. A dot-peen Data Matrix is a
// grid of separated light dots on dark metal: the binarizer sees dashes, not
// solid modules, so the finder pattern never locks. Verified fix against a
// real dot-peen pipe mark: merge the dots with a small box blur, upscale 2x,
// invert (light dots -> dark), then strong contrast. The C++ engine's built-in
// tryDenoise alone cannot read this mark. Pure canvas/JS: works in all Safari.

function runWasmMultiScaleDecoder(img, file, dataUrl) {
    // ZXing-C++ WebAssembly engine (replaces the old ZXing-JS decoder).
    if (typeof ZXingWASM === 'undefined' || !ZXingWASM.readBarcodes) {
        window.__wasmEngineState = 'missing-script';
        runWasmFinalAttempt(file, dataUrl);
        return;
    }

    let tasks = [];
    // GM labels carry the Data Matrix on the LEFT: try left regions first so the
    // common case succeeds on the earliest attempts (fastest time-to-scan).
    // Widths are capped at 1600px: a 12MP phone photo downscaled still resolves
    // every module, and each attempt runs several times faster than full-res.
    // 1. Left crops (most likely)
    [1200, 800].forEach(w => {
        tasks.push({ width: w, region: 'left', contrast: false });
        tasks.push({ width: w, region: 'label-left-macro', contrast: false });
    });
    // 2. Full image
    [1600, 1100, 800].forEach(w => {
        tasks.push({ width: w, region: 'full', contrast: false });
    });
    // 3. Center + bottom-left crops
    [1100, 750].forEach(w => {
        tasks.push({ width: w, region: 'center', contrast: false });
        tasks.push({ width: w, region: 'bottom-left', contrast: false });
    });
    // 4. High-contrast thresholded attempts for glare / shadows / JPEG artifacts
    [1000, 750].forEach(w => {
        tasks.push({ width: w, region: 'left', contrast: true });
        tasks.push({ width: w, region: 'full', contrast: true });
    });
    // 5. DPM dot-peen (needle-etched curved metal pipe): the C++ engine's built-in
    // morphological denoise bridges needle dots - no slow JS preprocessing needed
    [900, 700].forEach(w => {
        tasks.push({ width: w, region: 'label-left-macro', contrast: false, denoise: true });
        tasks.push({ width: w, region: 'left', contrast: false, denoise: true });
    });
    // 6. DPM dot-peen, full enhancement (blur + 2x upscale + invert + contrast).
    // Verified on a real dot-peen pipe mark that steps 1-5 cannot read. Runs
    // last: printed labels already decoded above, so this costs nothing unless
    // every earlier attempt failed.
    [900].forEach(w => {
        tasks.push({ width: w, region: 'label-left-macro', dpm: true });
        // Dot-peen marks can sit anywhere in the frame: sweep 4 overlapping
        // tiles. (The label-oriented 'left'/'full' crops clip the mark or wash
        // it out under glare, so they are not used for DPM.)
        for (let ti = 0; ti < 4; ti++) tasks.push({ width: w, region: 'dpm-tile-' + ti, dpm: true });
        // Last resort: whole frame with maximum effort.
        tasks.push({ width: w, region: 'full', dpm: true, harder: true });
    });
    // Dot Pin tab: try the dot-peen enhancement FIRST, since it is the expected
    // input there; the paper-label attempts stay as fallback. The Scan tab keeps
    // the label-first order, so label scans are never delayed by DPM work.
    if (document.body.dataset.scanmode === 'dpm') {
        tasks = tasks.filter(t => t.dpm).concat(tasks.filter(t => !t.dpm));
    }

    let tryTask = function(idx) {
        if (idx >= tasks.length) {
            runWasmFinalAttempt(file, dataUrl);
            return;
        }
        let task = tasks[idx];
        if (task.width > img.width && idx > 0) {
            tryTask(idx + 1);
            return;
        }

        let scale = Math.min(1, task.width / img.width);
        let canvas = document.createElement('canvas');
        let ctx = canvas.getContext('2d');

        let cropX = 0, cropY = 0, cropW = img.width, cropH = img.height;
        if (task.region === 'center') {
            cropW = Math.round(img.width * 0.65);
            cropH = Math.round(img.height * 0.65);
            cropX = Math.round((img.width - cropW) / 2);
            cropY = Math.round((img.height - cropH) / 2);
        } else if (task.region === 'left') {
            cropW = Math.round(img.width * 0.62);
            cropH = Math.round(img.height * 0.8);
            cropX = 0;
            cropY = Math.round(img.height * 0.1);
        } else if (task.region === 'bottom-left') {
            cropW = Math.round(img.width * 0.62);
            cropH = Math.round(img.height * 0.7);
            cropX = 0;
            cropY = Math.round(img.height * 0.3);
        } else if (task.region === 'label-left-macro') {
            cropW = Math.round(img.width * 0.50);
            cropH = Math.round(img.height * 0.50);
            cropX = Math.round(img.width * 0.12);
            cropY = Math.round(img.height * 0.40);
        } else if (task.region.indexOf('dpm-tile-') === 0) {
            // 2x2 overlapping tiles (each 2/3 of the frame, 1/3 overlap) so a
            // dot-peen mark anywhere in the photo lands whole in some tile.
            const ti = parseInt(task.region.slice(9), 10) || 0;
            const col = ti % 2, row = Math.floor(ti / 2) % 2;
            cropW = Math.round(img.width * (0.5 + 1 / 6));
            cropH = Math.round(img.height * (0.5 + 1 / 6));
            cropX = Math.round(col * (img.width - cropW));
            cropY = Math.round(row * (img.height - cropH));
        }

        canvas.width = Math.max(100, Math.round(cropW * scale));
        canvas.height = Math.max(100, Math.round(cropH * scale));
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

        if (task.contrast) {
            try {
                let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                let d = imgData.data;
                for (let i = 0; i < d.length; i += 4) {
                    let gray = (d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114);
                    let val = gray < 135 ? 0 : 255;
                    d[i] = d[i+1] = d[i+2] = val;
                }
                ctx.putImageData(imgData, 0, 0);
            } catch(e) {}
        }
        if (task.dpm) {
            try {
                canvas = dpmEnhanceCanvas(canvas);
                ctx = canvas.getContext('2d');
            } catch(e) {}
        }
        let imageData;
        try {
            imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch (e) {
            tryTask(idx + 1);
            return;
        }
        wasmDecodeImageData(imageData, { denoise: task.denoise || task.dpm, harder: task.harder }).then(text => {
            if (text) {
                onPhotoDecodeSuccess(text);
            } else {
                tryTask(idx + 1);
            }
        });
    };

    tryTask(0);
}

function runWasmFinalAttempt(file, imgUrl) {
    // (name kept for callers) Final fallback: whole image through the WASM
    // engine with extra effort instead of the old html5-qrcode file scan.
    if (typeof ZXingWASM === 'undefined' || !ZXingWASM.readBarcodes) {
        window.__wasmEngineState = 'missing-script';
        showDecodeFail();
        return;
    }
    let img = new Image();
    img.onload = function() {
        try {
            const scale = Math.min(1, 1600 / img.width);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(100, Math.round(img.width * scale));
            canvas.height = Math.max(100, Math.round(img.height * scale));
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            ZXingWASM.readBarcodes(imageData, {
                formats: ['DataMatrix', 'Code128'],
                tryHarder: true,
                tryRotate: true,
                tryDenoise: true,
                maxNumberOfSymbols: 1
            }).then(results => {
                if (results && results.length > 0 && results[0].text) {
                    onPhotoDecodeSuccess(results[0].text);
                } else {
                    showDecodeFail();
                }
            }).catch(() => showDecodeFail());
        } catch (e) {
            showDecodeFail();
        }
    };
    img.onerror = function() { showDecodeFail(); };
    img.src = imgUrl;
}

function showDecodeFail() {
    let engineState = window.__wasmEngineState || 'unknown';
    let engineBroken = (engineState === 'missing-script') || (engineState.indexOf('error') === 0);
    let msg;
    if (engineState === 'missing-script') {
        msg = "⚠️ Scanner engine didn't load - refresh the page and try again";
    } else if (engineState.indexOf('error') === 0) {
        msg = "⚠️ Scanner engine failed to start - refresh the page and try again";
    } else {
        msg = "⚠️ Could not read Data Matrix in photo (try closer photo or good lighting)";
    }
    showToast(msg);
    let scanBox = document.getElementById('scan');
    if (scanBox && !scanBox.value) {
        scanBox.placeholder = engineBroken
            ? "Scanner engine didn't load - refresh the page"
            : "Could not decode photo — try closer/clearer photo or Live Camera";
    }
}

function onPhotoDecodeSuccess(text) {
    stopCameraScan(true);
    let scanBox = document.getElementById('scan');
    if (scanBox) {
        scanBox.value = formatScanDisplay(text);
        showToast("GM Data Matrix detected & loaded!");
        validateAndShow();
    }
}

async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            document.getElementById('scan').value = formatScanDisplay(text);
            showToast("Pasted — Hit button validate!");
        } else {
            showToast("Clipboard is empty");
        }
    } catch (err) {
        showToast("Please tap inside the box and paste (Cmd/Ctrl+V)");
    }
}

function handleTouchScreenPaste(event) {
    let pastedText = '';
    if (event.clipboardData && event.clipboardData.getData) {
        pastedText = event.clipboardData.getData('text/plain');
    } else if (window.clipboardData && window.clipboardData.getData) {
        pastedText = window.clipboardData.getData('Text');
    }
    if (pastedText) {
        event.preventDefault();
        let scanBox = document.getElementById('scan');
        if (scanBox) {
            scanBox.value = formatScanDisplay(pastedText);
            showToast("Pasted scan data!");
            validateAndShow();
        }
    }
}

let inputDebounce = null;

function handleScanInput(event) {
    if (inputDebounce) clearTimeout(inputDebounce);
    inputDebounce = setTimeout(() => {
        let scanBox = document.getElementById('scan');
        if (!scanBox || !scanBox.value) return;
        let currentVal = scanBox.value;
        if (currentVal.includes('\x1E') || currentVal.includes('\x1D') || currentVal.includes('␞') || currentVal.includes('␝')) {
            let formatted = formatScanDisplay(currentVal);
            if (formatted !== currentVal) {
                scanBox.value = formatted;
            }
        }
        if (currentVal.trim().length >= 15) {
            validateAndShow();
        }
    }, 120);
}

function playScanFeedback(result) {
    try {
        if (navigator.vibrate) {
            if (result === 'PASS') navigator.vibrate([40]);
            else navigator.vibrate([80, 50, 80]);
        }
        let ctx = new (window.AudioContext || window.webkitAudioContext)();
        let osc = ctx.createOscillator();
        let gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        if (result === 'PASS') {
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            osc.start();
            osc.stop(ctx.currentTime + 0.12);
        } else {
            osc.frequency.setValueAtTime(300, ctx.currentTime);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            osc.start();
            osc.stop(ctx.currentTime + 0.25);
        }
    } catch(e) {}
}

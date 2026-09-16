/* ==========================================================================
 * GM Scan Pro — js/dpm.js
 * --------------------------------------------------------------------------
 * Dot-peen (needle-etched metal) image enhancement: box blur + 2x
 * upscale + invert + contrast. Used by the Dot Pin photo/live paths.
 * Load order (plain <script> tags, NOT ES modules — this keeps the app working
 * from file:// and plain intranet hosting with no build step):
 *   config -> utils -> dpm -> parser -> scanner -> history -> settings -> ui
 * ========================================================================== */

function boxBlurImageData(imgData, r) {
    const d = imgData.data, w = imgData.width, h = imgData.height;
    const tmp = new Uint8ClampedArray(d.length);
    const n = r * 2 + 1;
    let x, y, i;
    for (y = 0; y < h; y++) {
        let rs = 0, gs = 0, bs = 0;
        const row = y * w;
        for (x = -r; x <= r; x++) {
            const c = x < 0 ? 0 : (x >= w ? w - 1 : x);
            i = (row + c) * 4; rs += d[i]; gs += d[i+1]; bs += d[i+2];
        }
        for (x = 0; x < w; x++) {
            i = (row + x) * 4;
            tmp[i] = rs / n; tmp[i+1] = gs / n; tmp[i+2] = bs / n; tmp[i+3] = 255;
            const xo = x - r < 0 ? 0 : x - r, xi = x + r + 1 >= w ? w - 1 : x + r + 1;
            const o = (row + xo) * 4, ii = (row + xi) * 4;
            rs += d[ii] - d[o]; gs += d[ii+1] - d[o+1]; bs += d[ii+2] - d[o+2];
        }
    }
    for (x = 0; x < w; x++) {
        let rs = 0, gs = 0, bs = 0;
        for (y = -r; y <= r; y++) {
            const c = y < 0 ? 0 : (y >= h ? h - 1 : y);
            i = (c * w + x) * 4; rs += tmp[i]; gs += tmp[i+1]; bs += tmp[i+2];
        }
        for (y = 0; y < h; y++) {
            i = (y * w + x) * 4;
            d[i] = rs / n; d[i+1] = gs / n; d[i+2] = bs / n;
            const yo = y - r < 0 ? 0 : y - r, yi = y + r + 1 >= h ? h - 1 : y + r + 1;
            const o = (yo * w + x) * 4, ii = (yi * w + x) * 4;
            rs += tmp[ii] - tmp[o]; gs += tmp[ii+1] - tmp[o+1]; bs += tmp[ii+2] - tmp[o+2];
        }
    }
}

function dpmEnhanceCanvas(canvas) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const id = ctx.getImageData(0, 0, w, h);
    boxBlurImageData(id, 3);
    boxBlurImageData(id, 3);
    ctx.putImageData(id, 0, 0);
    const big = document.createElement('canvas');
    big.width = w * 2; big.height = h * 2;
    const bctx = big.getContext('2d');
    bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(canvas, 0, 0, big.width, big.height);
    const bid = bctx.getImageData(0, 0, big.width, big.height);
    const d = bid.data, n = d.length, cnt = n / 4;
    let sum = 0, i;
    for (i = 0; i < n; i += 4) {
        const v = 255 - (d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114);
        d[i] = d[i+1] = d[i+2] = v; sum += v;
    }
    const mean = sum / cnt;
    for (i = 0; i < n; i += 4) {
        const v = mean + 3 * (d[i] - mean);
        d[i] = d[i+1] = d[i+2] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    bctx.putImageData(bid, 0, 0);
    return big;
}

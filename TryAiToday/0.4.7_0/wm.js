// wm.js — watermark-removal helpers injected into the Flow page (world: MAIN) via
// chrome.scripting.executeScript. Augments globalThis.__inj (defined in inject.js).
//
// Same constraints as inject.js:
// - Kept un-obfuscated (the production build copies this file verbatim). Each helper
//   on __inj is stringified by executeScript and run inside the Flow page, which has
//   none of the bundle's scope — so every function is fully self-contained (no shared
//   closures, no outer consts). Watermark templates are therefore inlined as base64
//   inside each function body rather than passed as args or loaded as assets.
//
// How it works: Flow stamps the Gemini "sparkle" logo alpha-blended onto the bottom-
// right corner. Given the logo's known per-pixel alpha (a grayscale template), the
// blend is reversible:  original = (observed − alpha·logoColor) / (1 − alpha).
// Placement is found by normalized cross-correlation (NCC) of the template against
// the image luminance, so a drifted/repositioned logo is still located.
(function () {

  // Clean a single image: load it, reverse-blend the corner logo, return a PNG blob
  // URL (lossless — no second JPEG pass, so 2K/upscaled quality is preserved).
  // Returns { blobUrl, removed } or { error }.
  globalThis.__inj.cleanImageBlob = async function (u, logoVersion) {
    // 2026 sparkle watermark templates (added alongside the originals).
    var TPL96_2026 = "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";
    var TPL48_2026 = "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAHHElEQVR4nJ1YyXPaPBRHlm2g2AazNi3NhWUm00Pv/f+PvXbSxpTJNGky2A4QL0OJF30THigPySbp905epLf83iqRCiJCCGOs8mYiu/XVavXLly+apn379m273Z5e/KoUBb+8URtCCF5vmman02k2m5Zl4b8CceaMsbI1okJlssnxfkHvVqtlmmaj0Wi1WoLGhYL/ASF5PzvsxL/w87t371qtVpIkaZo2m816vc52VKj6iY/FCpURO8ggO3repijw0Gg0bNvOd2TbtmEY8vYTDipWiPvlhO5kR+yYCCG9Xs+yrDzPsywzDOPs7IxS+nbxBQqBmFfziyFHcIJw5l4ghPT7/W63K++VQSqDTfkfCJMDoh8+fGg2m0mSwPckSRqNxtnZ2T/5qFghbD1jTFGUskRTdr8YY6ZpDofDarWaZRn8yvOcUtrbkSCGQyh8KVDoXxOB7YhSOplMDMPIsgwneZ7n9Xr9/PxcVdUTbF+vQycqDds9Cyr2+/3hcEgISdOUc4BXiCQBpNOV6UghWPH2Gs0Y63Q6k8kEfMQLAefDGNM07eLiAnQS+BeaJyLEOZ5Wn+y0MU1zOp12u12oPcBaUZQ8z7nXGGO2bU8mE8uy/rUdPceQELaFRZkc+uh4PO71ejiTGWMAFbceylKv1xuPx7VajafCCbM5w+d1YBw3V8gIcsActBkOh5TSJEnk6gLCQHaSJIqifPz4cTQa6boOGnPBhcbvwS4MNL6HHQDXdX0ymYxGI1VVeSAL/YSXcnh+enpSFGW0I13XOSuwv7T1CnpgeDgLwzBGo9H5+TnEyqvZy0s/AJZl2e3t7a9fv8IwLBRXqlAh9fv98Xjc7XZVVcWe4nGD4eQq8gRkjOm6nmWZ67qO4/i+LxtcoBBs5pkCS1VV7fV6FxcXtm1nWcY9hZEQ/Mv1E4Spqkop9X3/6urK87w0TRXlOZ8w2Hyv6CbAud1un5+fv3//XlVVaA5YPJZXaC70H9y2ebzf3Nw4jhNFEe9RfNleJ2wupXSwo16vV61WKaVZlsFSECD7HqDlf7kYnlmyTnEc397e3t3dRVEEbuGAvcRQvV6HXj0YDBqNBqU0TVPOFJsuJDx/FYIdL+Nhl+c52LnZbMIwXC6XnueFYbjZbPYra7WaZVkworfbbdM0oYrI3CvI2RgqvADjDXjwuMTGMMbUHVUqlSiKfN8PgmC1WgVBQL5+/WrbdqPRACVwVgvGyecNefgC9wllrCzSgeiBoihaLpfPVQ6XUSHyK8ehwLkIwYj7hgASBlVgKOP9PKpXq1XTNG3btiyr0+mYpkkISZIEMosUZVDhrCKAh73JkcMPiqJomlapVMIwXK1W6/X68fExDMOXORCCGuY9wzBqtVqWZeBHPEAWxoo8lRdOHZBKUJPSNI2iyHVdz/OCINhsNnvOePwAMC3L+rAj0zQVRYGRGX4BR57kQlCfONZxsyHMt9ut67r39/e+7wv1trh1EEJM05xMJp8+fSqMdFz6ZFQKqwAolKbpYrG4vr5erVY8Ko4iSdCDiwFsB4PBaDSCsw4/XQjFXYhfPBvxxZBH6/X68vISWkeZAUfRDngK4dlut6fT6WAwgDFICB0hXOS6AKMLADOfzz3Pk7ccwSzHoJxZhmGA+2CWEEJETjpsOqU0z/M/f/78+PEjjuOyCHnZK2vAawxmrev6dDodjUb8aCFklnweB08RQmaz2dXV1dPTk2yqzOdo1JUHXobGP8dx5vN5nueapuFhl188CGDDsvl8PpvNQBs8n2DtsVVHjHBIHmmt7DHTdf3z58/D4RB8B/lf6AVVVfM8v7m5+f79+3a75RxOnGJfhnz8A08R+DuU1+12O5vNfN9XVbWMI6fFYvHz58/tdouzGnvjqGMcXvdDPse5cAJnqE8FQTCbzZbLJSFEVVUh1LiA1WrlOE4cx3gyxA9ckBCFe9Xk2xb5RFE56OS67uXlJYS2MFrAfYOiKI7jPDw84DOGXEKFC6e9i2Q8eNwIKYPZeZ7nui4OcFivaVqe579//14sFrizlh0OBQ/sXQZlVFhdaFnlgESWZdfX15vNRtioqmoURY7j4A6FB4yygHsBQhCPrSk7fwFyDw8Pvu8nSUIp5ZG02WxgUi5st2WXoUeTFpiL8ZBnYSaBBAXi/v4+iiJ+FVStVsMwvLu749wKSeZZkPZl9zesKBL5d9d1F4sFrmG+7z8PWVLVLnNQQeziAi1PfZWSfskbu+u6QRBAZoVh6Hkehkco4oV8hO/7AopnBqFSVcpvIwghcRyvVitoosvlEtqnXGxkmMtO0y/3Q3wDHruIdFTAwhhjcRw/Pj5qmkYpDYLg79+/ggGFxhSe2kBLVSgDwnhVOQky0Hq9juOYMbZcLgESOWCFYxMu/UdVUVFK70qFBiTcDWD8wjBcr9dpmj4f895gjKwufv0P7w2iUipQlL4AAAAASUVORK5CYII=";
    var TPL48 = "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";
    var TPL96 = "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";
    function loadImg(src) {
      return new Promise(function (res, rej) {
        var im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = function () { res(im); };
        im.onerror = function () { rej(new Error("image load failed")); };
        im.src = src;
      });
    }
    async function alphaMap(b64, size) {
      var bin = atob(b64), arr = new Uint8Array(bin.length);
      for (var k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
      var bmp = await createImageBitmap(new Blob([arr], { type: "image/png" }));
      var oc = new OffscreenCanvas(size, size), cx = oc.getContext("2d", { willReadFrequently: true });
      cx.drawImage(bmp, 0, 0, size, size); bmp.close();
      var d = cx.getImageData(0, 0, size, size).data, v = new Float32Array(size * size);
      for (var i = 0; i < v.length; i++) { var p = 4 * i; v[i] = Math.max(d[p], d[p + 1], d[p + 2]) / 255; }
      return v;
    }
    try {
      var img = await loadImg(u);
      var W = img.naturalWidth, H = img.naturalHeight;
      var c = document.createElement("canvas"); c.width = W; c.height = H;
      var ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      var id = ctx.getImageData(0, 0, W, H), data = id.data;
      // "auto" (default) scores both logo generations and keeps the best NCC per
      // image; "old"/"new" force a single generation.
      var wantNew = logoVersion == null || logoVersion === "auto" || logoVersion === "new";
      var wantOld = logoVersion == null || logoVersion === "auto" || logoVersion === "old";

      function nccAt(alpha, size, ix, iy) {
        if (ix < 0 || iy < 0 || ix + size > W || iy + size > H) return -1;
        var s = 0, o = 0, y = 0, vv = 0, r = 0, m = 0;
        for (var g = 0; g < size; g++) {
          var row = (iy + g) * W, er = g * size;
          for (var x = 0; x < size; x++) {
            var j = (row + ix + x) * 4;
            var lum = (0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]) / 255, cc = alpha[er + x];
            s += cc * lum; o += cc; y += cc * cc; vv += lum; r += lum * lum; m++;
          }
        }
        if (!m) return -1;
        var b = o / m, xm = vv / m, S = s / m - b * xm;
        var h = Math.sqrt(Math.max(0, y / m - b * b)), dd = Math.sqrt(Math.max(0, r / m - xm * xm));
        return (h < 0.001 || dd < 0.001) ? -1 : S / (h * dd);
      }
      function scan(alpha, size, step, refine) {
        var sx = Math.max(0, Math.floor(W * 0.5)), sy = Math.max(0, Math.floor(H * 0.5)), ex = W - size, ey = H - size;
        if (ex < sx || ey < sy) return { x: -1, y: -1, ncc: -1 };
        var best = { x: sx, y: sy, ncc: -1 };
        for (var yy = sy; yy <= ey; yy += step)
          for (var xx = sx; xx <= ex; xx += step) { var n = nccAt(alpha, size, xx, yy); if (n > best.ncc) best = { x: xx, y: yy, ncc: n }; }
        if (refine > 0) {
          var b2 = best, bx = Math.max(0, best.x - refine), by = Math.max(0, best.y - refine);
          var Ex = Math.min(ex, best.x + refine), Ey = Math.min(ey, best.y + refine);
          for (var d2 = by; d2 <= Ey; d2++) for (var g2 = bx; g2 <= Ex; g2++) { var n2 = nccAt(alpha, size, g2, d2); if (n2 > b2.ncc) b2 = { x: g2, y: d2, ncc: n2 }; }
          best = b2;
        }
        return best;
      }

      // Estimate how strongly the detected logo was actually blended in. The overlay is
      // white (255), so under it pixels are pulled toward white by (gain*alpha). We try a
      // sweep of strength "variants" of the SAME mask and keep the one whose un-blend best
      // restores the patch to the luma of the surrounding ring. A faint watermark then gets
      // a light-touch gain instead of over-darkening at gain 1, and a strong one still gets
      // fully removed. This is the runtime equivalent of shipping many opacity variants.
      var GAINS = [1, 0.85, 0.72, 0.6, 0.5, 0.42, 0.34, 0.27, 0.2, 0.14];
      function estGain(alpha, size, ix, iy) {
        var pad = Math.max(6, Math.round(0.3 * size));
        var ax = Math.max(0, ix - pad), ay = Math.max(0, iy - pad), bx = Math.min(W, ix + size + pad), by = Math.min(H, iy + size + pad);
        var sum = 0, cnt = 0;
        for (var yy = ay; yy < by; yy++) for (var xx = ax; xx < bx; xx++) {
          if (xx >= ix && xx < ix + size && yy >= iy && yy < iy + size) continue;
          var j = (yy * W + xx) * 4; sum += 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]; cnt++;
        }
        if (!cnt) return 1;
        var bg = sum / cnt, bestG = GAINS[0], bestErr = Infinity;
        for (var gi = 0; gi < GAINS.length; gi++) {
          var g = GAINS[gi], err = 0, wsum = 0;
          for (var v = 0; v < size; v++) for (var r = 0; r < size; r++) {
            var a0 = alpha[v * size + r]; if (a0 <= 0.04) continue;
            var al = Math.min(a0 * g, 0.99), one = 1 - al; if (one <= 1e-4) continue;
            var off = ((iy + v) * W + ix + r) * 4;
            var lum = (0.299 * (data[off] - al * 255) + 0.587 * (data[off + 1] - al * 255) + 0.114 * (data[off + 2] - al * 255)) / one;
            var w = Math.min(1, 6 * a0); err += Math.abs(lum - bg) * w; wsum += w;
          }
          var e = wsum > 0 ? err / wsum : Infinity; if (e < bestErr) { bestErr = e; bestG = g; }
        }
        return bestG;
      }

      var cands = [];
      if (wantNew) { cands.push({ size: 96, margin: 64, alpha: await alphaMap(TPL96_2026, 96) }); cands.push({ size: 48, margin: 32, alpha: await alphaMap(TPL48_2026, 48) }); }
      if (wantOld) { cands.push({ size: 96, margin: 64, alpha: await alphaMap(TPL96, 96) }); cands.push({ size: 48, margin: 32, alpha: await alphaMap(TPL48, 48) }); }
      var best = null;
      for (var ci = 0; ci < cands.length; ci++) {
        var S = cands[ci];
        var hx = W - S.margin - S.size, hy = H - S.margin - S.size;
        var g = nccAt(S.alpha, S.size, hx, hy);
        var p = { size: S.size, alpha: S.alpha, x: hx, y: hy, ncc: g, autoX: hx, autoY: hy };
        if (g < 0.5) { var e = scan(S.alpha, S.size, 8, 8); if (e.ncc > g) p = { size: S.size, alpha: S.alpha, x: e.x, y: e.y, ncc: e.ncc, autoX: hx, autoY: hy }; }
        if (!best || p.ncc > best.ncc) best = p;
      }

      var removed = false;
      if (best && best.ncc >= 0.3) {
        var gain = estGain(best.alpha, best.size, best.x, best.y), logo = 255;
        var v0 = Math.max(0, best.x), r0 = Math.max(0, best.y), m0 = Math.min(W, best.x + best.size), b0 = Math.min(H, best.y + best.size);
        for (var Y = r0; Y < b0; Y++) for (var X = v0; X < m0; X++) {
          var dy = Y - best.y, dx = X - best.x;
          if (dy < 0 || dy >= best.size || dx < 0 || dx >= best.size) continue;
          var al = best.alpha[dy * best.size + dx] * gain;
          if (al < 0.002) continue; if (al > 0.99) al = 0.99;
          var one = 1 - al, off = (Y * W + X) * 4;
          for (var kk = 0; kk < 3; kk++) { var val = (data[off + kk] - al * logo) / one; data[off + kk] = Math.round(Math.max(0, Math.min(255, val))); }
        }
        removed = true;
      }
      ctx.putImageData(id, 0, 0);
      var blob = await new Promise(function (res) { c.toBlob(function (b) { res(b); }, "image/png"); });
      if (!blob) return { error: "toBlob null" };
      return { blobUrl: URL.createObjectURL(blob), removed: removed };
    } catch (e) { return { error: (e && e.message) || String(e) }; }
  };

  // Clean a video: fetch the mp4 (same-origin, credentialed), demux (MP4Box), decode
  // each frame (WebCodecs), reverse-blend the corner logo, re-encode H.264 and re-mux
  // (mp4-muxer, audio passed through). Requires MP4Box + Mp4Muxer already injected into
  // the page. Returns { blobUrl, bytes } or { error }.
  globalThis.__inj.processVideoClean = async function (videoUrl, logoVersion) {
    // 2026 sparkle watermark templates (added alongside the originals).
    var TPL96_2026 = "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";
    var TPL48_2026 = "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";
    var TPL48 = "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";
    var TPL84 = "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";
    var SUPPORTED = ["1280x720", "720x1280", "1920x1080", "1080x1920"];
    var OPAC = [1, 0.85, 0.72, 0.6, 0.5, 0.42, 0.34, 0.27, 0.2, 0.14];
    var MARG_48 = [144, 120, 128, 72];
    var MARG_84 = [222, 186];
    var AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    if (typeof MP4Box === "undefined" || typeof Mp4Muxer === "undefined") return { error: "video libs not loaded" };
    if (typeof VideoDecoder === "undefined" || typeof VideoEncoder === "undefined") return { error: "WebCodecs unavailable" };
    function clamp(t, e, l) { return Math.min(Math.max(t, e), l); }

    async function decodeTpl(b64, size, withColor) {
      var bin = atob(b64), arr = new Uint8Array(bin.length);
      for (var k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
      var bmp = await createImageBitmap(new Blob([arr], { type: "image/png" }));
      var oc = new OffscreenCanvas(size, size), cx = oc.getContext("2d", { willReadFrequently: true });
      cx.drawImage(bmp, 0, 0, size, size); bmp.close();
      var d = cx.getImageData(0, 0, size, size).data, v = new Float32Array(size * size);
      // withColor: the mask stores its shape in the PNG alpha channel with per-pixel
      // logo colors (the 1080p "old" paired-star mask). Otherwise it's a luma mask
      // where alpha = max(R,G,B) and the logo colour is a flat white overlay.
      var col = withColor ? new Float32Array(size * size * 3) : null;
      for (var i = 0; i < v.length; i++) {
        var p = 4 * i;
        if (withColor) { v[i] = d[p + 3] / 255; col[3 * i] = d[p]; col[3 * i + 1] = d[p + 1]; col[3 * i + 2] = d[p + 2]; }
        else { v[i] = Math.max(d[p], d[p + 1], d[p + 2]) / 255; }
      }
      return { values: v, colorValues: col || undefined, width: size, height: size };
    }

    function unblend(imgData, e) {
      var l = new Uint8ClampedArray(imgData.data), a = e.opacity !== undefined ? e.opacity : 1, n = e.ceiling != null ? e.ceiling : 1;
      var c = e.overlayValue != null ? e.overlayValue : 250, s = e.alphaMap.width, o = e.alphaMap.height;
      var hasCol = e.alphaMap.colorValues !== undefined, colv = e.alphaMap.colorValues;
      var y = e.edgeCleanup ? new Uint8Array(s * o) : null;
      for (var v = 0; v < o; v++) for (var r = 0; r < s; r++) {
        var m = v * s + r, b = Math.min(e.alphaMap.values[m] * e.baseStrength * a, n);
        if (b < 0.002) continue;
        var x = ((e.y + v) * imgData.width + e.x + r) * 4, S = 1 - b;
        if (S <= 1e-4) continue;
        if (y) y[m] = 1;
        for (var h = 0; h < 3; h++) { var ov = hasCol ? colv[3 * m + h] : c; l[x + h] = Math.round(Math.min(Math.max((imgData.data[x + h] - b * ov) / S, 0), 255)); }
      }
      if (e.edgeCleanup && y) {
        var vv = e.edgeCleanup.strength, rr = e.edgeCleanup.radius, m2 = new Uint8Array(s * o);
        for (var S2 = 0; S2 < o; S2++) for (var h2 = 0; h2 < s; h2++) if (y[S2 * s + h2])
          for (var d3 = -rr; d3 <= rr; d3++) for (var g3 = -rr; g3 <= rr; g3++) { var pp = h2 + g3, E = S2 + d3; if (pp >= 0 && pp < s && E >= 0 && E < o) m2[E * s + pp] = 1; }
        var b3 = new Uint8Array(m2), x2 = (e.edgeCleanup.maxPasses != null) ? e.edgeCleanup.maxPasses : Math.min(120, Math.max(8, s + o));
        for (var S3 = 0; S3 < x2; S3++) {
          var h3 = 0, d4 = new Uint8Array(b3);
          for (var g4 = 0; g4 < o; g4++) for (var p4 = 0; p4 < s; p4++) {
            if (!b3[g4 * s + p4]) continue;
            var E2 = 0, M = [0, 0, 0];
            for (var N = -1; N <= 1; N++) for (var C = -1; C <= 1; C++) {
              if (N === 0 && C === 0) continue;
              var D = p4 + C, G = g4 + N;
              if (D < 0 || D >= s || G < 0 || G >= o || b3[G * s + D]) continue;
              var at = ((e.y + G) * imgData.width + e.x + D) * 4; M[0] += l[at]; M[1] += l[at + 1]; M[2] += l[at + 2]; E2++;
            }
            if (E2 === 0) continue;
            var j = ((e.y + g4) * imgData.width + e.x + p4) * 4;
            for (var N2 = 0; N2 < 3; N2++) { var C2 = M[N2] / E2; l[j + N2] = Math.round(l[j + N2] * (1 - vv) + C2 * vv); }
            d4[g4 * s + p4] = 0; h3++;
          }
          b3.set(d4); if (h3 === 0) break;
        }
      }
      return new ImageData(l, imgData.width, imgData.height);
    }

    function corr(imgData, e) {
      var l = 0, a = 0, n = 0, u = 0, i = 0, c = 0;
      for (var v = 0; v < e.alphaMap.height; v++) for (var r = 0; r < e.alphaMap.width; r++) {
        var m = e.alphaMap.values[v * e.alphaMap.width + r]; if (m <= 0.08) continue;
        var b = ((e.y + v) * imgData.width + e.x + r) * 4, x = (imgData.data[b] + imgData.data[b + 1] + imgData.data[b + 2]) / 765;
        l += x; a += x * x; n += m; u += m * m; i += x * m; c++;
      }
      if (c === 0) return -Infinity;
      var s = l / c, o = n / c, y = Math.sqrt((a - c * s * s) * (u - c * o * o));
      return y <= 0 ? -Infinity : (i - c * s * o) / y;
    }

    function estOpacity(imgData, e) {
      var l = Math.max(8, Math.round(0.25 * e.alphaMap.width)), a = Math.max(0, e.x - l), n = Math.max(0, e.y - l);
      var u = Math.min(imgData.width, e.x + e.alphaMap.width + l), i = Math.min(imgData.height, e.y + e.alphaMap.height + l), c = 0, s = 0;
      for (var b = n; b < i; b++) for (var x = a; x < u; x++) {
        if (x >= e.x && x < e.x + e.alphaMap.width && b >= e.y && b < e.y + e.alphaMap.height) continue;
        var S = (b * imgData.width + x) * 4; c += 0.2126 * imgData.data[S] + 0.7152 * imgData.data[S + 1] + 0.0722 * imgData.data[S + 2]; s++;
      }
      if (s === 0) return OPAC[0];
      var o = c / s, y = OPAC[0], vbest = Infinity;
      for (var oi = 0; oi < OPAC.length; oi++) {
        var bb = OPAC[oi], xx = 0, SS = 0;
        for (var d = 0; d < e.alphaMap.height; d++) for (var g = 0; g < e.alphaMap.width; g++) {
          var p = d * e.alphaMap.width + g, E = e.alphaMap.values[p]; if (E <= 0.04) continue;
          var Mn = Math.min(E * e.baseStrength * bb, bb), jj = 1 - Mn; if (jj <= 1e-4) continue;
          var N = ((e.y + d) * imgData.width + e.x + g) * 4;
          var att = 0.2126 * ((imgData.data[N] - Mn * 250) / jj) + 0.7152 * ((imgData.data[N + 1] - Mn * 250) / jj) + 0.0722 * ((imgData.data[N + 2] - Mn * 250) / jj);
          var Nt = Math.min(1, 8 * E); xx += Math.abs(att - o) * Nt; SS += Nt;
        }
        var hh = SS > 0 ? xx / SS : Infinity; if (hh < vbest) { vbest = hh; y = bb; }
      }
      return y;
    }

    function trackDesc(file, track) {
      var l = file.getTrackById(track.id);
      var a = (l && l.mdia && l.mdia.minf && l.mdia.minf.stbl && l.mdia.minf.stbl.stsd && l.mdia.minf.stbl.stsd.entries) || [];
      for (var i = 0; i < a.length; i++) {
        var u = a[i].avcC || a[i].hvcC || a[i].vpcC || a[i].av1C; if (!u) continue;
        var DS = (typeof DataStream !== "undefined") ? DataStream : (window.DataStream || MP4Box.DataStream); if (!DS) return null;
        var cS = new DS(undefined, 0, DS.BIG_ENDIAN); u.write(cS); return new Uint8Array(cS.buffer, 8);
      }
      return null;
    }

    function demux(buf) {
      return new Promise(function (res, rej) {
        var f = MP4Box.createFile(), vs = [], as2 = [], vt = null, at = null;
        f.onError = function (err) { rej(new Error("mp4box demux: " + err)); };
        f.onReady = function (info) {
          vt = info.videoTracks && info.videoTracks[0]; at = info.audioTracks && info.audioTracks[0];
          if (!vt) { rej(new Error("no video track")); return; }
          f.setExtractionOptions(vt.id, "video", { nbSamples: 1000000 });
          if (at) f.setExtractionOptions(at.id, "audio", { nbSamples: 1000000 });
          f.start();
        };
        f.onSamples = function (id, user, samples) {
          var arr = user === "video" ? vs : as2;
          for (var i = 0; i < samples.length; i++) { var b = samples[i]; arr.push({ data: b.data.slice(0), cts: b.cts, dts: b.dts, duration: b.duration, timescale: b.timescale, is_sync: b.is_sync }); }
        };
        var s = buf.slice(0); s.fileStart = 0; f.appendBuffer(s); f.flush();
        if (!vt) { rej(new Error("no video track")); return; }
        res({ videoTrack: vt, audioTrack: at, videoSamples: vs, audioSamples: as2, videoDescription: trackDesc(f, vt) });
      });
    }

    try {
      // Same-origin (labs.google) request → session cookie is sent on the first hop;
      // the redirect to the cross-origin media host is then read without credentials
      // (a credentialed cross-origin read is rejected against wildcard CORS).
      var resp = await fetch(videoUrl, { credentials: "same-origin" });
      if (!resp.ok) return { error: "fetch HTTP " + resp.status };
      var buf = await resp.arrayBuffer();
      var dem = await demux(buf);
      var vt = dem.videoTrack, at = dem.audioTrack, vsamp = dem.videoSamples, asamp = dem.audioSamples, vdesc = dem.videoDescription;
      var W = vt.video.width, H = vt.video.height, dim = W + "x" + H;
      if (SUPPORTED.indexOf(dim) < 0) return { error: "unsupported dimensions " + dim };
      var nFrames = vsamp.length || 1;
      var tscale = (vsamp[0] && vsamp[0].timescale) || vt.timescale || 30000;
      var totDur = 0; for (var si = 0; si < vsamp.length; si++) totDur += vsamp[si].duration; totDur = totDur / nFrames || tscale / 30;
      var fps = Math.max(1, Math.round(tscale / totDur));
      var is1080 = (W === 1920 && H === 1080) || (W === 1080 && H === 1920);
      // Base mask sizes match erasio: old 1080p is the 84px colored (alpha-channel)
      // paired-star mask, new 1080p is the 96px sparkle, both use 48px at 720p.
      // "auto" (default) scores both generations across the sampled frames and keeps
      // the best-matching one; "old"/"new" force a single generation.
      var wantNew = logoVersion == null || logoVersion === "auto" || logoVersion === "new";
      var wantOld = logoVersion == null || logoVersion === "auto" || logoVersion === "old";
      var tpls = [];
      if (wantNew) tpls.push(await decodeTpl(is1080 ? TPL96_2026 : TPL48_2026, is1080 ? 96 : 48, false));
      if (wantOld) tpls.push(is1080 ? await decodeTpl(TPL84, 84, true) : await decodeTpl(TPL48, 48, false));
      var margins = is1080 ? MARG_84 : MARG_48;
      var cands = [];
      tpls.forEach(function (tpl) {
        margins.forEach(function (R) { cands.push({ x: clamp(W - R, 0, W - tpl.width), y: clamp(H - R, 0, H - tpl.height), alphaMap: tpl, score: 0, baseStrength: 1 }); });
      });

      var muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(), fastStart: "in-memory", firstTimestampBehavior: "offset",
        video: { codec: "avc", width: W, height: H },
        audio: at ? { codec: "aac", sampleRate: at.audio.sample_rate, numberOfChannels: at.audio.channel_count } : undefined
      });
      var bitrate = Math.max(2000000, Math.min(20000000, Math.round(W * H * fps * 0.12)));
      var encCfg = { codec: "avc1.640028", width: W, height: H, bitrate: bitrate, framerate: fps, avc: { format: "avc" } };
      var sup = await VideoEncoder.isConfigSupported(encCfg);
      if (!sup.supported) { encCfg = Object.assign({}, encCfg, { codec: "avc1.42001f" }); sup = await VideoEncoder.isConfigSupported(encCfg); if (!sup.supported) return { error: "no H.264 encoder" }; }
      var encErr = null;
      var encoder = new VideoEncoder({ output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); }, error: function (e) { encErr = e; } });
      encoder.configure(encCfg);

      var canvas = new OffscreenCanvas(W, H), cctx = canvas.getContext("2d", { willReadFrequently: true });
      var decErr = null, chosen = null, buffered = [], sampledCount = 0, encoded = 0;
      var SAMPLE = Math.min(5, nFrames), keyEvery = Math.max(1, fps * 2);

      function encodeFrame(fr) {
        var cfg = chosen || cands[0];
        var cleaned = unblend(fr.imageData, cfg);
        var init = { format: "RGBA", codedWidth: W, codedHeight: H, timestamp: fr.timestamp };
        if (fr.duration != null) init.duration = fr.duration;
        var vframe = new VideoFrame(cleaned.data.buffer, init);
        encoder.encode(vframe, { keyFrame: encoded % keyEvery === 0 }); vframe.close(); encoded++;
      }

      var decoder = new VideoDecoder({
        output: function (frame) {
          try {
            var t = frame.timestamp, d = frame.duration;
            cctx.drawImage(frame, 0, 0, W, H); frame.close();
            var idata = cctx.getImageData(0, 0, W, H);
            var rec = { imageData: idata, timestamp: t, duration: d };
            if (!chosen) {
              for (var ci = 0; ci < cands.length; ci++) cands[ci].score += corr(idata, cands[ci]);
              buffered.push(rec); sampledCount++;
              if (sampledCount >= SAMPLE) {
                // Only the corner margin varies across candidates now, so pick the
                // best-scoring position outright (erasio does the same — no version bias).
                chosen = cands.reduce(function (a, b) { return b.score > a.score ? b : a; });
                chosen.ceiling = 0.99;
                if (chosen.alphaMap.colorValues) {
                  // Colored alpha-channel mask (1080p old): the logo is fully opaque,
                  // un-blended against its own per-pixel colours — no opacity estimation,
                  // white overlay, or edge diffusion (matches erasio's withColor path).
                  chosen.opacity = 1;
                } else {
                  var votes = {};
                  for (var bi = 0; bi < buffered.length; bi++) { var op = estOpacity(buffered[bi].imageData, chosen); votes[op] = (votes[op] || 0) + 1; }
                  var bestOp = OPAC[0], bestN = 0;
                  for (var key in votes) { if (votes[key] > bestN) { bestN = votes[key]; bestOp = parseFloat(key); } }
                  chosen.opacity = bestOp;
                  // Luma masks: flat white overlay, then diffuse the border ring away
                  // when fully opaque (erasio's settings — 120 passes clears the fringe).
                  chosen.overlayValue = 255;
                  if (bestOp >= 1) chosen.edgeCleanup = { strength: 0.6, radius: 2, maxPasses: 120 };
                }
                for (var fi = 0; fi < buffered.length; fi++) encodeFrame(buffered[fi]);
                buffered.length = 0;
              }
              return;
            }
            encodeFrame(rec);
          } catch (err) { decErr = err; try { frame.close(); } catch (_) { } }
        },
        error: function (e) { decErr = e; }
      });
      decoder.configure({ codec: vt.codec, codedWidth: W, codedHeight: H, description: vdesc || undefined });

      for (var di = 0; di < vsamp.length; di++) {
        if (decErr) throw decErr;
        var R = vsamp[di];
        decoder.decode(new EncodedVideoChunk({ type: R.is_sync ? "key" : "delta", timestamp: R.cts * 1e6 / R.timescale, duration: R.duration * 1e6 / R.timescale, data: R.data }));
        if ((di + 1) % 24 === 0) await new Promise(function (r) { setTimeout(r, 0); });
      }
      await decoder.flush(); await encoder.flush();
      if (decErr) throw decErr; if (encErr) throw encErr;
      decoder.close(); encoder.close();

      if (at && asamp.length) {
        try {
          var sr = at.audio.sample_rate, ch = at.audio.channel_count, idx = AAC_RATES.indexOf(sr); if (idx < 0) idx = 4;
          var aMeta = { decoderConfig: { codec: "mp4a.40.2", sampleRate: sr, numberOfChannels: ch, description: new Uint8Array([(16 | idx >> 1) & 255, ((idx & 1) << 7 | ch << 3) & 255]) } };
          for (var ai = 0; ai < asamp.length; ai++) { var A = asamp[ai]; muxer.addAudioChunk(new EncodedAudioChunk({ type: "key", timestamp: A.cts * 1e6 / A.timescale, duration: A.duration * 1e6 / A.timescale, data: A.data }), aMeta); }
        } catch (ae) { /* audio copy failed → silent output */ }
      }
      muxer.finalize();
      var out = new Blob([muxer.target.buffer], { type: "video/mp4" });
      return { blobUrl: URL.createObjectURL(out), bytes: out.size };
    } catch (e) { return { error: (e && e.message) || String(e) }; }
  };

})();

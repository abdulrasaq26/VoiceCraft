// Local Stable Diffusion Adapter for AETHER AI Studio
// Integrates with Uncensored Local Studio (techjarves/Uncensored-Local-Studio)
// Backend: stable-diffusion.cpp server running at http://127.0.0.1:8080
// API: POST /generate — returns { images: [{ base64: '...', seed: ... }] }
//
// Setup: Run the Uncensored Local Studio backend separately, then AETHER AI Studio
// will automatically detect and use it for all image generation tasks.
(() => {
  'use strict';

  function getSdBaseUrl() {
    if (window.ProviderManager && window.ProviderManager.getPoolState) {
      const ep = window.ProviderManager.getPoolState('sd')?.endpoint;
      if (ep) return ep.replace(/\/$/, '');
    }
    return 'http://localhost:1420';
  }

  const SD_PROXY = '/api/proxy/sd';

  let sdOnline = null;       // tri-state: null=unknown, true=online, false=offline
  let lastCheckTs  = 0;
  const CACHE_MS   = 15000;  // re-check every 15 s

  // -------------------------------------------------------------------
  // Health check (cached)
  // -------------------------------------------------------------------
  async function checkOnline() {
    if (sdOnline !== null && Date.now() - lastCheckTs < CACHE_MS) return sdOnline;
    const baseUrl = getSdBaseUrl();
    const proxyHeaders = { 'x-sd-endpoint': baseUrl };
    const directHeaders = { 'ngrok-skip-browser-warning': 'true' };
    
    if (baseUrl.includes('gradio.live') || baseUrl.includes('ngrok')) {
       // Direct ping for colab endpoints to avoid server.js HTTP proxy crash
       try {
         const r = await fetch(`${baseUrl}/v1/health`, { headers: directHeaders, signal: AbortSignal.timeout(3000) });
         sdOnline = r.ok;
       } catch (e) {
         sdOnline = false;
       }
    } else {
      try {
        const r = await fetch(`${SD_PROXY}/api/health`, { headers: proxyHeaders, signal: AbortSignal.timeout(3000) });
        sdOnline = r.ok;
      } catch (_) {
        try {
          const r = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
          sdOnline = r.ok;
        } catch (_2) {
          sdOnline = false;
        }
      }
    }
    lastCheckTs = Date.now();
    return sdOnline;
  }

  // -------------------------------------------------------------------
  // List models available on the SD backend
  // -------------------------------------------------------------------
  async function listModels() {
    const baseUrl = getSdBaseUrl();
    const proxyHeaders = { 'x-sd-endpoint': baseUrl };
    try {
      const r = await fetch(`${SD_PROXY}/api/models`, { headers: proxyHeaders, signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const d = await r.json();
        return Array.isArray(d.models) ? d.models : [];
      }
    } catch (_) {}
    try {
      const r = await fetch(`${baseUrl}/api/models`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const d = await r.json();
        return Array.isArray(d.models) ? d.models : [];
      }
    } catch (_) {}
    return [];
  }

  // -------------------------------------------------------------------
  // Load a model on the SD backend
  // -------------------------------------------------------------------
  async function loadModel(modelName, constraints = {}) {
    const baseUrl = getSdBaseUrl();
    const body = JSON.stringify({
      model: modelName,
      backend_type: constraints.backendType || 'auto',
      steps: constraints.steps || 20,
      cfg_scale: constraints.cfgScale || 7.0,
      sampler: constraints.sampler || 'euler_a',
      width: constraints.width || 512,
      height: constraints.height || 512,
    });

    try {
      const r = await fetch(`${SD_PROXY}/api/restart-backend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sd-endpoint': baseUrl },
        body,
        signal: AbortSignal.timeout(30000)
      });
      if (r.ok) return await r.json();
    } catch (_) {}

    const r = await fetch(`${baseUrl}/api/restart-backend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(30000)
    });
    return r.ok ? await r.json() : null;
  }

  // -------------------------------------------------------------------
  // Ensure the underlying sd-vulkan / sd-cuda process is booted & ready
  // -------------------------------------------------------------------
  async function ensureBackendRunning(constraints = {}) {
    const baseUrl = getSdBaseUrl();
    const proxyHeaders = { 'x-sd-endpoint': baseUrl };

    // Check if already running & ready
    try {
      const hRes = await fetch(`${SD_PROXY}/api/health`, { headers: proxyHeaders, signal: AbortSignal.timeout(3000) });
      if (hRes.ok) {
        const hData = await hRes.json();
        if (hData.backend?.ready && hData.backend?.running) {
          return true;
        }
      }
    } catch (_) {}

    console.log('[SD Adapter] Backend binary not active on port 8080. Booting sd-vulkan engine via /api/restart-backend...');
    await loadModel(constraints.model || null, constraints);

    // Poll until ready (up to 15s)
    const start = Date.now();
    while (Date.now() - start < 15000) {
      await new Promise(r => setTimeout(r, 800));
      try {
        const cRes = await fetch(`${SD_PROXY}/api/health`, { headers: proxyHeaders, signal: AbortSignal.timeout(2000) });
        if (cRes.ok) {
          const cData = await cRes.json();
          if (cData.backend?.ready || cData.backend?.running) {
            console.log('[SD Adapter] SD Vulkan backend process is READY on port 8080!');
            return true;
          }
        }
      } catch (_) {}
    }
    return false;
  }

  // -------------------------------------------------------------------
  // Aspect ratio → pixel dimensions
  // -------------------------------------------------------------------
  function aspectToSize(aspect) {
    const map = {
      '1:1': [512, 512],
      '16:9': [768, 432],
      '9:16': [432, 768],
      '4:3': [640, 480],
      '3:4': [480, 640],
    };
    return map[aspect] || [512, 512];
  }

  // -------------------------------------------------------------------
  // Core generate — tries /sdapi/v1/txt2img and /v1/images/generations
  // -------------------------------------------------------------------
  async function generateImage({
    prompt,
    negative_prompt = 'watermark, blurry, deformed, worst quality, low quality',
    aspect_ratio = '16:9',
    steps = 20,
    cfg_scale = 7.0,
    sampler = 'Euler a',
    seed = -1,
    style = '',
    model = null,
    width,
    height,
  } = {}) {
    if (!prompt) throw new Error('Prompt is required for image generation.');

    const [w, h] = (width && height) ? [width, height] : aspectToSize(aspect_ratio);
    const baseUrl = getSdBaseUrl();

    // Standard Automatic1111 / SD WebUI / stable-diffusion.cpp payload
    const payload = {
      prompt,
      negative_prompt,
      width: w,
      height: h,
      steps: steps,
      cfg_scale: cfg_scale,
      sampler_name: sampler,
      seed: seed,
    };
    // The AETHER backend swaps a style LoRA on this. Harmless to servers that
    // do not know the field -- A1111 and friends ignore unknown keys.
    if (style) payload.style = style;
    if (model) payload.model = model;

    const bodyStr = JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json', 'x-sd-endpoint': baseUrl };

    // --- COLAB NOTEBOOK INTEGRATION ---
    if (baseUrl.includes('gradio.live') || baseUrl.includes('ngrok')) {
      console.log('[SD Adapter] Detected Colab SDXL URL! Routing to custom endpoints...');
      
      let colabRes;
      // 1. Try FastAPI /generate endpoint via proxy
      try {
        colabRes = await fetch(`${SD_PROXY}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-sd-endpoint': baseUrl },
          body: JSON.stringify({
            prompt,
            negative_prompt,
            width: w,
            height: h,
            steps,
            guidance_scale: cfg_scale,
            seed
          })
        });
      } catch(e) {}

      // 2. If /generate fails, try Gradio /api/predict endpoint via proxy
      if (!colabRes || !colabRes.ok) {
        console.log('[SD Adapter] /generate not available, trying Gradio /api/predict...');
        colabRes = await fetch(`${SD_PROXY}/api/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-sd-endpoint': baseUrl },
          body: JSON.stringify({
            data: [prompt, negative_prompt, w, h, steps, cfg_scale, seed]
          })
        });
      }

      if (colabRes && colabRes.ok) {
        const json = await colabRes.json();
        let b64 = null;
        
        // FastAPI /generate response schema
        if (json.error) {
           throw new Error(`Kaggle FastAPI Exception: ${json.error}\nTrace: ${json.traceback}`);
        }
        if (json.image_base64) {
          b64 = json.image_base64;
        } 
        // Gradio /api/predict response schema
        else if (json.data && json.data.length > 0) {
          const imgData = json.data[0];
          if (typeof imgData === 'string') {
            b64 = imgData;
          } else if (imgData && imgData.url) {
            // Gradio 4+ returns a URL object, fetch the blob directly
            const imgRes = await fetch(imgData.url);
            return await imgRes.blob();
          }
        }
        
        if (b64) {
          const byteStr = atob(b64.replace(/^data:image\/\w+;base64,/, ''));
          const ab = new ArrayBuffer(byteStr.length);
          const view = new Uint8Array(ab);
          for (let i = 0; i < byteStr.length; i++) view[i] = byteStr.charCodeAt(i);
          return new Blob([ab], { type: 'image/png' });
        }
        throw new Error('Colab SDXL returned an unexpected image format.');
      }
      throw new Error(`Colab SDXL error: Could not reach /generate or /api/predict at ${baseUrl}`);
    }

    // Auto-ensure the underlying sd-vulkan binary is booted before generating
    await ensureBackendRunning({ model, steps, cfgScale: cfg_scale, sampler, width: w, height: h });

    let res;
    // 1. Try via server.js CORS proxy (/sdapi/v1/txt2img)
    try {
      res = await fetch(`${SD_PROXY}/sdapi/v1/txt2img`, {
        method: 'POST', headers, body: bodyStr,
        signal: AbortSignal.timeout(300000)  // 5 min
      });
    } catch (proxyErr) {
      console.warn('[SD Adapter] Proxy /sdapi/v1/txt2img failed, trying direct:', proxyErr.message);
      try {
        res = await fetch(`${baseUrl}/sdapi/v1/txt2img`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyStr,
          signal: AbortSignal.timeout(300000)
        });
      } catch (directErr) {
        // Fallback to OpenAI-compatible endpoint /v1/images/generations
        console.warn('[SD Adapter] Direct /sdapi/v1/txt2img failed, trying /v1/images/generations:', directErr.message);
        const openAiBody = JSON.stringify({ prompt, n: 1, size: `${w}x${h}`, response_format: 'b64_json' });
        res = await fetch(`${SD_PROXY}/v1/images/generations`, {
          method: 'POST', headers, body: openAiBody,
          signal: AbortSignal.timeout(300000)
        });
      }
    }

    // Auto-retry on 502 ECONNREFUSED
    if (res.status === 502) {
      const clone = res.clone();
      const errText = await clone.text().catch(() => '');
      if (errText.includes('ECONNREFUSED')) {
        console.warn('[SD Adapter] 502 ECONNREFUSED received. Booting backend binary & retrying...');
        await loadModel(model, { steps, cfgScale: cfg_scale, sampler, width: w, height: h });
        await new Promise(r => setTimeout(r, 4500));
        res = await fetch(`${SD_PROXY}/sdapi/v1/txt2img`, {
          method: 'POST', headers, body: bodyStr,
          signal: AbortSignal.timeout(300000)
        });
      }
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(`Stable Diffusion error (${res.status}): ${errText}`);
    }

    const contentType = res.headers.get('content-type') || '';

    // Response can be JSON with base64 images OR raw binary image
    if (contentType.includes('application/json')) {
      const json = await res.json();
      // Uncensored Local Studio returns: { images: [{ base64: '...', seed: N }] }
      const images = json.images || [];
      if (!images.length) throw new Error('SD server returned no images.');
      const first = images[0];
      const b64 = typeof first === 'string' ? first : (first.base64 || first.data || first.image || '');
      if (!b64) throw new Error('SD server returned empty image data.');
      // Convert base64 → Blob
      const byteStr = atob(b64.replace(/^data:image\/\w+;base64,/, ''));
      const ab = new ArrayBuffer(byteStr.length);
      const view = new Uint8Array(ab);
      for (let i = 0; i < byteStr.length; i++) view[i] = byteStr.charCodeAt(i);
      return new Blob([ab], { type: 'image/png' });
    }

    // Raw binary PNG/JPEG response
    if (contentType.includes('image/')) {
      return await res.blob();
    }

    throw new Error('SD server returned an unexpected response format.');
  }

  // Shared response decoder — servers here answer with either JSON carrying
  // base64, or a raw image body.
  async function decodeImageResponse(res) {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      // The AETHER SDXL notebook's /generate answers with a bare
      // {"image_base64": "..."} rather than an images array, so accept both.
      const single = json.image_base64 || json.image || null;
      if (single && typeof single === 'string') {
        const bs = atob(single.replace(/^data:image\/\w+;base64,/, ''));
        const buf = new ArrayBuffer(bs.length);
        const v = new Uint8Array(buf);
        for (let i = 0; i < bs.length; i++) v[i] = bs.charCodeAt(i);
        return new Blob([buf], { type: 'image/png' });
      }
      const images = json.images || json.data || [];
      if (!images.length) return null;
      const first = images[0];
      const b64 = typeof first === 'string'
        ? first
        : (first.base64 || first.data || first.image || first.b64_json || '');
      if (!b64) return null;
      const byteStr = atob(String(b64).replace(/^data:image\/\w+;base64,/, ''));
      const ab = new ArrayBuffer(byteStr.length);
      const view = new Uint8Array(ab);
      for (let i = 0; i < byteStr.length; i++) view[i] = byteStr.charCodeAt(i);
      return new Blob([ab], { type: 'image/png' });
    }
    if (contentType.includes('image/')) return await res.blob();
    return null;
  }

  // --- img2img ------------------------------------------------------------
  //
  // Carries a character's reference portrait into their scenes. This backend is
  // stable-diffusion.cpp behind a custom API (/api/health, /api/models), not
  // Automatic1111 — so, exactly as txt2img already does, we try the known
  // request shapes in turn instead of assuming one. The outcome is remembered,
  // so a server without img2img is asked once rather than once per scene.
  let img2imgSupport = null; // null = untested, false = unsupported, string = working path

  // Ask the server what it actually implements instead of guessing.
  // These backends are FastAPI, which publishes /openapi.json, so one request
  // gives the real route list — far better than firing three POSTs at paths
  // that may not exist. The AETHER SDXL notebook, for instance, exposes only
  // /v1/health, /api/health and /generate, so img2img can be ruled out up
  // front rather than discovered by three 404s.
  let routeCache = null;
  async function serverRoutes() {
    if (routeCache) return routeCache;
    try {
      const r = await fetch(`${SD_PROXY}/openapi.json`, {
        headers: { 'x-sd-endpoint': getSdBaseUrl() },
        signal: AbortSignal.timeout(8000)
      });
      if (r.ok) {
        const spec = await r.json();
        routeCache = Object.keys(spec.paths || {});
        return routeCache;
      }
    } catch (e) { /* not a FastAPI server, or unreachable */ }
    routeCache = []; // unknown — fall back to probing
    return routeCache;
  }

  function dataUrlToBase64(dataUrl) {
    const s = String(dataUrl || '');
    const i = s.indexOf(',');
    return i === -1 ? s : s.slice(i + 1);
  }

  async function generateImageFromImage({
    prompt,
    init_image,
    negative_prompt = 'watermark, blurry, deformed, worst quality, low quality',
    aspect_ratio = '16:9',
    denoising_strength = 0.65,
    steps = 20,
    cfg_scale = 7.0,
    sampler = 'Euler a',
    seed = -1,
    width,
    height
  } = {}) {
    if (!prompt) throw new Error('Prompt is required for image generation.');
    if (!init_image) return null;
    if (img2imgSupport === false) return null; // known unsupported; caller falls back

    const [w, h] = (width && height) ? [width, height] : aspectToSize(aspect_ratio);
    const baseUrl = getSdBaseUrl();
    const headers = { 'Content-Type': 'application/json', 'x-sd-endpoint': baseUrl };
    const b64 = dataUrlToBase64(init_image);

    const a1111Body = JSON.stringify({
      init_images: [b64], denoising_strength, prompt, negative_prompt,
      width: w, height: h, steps, cfg_scale, sampler_name: sampler, seed
    });
    const genericBody = JSON.stringify({
      prompt, negative_prompt, image: b64, init_image: b64,
      strength: denoising_strength, denoising_strength,
      width: w, height: h, steps, cfg_scale, sampler, seed
    });

    let attempts = [
      ['/sdapi/v1/img2img', a1111Body],
      ['/api/img2img', genericBody],
      ['/v1/images/edits', genericBody]
    ];

    // If the server told us its routes, trust that rather than probing.
    const routes = await serverRoutes();
    if (routes.length) {
      // Match on shape, not on an exact string. A server that follows its own
      // convention — /img2img alongside /generate, say — would be missed by a
      // hardcoded list even though it implements exactly what we need.
      const looksLikeImg2Img = (p) => /img2?_?2?img|image[-_]to[-_]image|images\/edits/i.test(p);
      const advertised = routes.filter(looksLikeImg2Img);
      if (!advertised.length) {
        console.warn(`[SD Adapter] Server advertises no img2img route (${routes.join(', ')}) — staying on seed-locked txt2img.`);
        img2imgSupport = false;
        return null;
      }
      // Prefer a route we have a known body shape for; otherwise send the
      // generic one, which covers the common field spellings.
      attempts = advertised.map((p) => {
        const known = attempts.find(([kp]) => kp === p);
        return known || [p, genericBody];
      });
    }

    if (typeof img2imgSupport === 'string') {
      attempts.sort((a, b) => (a[0] === img2imgSupport ? -1 : b[0] === img2imgSupport ? 1 : 0));
    }

    for (const [path, body] of attempts) {
      try {
        const res = await fetch(`${SD_PROXY}${path}`, {
          method: 'POST', headers, body, signal: AbortSignal.timeout(300000)
        });
        if (!res.ok) continue;
        const blob = await decodeImageResponse(res);
        if (blob) {
          if (img2imgSupport !== path) {
            console.log(`[SD Adapter] img2img available at ${path}`);
            img2imgSupport = path;
          }
          return blob;
        }
      } catch (e) { /* try the next shape */ }
    }

    console.warn('[SD Adapter] No img2img endpoint on this server — character reference portraits cannot drive generation; staying on seed-locked txt2img.');
    img2imgSupport = false;
    return null;
  }

  function supportsImg2Img() { return img2imgSupport !== false; }

  // -------------------------------------------------------------------
  // Expose globally
  // -------------------------------------------------------------------
  window.StableDiffusionAdapter = {
    generateImage,
    generateImageFromImage,
    supportsImg2Img,
    listModels,
    loadModel,
    checkOnline,
    getSdBaseUrl,
    aspectToSize,
  };

  // Auto-check on load (non-blocking)
  checkOnline().then(online => {
    console.log(`[SD Adapter] Backend status: ${online ? '✅ Online' : '❌ Offline — start Uncensored Local Studio'}`);
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('sd:status-changed', { detail: { online } }));
    }
  });
})();

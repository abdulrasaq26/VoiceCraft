// Static file server & API Gateway Proxy for Blvck-TTS v5.1 (ES Module)
// Includes CORS & TLS SNI proxy for NVIDIA NIM, OpenRouter, and local gateways to prevent ECONNRESET & CORS blocks
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'public');

// Everything the app is built from is edited live; nothing here is a versioned
// asset, so there is no case for caching any of it.
const NO_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0'
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  // Health check
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, provider: 'decoupled-multi-provider', version: '5.1.0', static: true }));
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Qwen Primary AI Brain Proxy (Kaggle FastAPI via ngrok)
  // Forwards /api/proxy/qwen/* → QWEN_API_URL/*
  // ──────────────────────────────────────────────────────────────────────────
  if (req.url.startsWith('/api/proxy/qwen')) {
    // Settings wins over .env, not the other way round. The Kaggle tunnel gets
    // a new address every session, so the value someone just typed into the UI
    // is newer than anything in a file — and with .env winning, editing the
    // field appeared to do nothing at all.
    const qwenUrl = req.headers['x-qwen-endpoint'] || process.env.QWEN_API_URL;
    const qwenKey = req.headers['x-qwen-key'] || process.env.QWEN_API_KEY;

    if (!qwenUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Missing Qwen API URL. Configure QWEN_API_URL in .env' }));
      return;
    }

    let targetUrl;
    try { targetUrl = new URL(qwenUrl); } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: `Invalid Qwen endpoint URL: ${qwenUrl}` }));
      return;
    }

    // Honour a path on the configured URL. Pasting ".../api" and having the
    // "/api" silently dropped is the kind of thing that reads as the backend
    // being down.
    const basePath = targetUrl.pathname.replace(/\/+$/, '');
    const subPath = basePath + (req.url.replace('/api/proxy/qwen', '') || '/');
    let body = [];
    // Planning a full storyboard is minutes of work on the GPU behind the
    // tunnel, not seconds. Two minutes cut the connection mid-generation and
    // surfaced as "Qwen unavailable", which sent the app to the NIM fallback
    // for a request Qwen was still busy answering correctly.
    const QWEN_TIMEOUT_MS = 1800000; // 30 min
    req.setTimeout(QWEN_TIMEOUT_MS);
    res.setTimeout(QWEN_TIMEOUT_MS);

    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(body);
      const isHttps = targetUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const proxyOptions = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: subPath,
        method: req.method,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'Content-Length': buffer.length,
          'ngrok-skip-browser-warning': 'true'
        }
      };
      if (qwenKey) proxyOptions.headers['Authorization'] = `Bearer ${qwenKey}`;

      const proxyReq = transport.request(proxyOptions, (proxyRes) => {
        if (res.headersSent) return;
        res.writeHead(proxyRes.statusCode, {
          // Streamed replies must not be buffered on the way back, or a
          // token-by-token response arrives as one block at the end.
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
          'Content-Type': proxyRes.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        proxyRes.pipe(res);
      });

      // Without this the socket to a hung tunnel is held until the OS gives
      // up, and the browser sees no answer and no error either.
      proxyReq.setTimeout(QWEN_TIMEOUT_MS, () => proxyReq.destroy(new Error('Qwen backend timed out')));

      proxyReq.on('error', (err) => {
        console.warn(`⚠️  Qwen Proxy Error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: `Qwen backend unavailable: ${err.message}` }));
        }
      });

      if (buffer.length > 0) proxyReq.write(buffer);
      proxyReq.end();
    });
    return;
  }

  // CORS & TLS SNI Proxy for NVIDIA NIM Gateway (Fixes ECONNRESET & CORS NetworkError)
  if (req.url.startsWith('/api/proxy/nvidia')) {
    const targetPath = req.url.replace('/api/proxy/nvidia', '') || '/v1/chat/completions';
    console.log('NVIDIA PROXY TARGET PATH:', targetPath);
    let body = [];

    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(body);

      const sendNimRequest = (retryCount = 1) => {
        if (res.headersSent) return;

        const options = {
          hostname: 'integrate.api.nvidia.com',
          port: 443,
          path: targetPath.startsWith('/v1') ? targetPath : `/v1${targetPath}`,
          method: req.method,
          headers: {
            'Host': 'integrate.api.nvidia.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Content-Type': req.headers['content-type'] || 'application/json',
            // The caller's key wins, with .env as the fallback — the same order
            // Qwen and Fish use. Reversed, this quietly substituted the .env key
            // for whatever Settings sent, so a Test connection button reported
            // success for a key it had never used and a wrong key in Settings
            // was undetectable.
            'Authorization': req.headers['authorization']
              || (process.env.NVIDIA_NIM_API ? `Bearer ${process.env.NVIDIA_NIM_API}` : '')
              || '',
            'Content-Length': buffer.length,
            'Connection': 'close'
          },
          servername: 'integrate.api.nvidia.com',
          agent: false
        };
        console.log('NVIDIA PROXY OPTIONS.PATH:', options.path);

        const proxyReq = https.request(options, (proxyRes) => {
          if (res.headersSent) return;
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': proxyRes.headers['content-type'] || 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          console.warn('⚠️ NVIDIA Proxy Request Error:', err.message);
          if (retryCount > 0 && (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.message.includes('socket'))) {
            console.log('[NVIDIA Proxy] Retrying connection after ECONNRESET...');
            setTimeout(() => sendNimRequest(retryCount - 1), 300);
            return;
          }
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: `NVIDIA NIM Proxy Error: ${err.message}` }));
          }
        });

        if (buffer.length > 0) {
          proxyReq.write(buffer);
        }
        proxyReq.end();
      };

      sendNimRequest();
    });
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Local Stable Diffusion Proxy (Uncensored Local Studio backend at :8080)
  // Forwards /api/proxy/sd/* → http://127.0.0.1:8080/*
  // This bypasses browser CORS restrictions for the local SD server.
  // ──────────────────────────────────────────────────────────────────────────
  if (req.url.startsWith('/api/proxy/sd')) {
    let SD_HOST = '127.0.0.1';
    let SD_PORT = 1420;
    let isHttps = false;

    const headerEp = req.headers['x-sd-endpoint'];
    if (headerEp) {
      try {
        const u = new URL(headerEp.startsWith('http') ? headerEp : `http://${headerEp}`);
        isHttps = u.protocol === 'https:';
        if (u.hostname) SD_HOST = u.hostname === 'localhost' ? '127.0.0.1' : u.hostname;
        if (u.port) {
           SD_PORT = parseInt(u.port, 10);
        } else {
           SD_PORT = isHttps ? 443 : 80;
        }
      } catch (_) {}
    }

    const transport = isHttps ? https : http;
    const targetPath = req.url.replace('/api/proxy/sd', '') || '/';
    let body = [];

    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(body);
      const proxyOptions = {
        hostname: SD_HOST,
        port: SD_PORT,
        path: targetPath || '/',
        method: req.method,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'Content-Length': buffer.length,
          'ngrok-skip-browser-warning': 'true'
        }
      };

      const proxyReq = transport.request(proxyOptions, (proxyRes) => {
        const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.warn(`⚠️  SD Proxy: Cannot reach Stable Diffusion backend at ${SD_HOST}:${SD_PORT} — ${err.message}`);
        res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          error: `Stable Diffusion backend unavailable at ${SD_HOST}:${SD_PORT}: ${err.message}`,
          hint: `Start Uncensored Local Studio and make sure the endpoint in AI Settings matches ${SD_HOST}:${SD_PORT}.`
        }));
      });

      if (buffer.length > 0) proxyReq.write(buffer);
      proxyReq.end();
    });
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LTX-2.3 Video Proxy
  // Forwards /api/proxy/ltx/* → the Kaggle notebook's FastAPI (via ngrok).
  // Shaped like the SD proxy, with one important difference: a single clip can
  // take several minutes on a T4, so every default timeout in the chain has to
  // be pushed out or the render dies half-finished and looks like a backend
  // failure. Also streams binary (video/mp4) straight through for /outputs/*.
  // ──────────────────────────────────────────────────────────────────────────
  if (req.url.startsWith('/api/proxy/ltx')) {
    const LTX_TIMEOUT_MS = 20 * 60 * 1000; // a 30s clip at 720p can genuinely take this long
    let LTX_HOST = '127.0.0.1';
    let LTX_PORT = 7860;
    let isHttps = false;

    const headerEp = req.headers['x-ltx-endpoint'];
    if (headerEp) {
      try {
        const u = new URL(headerEp.startsWith('http') ? headerEp : `http://${headerEp}`);
        isHttps = u.protocol === 'https:';
        if (u.hostname) LTX_HOST = u.hostname === 'localhost' ? '127.0.0.1' : u.hostname;
        LTX_PORT = u.port ? parseInt(u.port, 10) : (isHttps ? 443 : 80);
      } catch (_) {}
    }

    const transport = isHttps ? https : http;
    const targetPath = req.url.replace('/api/proxy/ltx', '') || '/';
    const body = [];

    // Keep the inbound connection alive while the GPU works.
    req.setTimeout(LTX_TIMEOUT_MS);
    res.setTimeout(LTX_TIMEOUT_MS);

    req.on('data', (chunk) => body.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(body);
      const proxyReq = transport.request({
        hostname: LTX_HOST,
        port: LTX_PORT,
        path: targetPath,
        method: req.method,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'Content-Length': buffer.length,
          'ngrok-skip-browser-warning': 'true'
        }
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        });
        proxyRes.pipe(res);
      });

      proxyReq.setTimeout(LTX_TIMEOUT_MS, () => {
        proxyReq.destroy(new Error(`no response within ${LTX_TIMEOUT_MS / 60000} minutes`));
      });

      proxyReq.on('error', (err) => {
        console.warn(`⚠️  LTX Proxy: cannot reach LTX backend at ${LTX_HOST}:${LTX_PORT} — ${err.message}`);
        if (res.headersSent) return res.end();
        res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          error: `LTX backend unavailable at ${LTX_HOST}:${LTX_PORT}: ${err.message}`,
          hint: 'Run AETHER_LTX_Kaggle.ipynb on Kaggle (T4 x2) and paste its ngrok URL into AI Settings → LTX Video.'
        }));
      });

      if (buffer.length > 0) proxyReq.write(buffer);
      proxyReq.end();
    });
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // OpenAI OAuth Proxy (ChatGPT Account Proxy via npx openai-oauth at :10531)
  // Forwards /api/proxy/openai-oauth/* → http://127.0.0.1:10531/v1/*
  // ──────────────────────────────────────────────────────────────────────────
  if (req.url.startsWith('/api/proxy/openai-oauth')) {
    let OA_HOST = '127.0.0.1';
    let OA_PORT = 10531;

    const headerEp = req.headers['x-openai-oauth-endpoint'];
    if (headerEp) {
      try {
        const u = new URL(headerEp.startsWith('http') ? headerEp : `http://${headerEp}`);
        if (u.hostname) OA_HOST = u.hostname === 'localhost' ? '127.0.0.1' : u.hostname;
        if (u.port) OA_PORT = parseInt(u.port, 10);
      } catch (_) {}
    }

    let subPath = req.url.replace('/api/proxy/openai-oauth', '') || '/';
    if (!subPath.startsWith('/v1') && !subPath.startsWith('/v1/')) {
      subPath = '/v1' + (subPath.startsWith('/') ? subPath : '/' + subPath);
    }

    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(body);
      const proxyOptions = {
        hostname: OA_HOST,
        port: OA_PORT,
        path: subPath,
        method: req.method,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'Content-Length': buffer.length,
        }
      };

      const proxyReq = http.request(proxyOptions, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': proxyRes.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.warn(`⚠️  OpenAI OAuth Proxy: Cannot reach local openai-oauth server at ${OA_HOST}:${OA_PORT} — ${err.message}`);
        res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          error: `OpenAI OAuth proxy unavailable at ${OA_HOST}:${OA_PORT}: ${err.message}`,
          hint: 'Run "npx openai-oauth" in your terminal to start your local ChatGPT API endpoint.'
        }));
      });

      if (buffer.length > 0) proxyReq.write(buffer);
      proxyReq.end();
    });
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Pollinations.ai Image Proxy (Bypasses Cloudflare Turnstile & CORS blocks)
  // Forwards /api/proxy/pollinations → https://image.pollinations.ai
  // ──────────────────────────────────────────────────────────────────────────
  if (req.url.startsWith('/api/proxy/pollinations')) {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      let prompt = 'creative high resolution concept artwork';
      let width = 1280;
      let height = 720;
      let model = 'flux';
      let seed = null;

      try {
        if (body.length > 0) {
          const parsed = JSON.parse(Buffer.concat(body).toString());
          if (parsed.prompt) prompt = parsed.prompt;
          if (parsed.width) width = parsed.width;
          if (parsed.height) height = parsed.height;
          if (parsed.model) model = parsed.model;
          if (parsed.seed != null && Number.isFinite(Number(parsed.seed))) {
            seed = Math.abs(Math.trunc(Number(parsed.seed)));
          }
        }
      } catch (_) {}

      // The seed was previously randomised here on every request, which made a
      // consistent look across a storyboard impossible: the same prompt would
      // render a different world each time. Callers now supply a seed derived
      // from the project so a series holds together, and a re-run of one scene
      // reproduces it. Random remains the fallback for one-off images.
      if (seed == null) seed = Math.floor(Math.random() * 1000000);

      const cleanPrompt = encodeURIComponent(prompt.slice(0, 400));
      const targetUrl = `https://image.pollinations.ai/prompt/${cleanPrompt}?width=${width}&height=${height}&model=${encodeURIComponent(model)}&nologo=true&seed=${seed}`;

      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        }
      };

      const fetchWithRetry = (attemptsLeft = 4, delayMs = 1800) => {
        if (res.headersSent) return;
        https.get(targetUrl, options, (proxyRes) => {
          if (res.headersSent) return;
          if (proxyRes.statusCode === 429 && attemptsLeft > 0) {
            console.warn(`[Pollinations Proxy] Rate limited (429), retrying in ${delayMs}ms... (${attemptsLeft} attempts left)`);
            setTimeout(() => fetchWithRetry(attemptsLeft - 1, delayMs + 1000), delayMs);
            return;
          }

          if (proxyRes.statusCode !== 200) {
            res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            proxyRes.pipe(res);
            return;
          }

          res.writeHead(200, {
            'Content-Type': proxyRes.headers['content-type'] || 'image/jpeg',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache'
          });
          proxyRes.pipe(res);
        }).on('error', (err) => {
          if (res.headersSent) return;
          if (attemptsLeft > 0) {
            setTimeout(() => fetchWithRetry(attemptsLeft - 1, delayMs), delayMs);
          } else {
            res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: `Pollinations Proxy Error: ${err.message}` }));
          }
        });
      };

      fetchWithRetry();
    });
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Cloudflare Worker AI Proxy (Bypasses CORS for custom Cloudflare Workers)
  // Forwards /api/proxy/cf-worker → target worker URL in x-cf-worker-endpoint
  // ──────────────────────────────────────────────────────────────────────────
  if (req.url.startsWith('/api/proxy/cf-worker')) {
    const workerEndpoint = req.headers['x-cf-worker-endpoint'];
    const workerKey = req.headers['x-cf-worker-key'];

    if (!workerEndpoint) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Missing x-cf-worker-endpoint header.' }));
      return;
    }

    let targetUrl;
    try {
      targetUrl = new URL(workerEndpoint);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: `Invalid Cloudflare Worker endpoint URL: ${workerEndpoint}` }));
      return;
    }

    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(body);
      const isHttps = targetUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': buffer.length,
      };
      if (workerKey) {
        let cleanKey = workerKey.trim();
        if (cleanKey.toLowerCase().startsWith('bearer ')) {
          cleanKey = cleanKey.substring(7).trim();
        }
        headers['Authorization'] = `Bearer ${cleanKey}`;
      }

      const proxyOptions = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: 'POST',
        headers
      };

      const proxyReq = transport.request(proxyOptions, (proxyRes) => {
        const contentType = proxyRes.headers['content-type'] || 'image/jpeg';
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.warn(`⚠️  Cloudflare Worker Proxy Error (${targetUrl.hostname}): ${err.message}`);
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: `Failed to connect to Cloudflare Worker at ${targetUrl.hostname}: ${err.message}` }));
      });

      if (buffer.length > 0) proxyReq.write(buffer);
      proxyReq.end();
    });
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Fish Speech Proxy (Bypasses ngrok CORS and OPTIONS blocks)
  // Forwards /api/proxy/fish/* → target worker URL in x-fish-endpoint
  // ──────────────────────────────────────────────────────────────────────────
  if (req.url.startsWith('/api/proxy/fish')) {
    const fishEndpoint = req.headers['x-fish-endpoint'];

    if (!fishEndpoint) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Missing x-fish-endpoint header.' }));
      return;
    }

    let targetUrl;
    try {
      targetUrl = new URL(fishEndpoint);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: `Invalid Fish endpoint URL: ${fishEndpoint}` }));
      return;
    }

    const targetPath = req.url.replace('/api/proxy/fish', '') || '/';
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(body);
      const isHttps = targetUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const headers = {
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Accept': req.headers['accept'] || 'application/json',
        'Content-Length': buffer.length,
        'ngrok-skip-browser-warning': 'true'
      };
      // The official api.fish.audio endpoint is key-authenticated; without this
      // passthrough every request to it comes back 401.
      if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'];

      const proxyOptions = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetPath,
        method: req.method,
        headers
      };

      const proxyReq = transport.request(proxyOptions, (proxyRes) => {
        const contentType = proxyRes.headers['content-type'] || 'audio/wav';
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.warn(`⚠️  Fish Proxy Error (${targetUrl.hostname}): ${err.message}`);
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: `Failed to connect to Fish Speech at ${targetUrl.hostname}: ${err.message}` }));
      });

      if (buffer.length > 0) proxyReq.write(buffer);
      proxyReq.end();
    });
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────────────
  // Internet Archive Proxy
  // GET /api/proxy/archive/advancedsearch.php?...  → search
  // GET /api/proxy/archive/metadata/{id}           → item metadata
  // GET /api/proxy/archive/download/{id}/{file}    → the media itself
  // GET /api/proxy/archive/services/img/{id}       → thumbnail
  //
  // No API key: archive.org is open. This exists for CORS, and because
  // downloads redirect to a per-item storage host (dnNNNNNN.us.archive.org)
  // that the browser cannot follow cross-origin.
  // ──────────────────────────────────────────────────────────────────────────
  if (req.url.startsWith('/api/proxy/archive')) {
    const subPath = req.url.replace('/api/proxy/archive', '') || '/';

    // Only the read-only endpoints this app uses. An open relay to any
    // archive.org path is a bigger surface than the feature needs.
    const ALLOWED = [/^\/advancedsearch\.php/, /^\/metadata\//, /^\/download\//, /^\/services\/img\//];
    if (!ALLOWED.some((re) => re.test(subPath))) {
      res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: `Path not permitted through the archive proxy: ${subPath}` }));
      return;
    }

    const MAX_REDIRECTS = 5;
    // archive.org's storage nodes intermittently answer 500/502/503 for a file
    // that serves fine seconds later. Measured, not assumed — the same URL
    // alternates between 206 and 500 within one minute. A single attempt
    // therefore says nothing about whether the footage is available.
    const MAX_ATTEMPTS = 3;
    const TRANSIENT = [500, 502, 503, 504];

    const forward = (targetUrl, redirectsLeft, attempt = 1) => {
      const retry = (why) => {
        if (attempt >= MAX_ATTEMPTS || res.headersSent) return false;
        const wait = 500 * attempt;
        console.warn(`⚠️  Archive ${why}; retry ${attempt + 1}/${MAX_ATTEMPTS} in ${wait}ms`);
        setTimeout(() => forward(targetUrl, redirectsLeft, attempt + 1), wait);
        return true;
      };
      return sendOnce(targetUrl, redirectsLeft, attempt, retry);
    };

    const sendOnce = (targetUrl, redirectsLeft, attempt, retry) => {
      const opts = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || 443,
        path: targetUrl.pathname + targetUrl.search,
        method: 'GET',
        headers: {
          // archive.org asks that clients identify themselves.
          'User-Agent': 'AETHER-Studio/1.0 (+https://github.com/abdulrasaq26/AUTHER-AI-STUDIO)',
          'Accept': req.headers['accept'] || '*/*',
          // Ask for the bytes as they are. Node sends no Accept-Encoding by
          // default, and the storage nodes then answer a media request with
          // something this proxy cannot stream through — the symptom is an
          // ECONNRESET partway into the file rather than an error status.
          'Accept-Encoding': 'identity'
        }
      };
      // Pass a Range header through so the player can seek without pulling a
      // 300 MB film in one piece.
      if (req.headers['range']) opts.headers['Range'] = req.headers['range'];

      const proxyReq = https.request(opts, (proxyRes) => {
        const status = proxyRes.statusCode;

        // Downloads redirect to the storage node holding the item.
        if ([301, 302, 303, 307, 308].includes(status) && proxyRes.headers.location) {
          proxyRes.resume();
          if (redirectsLeft <= 0) {
            if (!res.headersSent) {
              res.writeHead(508, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ error: 'Too many redirects from archive.org' }));
            }
            return;
          }
          let next;
          try {
            next = new URL(proxyRes.headers.location, `https://${targetUrl.hostname}`);
          } catch (e) {
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ error: `Bad redirect from archive.org: ${proxyRes.headers.location}` }));
            }
            return;
          }
          return forward(next, redirectsLeft - 1);
        }

        // A transient upstream failure is not an answer about the footage.
        if (TRANSIENT.includes(status) && retry(`upstream ${status}`)) {
          proxyRes.resume();
          return;
        }

        if (res.headersSent) return;
        const headers = {
          'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*'
        };
        ['content-length', 'content-range', 'accept-ranges'].forEach((h) => {
          if (proxyRes.headers[h]) headers[h.replace(/(^|-)([a-z])/g, (m) => m.toUpperCase())] = proxyRes.headers[h];
        });
        res.writeHead(status, headers);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        if (retry(`connection error ${err.code || err.message}`)) return;
        console.warn(`⚠️  Archive Proxy Error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: `archive.org unreachable after ${MAX_ATTEMPTS} attempts: ${err.message}` }));
        }
      });

      // A large archival film is slow to start; the default would abort it.
      proxyReq.setTimeout(300000, () => proxyReq.destroy(new Error('archive.org timed out')));
      proxyReq.end();
    };

    let target;
    try {
      target = new URL(`https://archive.org${subPath}`);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: `Invalid archive path: ${subPath}` }));
      return;
    }
    forward(target, MAX_REDIRECTS);
    return;
  }

  // Pixabay Stock Media Proxy
  // POST /api/proxy/pixabay/videos → https://pixabay.com/api/videos/
  // POST /api/proxy/pixabay/photos → https://pixabay.com/api/
  // Key is passed via x-pixabay-key header and injected into query-string
  // server-side so it is never visible in client-side JavaScript.
  // ──────────────────────────────────────────────────────────────────────────
  if (req.url.startsWith('/api/proxy/pixabay')) {
    const pixabayKey = process.env.PIXABAY_API_KEY || req.headers['x-pixabay-key'];
    if (!pixabayKey) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Missing x-pixabay-key header. Configure your Pixabay API key in AI Settings.' }));
      return;
    }

    const isPhoto = req.url.includes('/photos');
    const apiPath = isPhoto ? '/api/' : '/api/videos/';

    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      let params = {};
      try {
        if (body.length > 0) params = JSON.parse(Buffer.concat(body).toString());
      } catch (_) {}

      // Inject the API key server-side — never expose it in client code.
      const qs = new URLSearchParams({ key: pixabayKey, ...params }).toString();
      const targetPath = `${apiPath}?${qs}`;

      const options = {
        hostname: 'pixabay.com',
        port: 443,
        path: targetPath,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Connection': 'close'
        },
        servername: 'pixabay.com',
        agent: false
      };

      const proxyReq = https.request(options, (proxyRes) => {
        if (res.headersSent) return;
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': proxyRes.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.warn(`⚠️  Pixabay Proxy Error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: `Pixabay proxy error: ${err.message}` }));
        }
      });

      proxyReq.end();
    });
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Pexels Stock Media Proxy
  // POST /api/proxy/pexels/videos → https://api.pexels.com/videos/search
  // POST /api/proxy/pexels/photos → https://api.pexels.com/v1/search
  // Key is passed via x-pexels-key header → Authorization header upstream.
  // ──────────────────────────────────────────────────────────────────────────
  if (req.url.startsWith('/api/proxy/pexels')) {
    const pexelsKey = process.env.PEXELS_API_KEY || req.headers['x-pexels-key'];
    if (!pexelsKey) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Missing x-pexels-key header. Configure your Pexels API key in AI Settings.' }));
      return;
    }

    const isPhoto = req.url.includes('/photos');
    const apiBase = isPhoto ? '/v1/search' : '/videos/search';

    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      let params = {};
      try {
        if (body.length > 0) params = JSON.parse(Buffer.concat(body).toString());
      } catch (_) {}

      const qs = new URLSearchParams(params).toString();
      const targetPath = `${apiBase}${qs ? '?' + qs : ''}`;

      const options = {
        hostname: 'api.pexels.com',
        port: 443,
        path: targetPath,
        method: 'GET',
        headers: {
          'Authorization': pexelsKey,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Connection': 'close'
        },
        servername: 'api.pexels.com',
        agent: false
      };

      const proxyReq = https.request(options, (proxyRes) => {
        if (res.headersSent) return;
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': proxyRes.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.warn(`⚠️  Pexels Proxy Error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: `Pexels proxy error: ${err.message}` }));
        }
      });

      proxyReq.end();
    });
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Stock CDN Download Proxy
  // POST /api/proxy/stock-download  body: { url: "https://cdn.pixabay.com/..." }
  // Downloads the actual video/photo file from a stock CDN, bypassing CORS.
  // Only allows known stock CDN domains (allowlist enforced server-side).
  // ──────────────────────────────────────────────────────────────────────────
  if (req.url.startsWith('/api/proxy/stock-download')) {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      let targetUrl = '';
      try {
        const parsed = JSON.parse(Buffer.concat(body).toString());
        targetUrl = String(parsed.url || '');
      } catch (_) {}

      if (!targetUrl || !targetUrl.startsWith('https://')) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Invalid or missing download URL in request body.' }));
        return;
      }

      let parsedUrl;
      try { parsedUrl = new URL(targetUrl); } catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Malformed download URL.' }));
        return;
      }

      // Strict domain allowlist — prevents this proxy from being used as an
      // arbitrary open proxy for non-stock resources.
      const ALLOWED_DOMAINS = [
        'cdn.pixabay.com', 'pixabay.com',
        'videos.pexels.com', 'images.pexels.com',
        'player.vimeo.com', 'vimeo.com'
      ];
      if (!ALLOWED_DOMAINS.some(d => parsedUrl.hostname === d || parsedUrl.hostname.endsWith('.' + d))) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: `Domain not in stock-CDN allowlist: ${parsedUrl.hostname}` }));
        return;
      }

      const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 min for large HD video files
      req.setTimeout(DOWNLOAD_TIMEOUT_MS);
      res.setTimeout(DOWNLOAD_TIMEOUT_MS);

      const options = {
        hostname: parsedUrl.hostname,
        port: Number(parsedUrl.port) || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
          'Connection': 'close'
        },
        servername: parsedUrl.hostname,
        agent: false
      };

      const proxyReq = https.request(options, (proxyRes) => {
        if (res.headersSent) return;
        const ct = proxyRes.headers['content-type'] || 'video/mp4';
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': ct,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400'
        });
        proxyRes.pipe(res);
      });

      proxyReq.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
        proxyReq.destroy(new Error('Stock download proxy timed out'));
      });

      proxyReq.on('error', (err) => {
        console.warn(`⚠️  Stock Download Proxy Error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: `Stock download error: ${err.message}` }));
        }
      });

      proxyReq.end();
    });
    return;
  }

  // Resolve static request path
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (urlPath === '/' || urlPath.endsWith('/')) {
    filePath = path.join(filePath, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
        if (e2) {
          res.writeHead(404);
          res.end('Not found');
        } else {
          res.writeHead(200, Object.assign({ 'Content-Type': MIME['.html'] }, NO_CACHE));
          res.end(html);
        }
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // Source is edited constantly and served straight off disk, so a cached
    // copy is always the wrong one. Without any cache header the browser picks
    // a heuristic freshness lifetime of its own and can hold JS for hours —
    // which looks exactly like a fix that did not work, and cost several
    // rounds of exactly that confusion.
    if (['.js', '.html', '.css', '.json'].includes(ext)) Object.assign(headers, NO_CACHE);
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 AETHER AI Studio running at http://localhost:${PORT}`);
});

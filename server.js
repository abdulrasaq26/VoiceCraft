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

  // CORS & TLS SNI Proxy for NVIDIA NIM Gateway (Fixes ECONNRESET & CORS NetworkError)
  if (req.url.startsWith('/api/proxy/nvidia')) {
    const targetPath = req.url.replace('/api/proxy/nvidia', '') || '/v1/chat/completions';
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
            'Authorization': req.headers['authorization'] || '',
            'Content-Length': buffer.length,
            'Connection': 'close'
          },
          servername: 'integrate.api.nvidia.com',
          agent: false
        };

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

      try {
        if (body.length > 0) {
          const parsed = JSON.parse(Buffer.concat(body).toString());
          if (parsed.prompt) prompt = parsed.prompt;
          if (parsed.width) width = parsed.width;
          if (parsed.height) height = parsed.height;
          if (parsed.model) model = parsed.model;
        }
      } catch (_) {}

      const cleanPrompt = encodeURIComponent(prompt.slice(0, 400));
      const seed = Math.floor(Math.random() * 1000000);
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
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(html);
        }
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 AETHER AI Studio running at http://localhost:${PORT}`);
});

// VoiceCraft — Static file server & Fish Audio API proxy
// Stripped from AETHER AI Studio; retains only the Fish Speech proxy and static serving.
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

const handler = (req, res) => {
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
    res.end(JSON.stringify({ ok: true, product: 'voicecraft', version: '1.0.0' }));
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AutoEditor Feature Backend
  // ──────────────────────────────────────────────────────────────────────────
  if (req.url.startsWith('/api/auto-editor/')) {
    // Rewrite URL so the AutoEditor express app matches its original routes (/render, /status, etc.)
    req.url = req.url.replace('/api/auto-editor', '');
    import('./features/auto-editor/server/index.js').then((module) => {
      const autoEditorApp = module.default;
      autoEditorApp(req, res);
    }).catch((err) => {
      console.error("AutoEditor backend failed to load:", err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'AutoEditor backend is unavailable on this environment.' }));
    });
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Fish Audio / Fish Speech Proxy
  // Forwards /api/proxy/fish/* → <x-fish-endpoint>/*
  //
  // The browser cannot reach an ngrok/Colab tunnel directly due to CORS and
  // ngrok's browser-warning interstitial. This proxy strips both problems:
  //   - Adds ngrok-skip-browser-warning to bypass the interstitial
  //   - Adds CORS headers to the response
  // The x-fish-endpoint header carries the current tunnel URL, set by the
  // user in Settings. It changes every Colab session restart.
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
  // Static file server
  // ──────────────────────────────────────────────────────────────────────────

  // Resolve static request path
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath.startsWith('/_next/') || urlPath.startsWith('/logo')) {
    urlPath = '/auto-editor' + urlPath;
  }
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
    if (['.js', '.html', '.css', '.json'].includes(ext)) Object.assign(headers, NO_CACHE);
    res.writeHead(200, headers);
    res.end(data);
  });
};

export default handler;

// Start local server if not in Vercel environment
if (!process.env.VERCEL) {
  const server = http.createServer(handler);
  server.listen(PORT, () => {
    console.log(`🎙️  VoiceCraft running at http://localhost:${PORT}`);
  });
}

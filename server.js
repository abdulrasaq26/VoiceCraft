'use strict';

// Blvck-TTS is a pure static site — every AI capability runs in the browser
// through Puter (speech, chat, images, video) and all prompt scaffolding
// lives in public/prompts.js. There is no backend logic and no API keys.
//
// This tiny zero-dependency static file server exists ONLY as a convenience
// for local development (`npm start`). To deploy, you don't need it at all:
// upload the contents of the `public/` folder to any static host — Puter
// (Dev Center → Deploy → upload the public/ folder), GitHub Pages, Netlify,
// Vercel, Cloudflare Pages, S3, etc.

const http = require('http');
const fs = require('fs');
const path = require('path');

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
  // Health check for uptime probes.
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, provider: 'puter', static: true }));
    return;
  }

  // Resolve the request path safely inside ROOT (no directory traversal).
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
      // SPA fallback: unknown paths serve index.html.
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
  console.log(`Blvck TTS (static) running at http://localhost:${PORT}`);
  console.log('Pure static build — deploy by uploading the public/ folder to any static host.');
});

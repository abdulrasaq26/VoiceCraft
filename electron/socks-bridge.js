// A local bridge that lets Chromium use an authenticated SOCKS5 proxy.
//
// Chromium can't send a username/password to a SOCKS5 server. So for such a
// proxy the studio points the tab (or browser) at this bridge instead: an
// HTTP proxy on 127.0.0.1 with its own random password (answered by Electron's
// proxy-login handling, so nothing else on the computer can use it), which
// carries every connection through the real SOCKS5 server, signing in with
// the user's credentials (RFC 1928 / RFC 1929). Host names are passed to the
// SOCKS5 server, so DNS is resolved on the proxy side, as with plain SOCKS5.
import http from 'http';
import net from 'net';
import crypto from 'crypto';

// Read exactly n bytes from a socket that's mid-handshake.
function reader(sock) {
  let buf = Buffer.alloc(0);
  let want = 0, wake = null, failed = null;
  const onData = (d) => { buf = Buffer.concat([buf, d]); if (wake && buf.length >= want) { const w = wake; wake = null; w(); } };
  const onEnd = (e) => { failed = e || new Error('SOCKS server closed the connection'); if (wake) { const w = wake; wake = null; w(); } };
  sock.on('data', onData);
  sock.once('error', onEnd);
  sock.once('close', () => onEnd());
  return {
    async take(n) {
      if (buf.length < n && !failed) { want = n; await new Promise((r) => { wake = r; }); }
      if (buf.length < n) throw failed || new Error('SOCKS handshake cut short');
      const out = buf.subarray(0, n);
      buf = buf.subarray(n);
      return out;
    },
    done() {
      sock.removeListener('data', onData);
      if (buf.length) sock.unshift(buf); // anything past the handshake belongs to the tunnel
    },
  };
}

const SOCKS_ERR = {
  1: 'general SOCKS server failure', 2: 'connection not allowed by ruleset', 3: 'network unreachable',
  4: 'host unreachable', 5: 'connection refused', 6: 'TTL expired', 7: 'command not supported', 8: 'address type not supported',
};

// Open a TCP tunnel to host:port through the SOCKS5 server.
export function socksConnect(upstream, host, port, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(upstream.port, upstream.host);
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('SOCKS5 server did not answer')); }, timeoutMs);
    const fail = (e) => { clearTimeout(timer); sock.destroy(); reject(e); };
    sock.once('error', fail);
    sock.once('connect', async () => {
      const r = reader(sock);
      try {
        const auth = !!upstream.username;
        sock.write(Buffer.from(auth ? [5, 2, 0x00, 0x02] : [5, 1, 0x00]));
        const [ver, method] = await r.take(2);
        if (ver !== 5) throw new Error('Not a SOCKS5 server');
        if (method === 0x02) {
          const u = Buffer.from(String(upstream.username || ''), 'utf8');
          const p = Buffer.from(String(upstream.password || ''), 'utf8');
          if (u.length > 255 || p.length > 255) throw new Error('SOCKS5 username or password too long');
          sock.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p]));
          const [, status] = await r.take(2);
          if (status !== 0) throw new Error('SOCKS5 server rejected the username or password');
        } else if (method === 0xff) {
          throw new Error(auth ? 'SOCKS5 server accepts none of our sign-in methods' : 'SOCKS5 server requires a username and password');
        } else if (method !== 0x00) {
          throw new Error('SOCKS5 server asked for an unsupported sign-in method');
        }
        // CONNECT, by name (remote DNS) unless it's already an IP.
        let addr;
        if (net.isIPv4(host)) addr = Buffer.from([1, ...host.split('.').map(Number)]);
        else if (net.isIPv6(host)) {
          const full = host.includes('::') ? expandV6(host) : host;
          addr = Buffer.concat([Buffer.from([4]), Buffer.from(full.split(':').flatMap((h) => { const v = parseInt(h, 16); return [v >> 8, v & 255]; }))]);
        } else {
          const name = Buffer.from(host, 'utf8');
          addr = Buffer.concat([Buffer.from([3, name.length]), name]);
        }
        sock.write(Buffer.concat([Buffer.from([5, 1, 0]), addr, Buffer.from([port >> 8, port & 255])]));
        const [v2, rep, , atyp] = await r.take(4);
        if (v2 !== 5) throw new Error('Bad SOCKS5 reply');
        if (rep !== 0) throw new Error('SOCKS5: ' + (SOCKS_ERR[rep] || 'error ' + rep));
        const skip = atyp === 1 ? 4 : atyp === 4 ? 16 : (await r.take(1))[0];
        await r.take(skip + 2);
        r.done();
        clearTimeout(timer);
        sock.removeListener('error', fail);
        resolve(sock);
      } catch (e) { fail(e); }
    });
  });
}

function expandV6(h) {
  const [a, b] = h.split('::');
  const left = a ? a.split(':') : [], right = b ? b.split(':') : [];
  return [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].join(':');
}

export class SocksBridge {
  constructor(upstream) {
    this.upstream = upstream; // { host, port, username, password }
    this.user = 'studio';
    this.pass = crypto.randomBytes(18).toString('base64url');
    this.expected = 'Basic ' + Buffer.from(`${this.user}:${this.pass}`).toString('base64');
    this.sockets = new Set();
    this.port = 0;
  }

  authorized(req) { return req.headers['proxy-authorization'] === this.expected; }

  start() {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.onRequest(req, res));
      server.on('connect', (req, sock, head) => this.onConnect(req, sock, head));
      server.on('connection', (s) => { this.sockets.add(s); s.on('close', () => this.sockets.delete(s)); });
      server.on('clientError', (e, s) => { try { s.destroy(); } catch { /* gone */ } });
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { this.server = server; this.port = server.address().port; resolve(this); });
    });
  }

  // HTTPS and WebSockets: a CONNECT tunnel.
  async onConnect(req, sock, head) {
    if (!this.authorized(req)) {
      sock.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="studio"\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url || '');
    if (!m) { sock.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    sock.on('error', () => {});
    try {
      const up = await socksConnect(this.upstream, m[1], +m[2]);
      this.sockets.add(up);
      up.on('close', () => this.sockets.delete(up));
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) up.write(head);
      up.pipe(sock); sock.pipe(up);
      up.on('error', () => sock.destroy());
      sock.on('close', () => up.destroy());
    } catch (e) {
      sock.end(`HTTP/1.1 502 Bad Gateway\r\nX-Studio-Proxy-Error: ${String(e.message).replace(/[\r\n]/g, ' ')}\r\nContent-Length: 0\r\n\r\n`);
    }
  }

  // Plain http:// requests: forwarded through a fresh tunnel each time.
  onRequest(req, res) {
    if (!this.authorized(req)) {
      res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="studio"' }); res.end(); return;
    }
    let u;
    try { u = new URL(req.url); } catch { res.writeHead(400); res.end(); return; }
    const headers = { ...req.headers };
    delete headers['proxy-authorization']; delete headers['proxy-connection'];
    const agent = new http.Agent({ keepAlive: false });
    agent.createConnection = (opts, cb) => {
      socksConnect(this.upstream, u.hostname, +(u.port || 80)).then((s) => cb(null, s), (e) => cb(e));
    };
    const up = http.request({ host: u.hostname, port: u.port || 80, method: req.method, path: u.pathname + u.search, headers, agent }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', (e) => { if (!res.headersSent) { res.writeHead(502, { 'X-Studio-Proxy-Error': String(e.message).replace(/[\r\n]/g, ' ') }); } res.end(); });
    req.pipe(up);
  }

  close() {
    for (const s of this.sockets) { try { s.destroy(); } catch { /* gone */ } }
    this.sockets.clear();
    if (this.server) this.server.close();
  }
}

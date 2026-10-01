// Proxy support for the built-in browser.
//
// Electron routes traffic per *session*, and a page's session is fixed when
// its WebContents is created. So:
//   - the browser-wide proxy is set on every profile session;
//   - a tab with its own proxy gets its own (in-memory) session, created for
//     it and seeded with its profile's cookies so it starts signed in.
// Changing a tab's proxy therefore rebuilds that tab in a new session.
//
// Sign-in: Chromium answers HTTP/HTTPS proxy logins (via Electron's login
// events, in the main process). It can't sign in to SOCKS5 at all, so a
// SOCKS5 proxy with a username/password is reached through a local bridge
// (socks-bridge.js) that does the SOCKS5 sign-in itself. Passwords are
// sealed with the OS keychain (DPAPI) and never reach a web page or the UI.
import { net, safeStorage, session } from 'electron';
import crypto from 'crypto';
import { SocksBridge, socksConnect } from './socks-bridge.js';

export const PROXY_TYPES = ['system', 'direct', 'socks5', 'http', 'https', 'custom'];
export const AUTH_TYPES = new Set(['http', 'https', 'socks5']);

const LABEL = { system: 'System', direct: 'Direct', socks5: 'SOCKS5', http: 'HTTP', https: 'HTTPS', custom: 'Custom' };

// ---- secrets: DPAPI on Windows via safeStorage; never sent to the UI ----
export function sealSecret(plain) {
  if (!plain) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(plain).toString('base64');
  } catch { /* fall through */ }
  return 'b64:' + Buffer.from(plain, 'utf8').toString('base64');
}
export function openSecret(sealed) {
  if (!sealed) return '';
  try {
    if (sealed.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(sealed.slice(4), 'base64'));
    if (sealed.startsWith('b64:')) return Buffer.from(sealed.slice(4), 'base64').toString('utf8');
  } catch { /* unreadable on this machine */ }
  return '';
}

// A stored proxy config: { type, host, port, username, passwordSealed, rules, bypass, enabled }.
export function normalizeProxy(p) {
  p = p || {};
  const type = PROXY_TYPES.includes(p.type) ? p.type : 'system';
  const out = { type, enabled: p.enabled !== false };
  if (['socks5', 'http', 'https'].includes(type)) {
    out.host = String(p.host || '').trim().replace(/^[a-z0-9]+:\/\//i, '').replace(/\/.*$/, '');
    out.port = Math.max(0, Math.min(65535, parseInt(p.port, 10) || 0)) || (type === 'socks5' ? 1080 : type === 'https' ? 443 : 8080);
  }
  if (type === 'custom') out.rules = String(p.rules || '').trim();
  if (type !== 'system' && type !== 'direct') out.bypass = String(p.bypass == null ? '<local>' : p.bypass).trim();
  if (AUTH_TYPES.has(type) && p.username) {
    out.username = String(p.username);
    out.passwordSealed = p.passwordSealed || '';
  }
  return out;
}

export function validateProxy(p) {
  if (['socks5', 'http', 'https'].includes(p.type) && !p.host) return 'Enter the proxy host.';
  if (p.type === 'custom' && !p.rules) return 'Enter proxy rules or a PAC script URL.';
  return null;
}

export function electronConfig(p) {
  switch (p.type) {
    case 'direct': return { mode: 'direct' };
    case 'socks5': case 'http': case 'https':
      return { mode: 'fixed_servers', proxyRules: `${p.type}://${p.host}:${p.port}`, proxyBypassRules: p.bypass || '<local>' };
    case 'custom':
      if (/^(https?|file|data):/i.test(p.rules) && !/[;=]/.test(p.rules)) return { mode: 'pac_script', pacScript: p.rules };
      return { mode: 'fixed_servers', proxyRules: p.rules, proxyBypassRules: p.bypass || '<local>' };
    default: return { mode: 'system' };
  }
}

// What the UI may see: no password, just whether one is saved.
export function publicProxy(p, scope) {
  p = normalizeProxy(p);
  return {
    scope, type: p.type, label: LABEL[p.type], enabled: p.enabled !== false,
    host: p.host || '', port: p.port || '', rules: p.rules || '', bypass: p.bypass || '',
    username: p.username || '', hasPassword: !!p.passwordSealed,
    summary: p.host ? `${LABEL[p.type]} · ${p.host}:${p.port}` : p.type === 'custom' ? `Custom · ${p.rules}` : LABEL[p.type],
  };
}

// Merge a UI form into a stored config. A blank password keeps the saved one
// as long as the server and user are unchanged.
export function proxyFromForm(form, prev) {
  const next = normalizeProxy(form);
  if (AUTH_TYPES.has(next.type) && next.username) {
    if (form.password) next.passwordSealed = sealSecret(String(form.password));
    else if (prev && prev.passwordSealed && prev.host === next.host && prev.port === next.port && prev.username === next.username) next.passwordSealed = prev.passwordSealed;
  }
  return next;
}

export function credentialsFor(p) {
  if (!p || !AUTH_TYPES.has(p.type) || !p.username) return null;
  return { username: p.username, password: openSecret(p.passwordSealed) };
}

// ---- SOCKS5 sign-in bridges, one per server + account, shared ----
const bridges = new Map(); // key -> Promise<SocksBridge>
const bridgeKey = (p) => [p.host, p.port, p.username, crypto.createHash('sha256').update(openSecret(p.passwordSealed)).digest('hex')].join('|');
const needsBridge = (p) => p.type === 'socks5' && !!p.username && p.enabled !== false;
function bridgeFor(p) {
  const key = bridgeKey(p);
  if (!bridges.has(key)) {
    const b = new SocksBridge({ host: p.host, port: p.port, username: p.username, password: openSecret(p.passwordSealed) });
    bridges.set(key, b.start().catch((e) => { bridges.delete(key); throw e; }));
  }
  return bridges.get(key);
}
// Close bridges no proxy uses any more.
export function pruneBridges(inUse) {
  const keep = new Set((inUse || []).filter(needsBridge).map(bridgeKey));
  for (const [key, pb] of bridges) {
    if (!keep.has(key)) { bridges.delete(key); pb.then((b) => b.close()).catch(() => {}); }
  }
}

// What Chromium is actually told, and the sign-in to give when the proxy it
// talks to asks: the real proxy, or for SOCKS5-with-login the local bridge.
export async function resolveProxy(p) {
  p = normalizeProxy(p);
  if (p.enabled === false) return { config: { mode: 'system' }, creds: null };
  if (needsBridge(p)) {
    const b = await bridgeFor(p);
    return {
      config: { mode: 'fixed_servers', proxyRules: `http://127.0.0.1:${b.port}`, proxyBypassRules: p.bypass || '<local>' },
      creds: { username: b.user, password: b.pass },
    };
  }
  return { config: electronConfig(p), creds: credentialsFor(p) };
}

// Point a session at a proxy; returns the credentials its proxy will ask for.
export async function applyToSession(ses, p) {
  try {
    const { config, creds } = await resolveProxy(p);
    await ses.setProxy(config);
    // Drop pooled connections so the change takes effect right away.
    if (ses.closeAllConnections) await ses.closeAllConnections();
    return creds;
  } catch (e) {
    console.warn('[Browser] proxy:', e.message);
    return null;
  }
}

// A copy of one session's cookies into another (a tab moving to its own
// proxy keeps its sign-ins). localStorage etc. are not copied.
export async function copyCookies(from, to) {
  let n = 0;
  let list = [];
  try { list = await from.cookies.get({}); } catch { return 0; }
  await Promise.all(list.map(async (c) => {
    const host = c.domain.replace(/^\./, '');
    const d = {
      url: `${c.secure ? 'https' : 'http'}://${host}${c.path || '/'}`,
      name: c.name, value: c.value, path: c.path, secure: c.secure, httpOnly: c.httpOnly,
      sameSite: c.sameSite,
    };
    if (!c.hostOnly) d.domain = c.domain;
    if (!c.session && c.expirationDate) d.expirationDate = c.expirationDate;
    try { await to.cookies.set(d); n++; } catch { /* e.g. partitioned cookies */ }
  }));
  return n;
}

// Try a request through the proxy from a throwaway session.
let testCounter = 0;
export async function testProxy(p, timeoutMs = 12000) {
  p = normalizeProxy(p);
  const err = validateProxy(p);
  if (err) return { ok: false, error: err };
  // SOCKS5 with a login: check the sign-in directly first, for a clear error.
  let bridge = null;
  if (needsBridge(p)) {
    try {
      const s = await socksConnect({ host: p.host, port: p.port, username: p.username, password: openSecret(p.passwordSealed) }, 'www.gstatic.com', 443, timeoutMs);
      s.destroy();
    } catch (e) { return { ok: false, error: e.message, via: `SOCKS5 ${p.host}:${p.port}` }; }
    bridge = await new SocksBridge({ host: p.host, port: p.port, username: p.username, password: openSecret(p.passwordSealed) }).start();
  }
  const ses = session.fromPartition('proxy-test-' + (++testCounter) + '-' + Date.now());
  await ses.setProxy(bridge
    ? { mode: 'fixed_servers', proxyRules: `http://127.0.0.1:${bridge.port}`, proxyBypassRules: '<local>' }
    : electronConfig(p));
  const target = 'https://www.gstatic.com/generate_204';
  let via = '';
  try { via = await Promise.race([ses.resolveProxy(target), new Promise((r) => setTimeout(() => r(''), 3000))]); } catch { /* informational */ }
  if (bridge) via = `SOCKS5 ${p.host}:${p.port} (signed in as ${p.username})`;
  const creds = bridge ? { username: bridge.user, password: bridge.pass } : credentialsFor(p);
  const t0 = Date.now();
  const result = await new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const req = net.request({ url: target, session: ses, useSessionCookies: false, redirect: 'manual' });
    let authTries = 0;
    req.on('login', (authInfo, cb) => {
      if (authInfo.isProxy && creds && authTries++ < 1) cb(creds.username, creds.password);
      else cb();
    });
    req.on('response', (res) => {
      res.on('data', () => {});
      res.on('end', () => {});
      const code = res.statusCode;
      if (code === 407) finish({ ok: false, error: 'The proxy asked for a username and password (407).' });
      else finish({ ok: code > 0 && code < 400, status: code, ms: Date.now() - t0 });
    });
    req.on('error', (e) => finish({ ok: false, error: e.message.replace(/^net::/, '') }));
    const timer = setTimeout(() => { try { req.abort(); } catch { /* gone */ } finish({ ok: false, error: `No response within ${timeoutMs / 1000}s` }); }, timeoutMs);
    req.end();
  });
  // (In-memory session: nothing to clean up.)
  if (bridge) bridge.close();
  return { ...result, via };
}

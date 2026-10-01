// content/automation/flow-api-main.js — runs in the Flow page's own world.
//
// The Automator's requests have to come from the Flow page itself: they use
// the signed-in session token and a reCAPTCHA token from Google's own
// reCAPTCHA script on the page, exactly as Flow's Generate button does.
// Content scripts can't reach either, so this small script is added to the
// page and answers requests from content/automation/flow-api.js over DOM
// events. It holds no state beyond the session it discovers.
(function () {
  if (window.__vcFlowApiReady) return;
  window.__vcFlowApiReady = true;

  const REQ = 'vc-flow-api:req';
  const RES = 'vc-flow-api:res';
  // Flow's public reCAPTCHA Enterprise site key (also read live from the page).
  const FALLBACK_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

  let apiBase = null; // e.g. "https://labs.google/fx" — where /api/auth/session answered

  // ---- flow.google.com: Google's first-party request signing ----
  // The new Flow has no session endpoint: its own code signs each API call
  // with "SAPISIDHASH" values derived from the Google session cookies (the
  // ones Google lets google.com pages read for exactly this), plus Flow's
  // public API key from the page config. The Automator signs the same way.
  const cookie = (n) => { const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + n.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; };
  async function sha1Hex(text) {
    const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function googleAuthHeader() {
    const ts = Math.floor(Date.now() / 1000);
    const origin = location.origin;
    const parts = [];
    const sap = cookie('SAPISID') || cookie('__Secure-3PAPISID');
    if (sap) parts.push(`SAPISIDHASH ${ts}_${await sha1Hex(`${ts} ${sap} ${origin}`)}`);
    const p1 = cookie('__Secure-1PAPISID');
    if (p1) parts.push(`SAPISID1PHASH ${ts}_${await sha1Hex(`${ts} ${p1} ${origin}`)}`);
    const p3 = cookie('__Secure-3PAPISID');
    if (p3) parts.push(`SAPISID3PHASH ${ts}_${await sha1Hex(`${ts} ${p3} ${origin}`)}`);
    return parts.join(' ');
  }
  function apiKey() {
    const w = window.WIZ_global_data || {};
    if (typeof w.K21R3e === 'string' && /^AIza/.test(w.K21R3e)) return w.K21R3e;
    for (const v of Object.values(w)) if (typeof v === 'string' && /^AIza[0-9A-Za-z_-]{30,}$/.test(v)) return v;
    return null;
  }
  const hasGoogleSession = () => !!(cookie('SAPISID') || cookie('__Secure-3PAPISID') || cookie('__Secure-1PAPISID'));

  async function session() {
    // New Flow (Google's own app framework): sign like the page does.
    if (window.WIZ_global_data && hasGoogleSession()) {
      return { token: '@google', base: location.origin, apiKey: apiKey(), email: null, scheme: 'google' };
    }
    const candidates = [location.origin + '/fx', location.origin, 'https://labs.google/fx'];
    if (apiBase) candidates.unshift(apiBase);
    for (const base of candidates) {
      try {
        const r = await fetch(base + '/api/auth/session', { credentials: 'include' });
        if (!r.ok) continue;
        const j = await r.json();
        if (j && j.access_token) {
          apiBase = base;
          return { token: j.access_token, email: (j.user && j.user.email) || null, base };
        }
      } catch (_) { /* try the next */ }
    }
    if (window.WIZ_global_data) return { error: "You're not signed in to Google in this tab. Sign in to Flow, reload the project, then try again." };
    return { error: 'Not signed in to Flow (no session token). Open flow.google.com and sign in.' };
  }

  function siteKey() {
    for (const s of document.querySelectorAll('script[src*="recaptcha"]')) {
      const m = /[?&]render=([\w-]{20,})/.exec(s.src);
      if (m && m[1] !== 'explicit') return m[1];
    }
    return FALLBACK_SITE_KEY;
  }

  // A reCAPTCHA token for `action`. flow.google.com poisons the public
  // execute() (tokens from other callers get flagged), so use the genuine one
  // the studio's tab preload captured before Flow's code ran
  // (window.__vcRealExecute), called from a fresh task like Flow's own calls.
  async function recaptcha(action) {
    for (let i = 0; i < 60; i++) {
      const g = window.grecaptcha && window.grecaptcha.enterprise;
      const real = typeof window.__vcRealExecute === 'function' ? window.__vcRealExecute : null;
      if (real || (g && g.execute)) {
        try {
          if (g && g.ready) await new Promise((r) => g.ready(r));
          const run = real || g.execute.bind(g);
          const token = await new Promise((resolve, reject) => setTimeout(() => {
            try { Promise.resolve(run(siteKey(), { action })).then(resolve, reject); } catch (e) { reject(e); }
          }, 0));
          if (token) return { token, genuine: !!real };
        } catch (e) { return { error: 'reCAPTCHA failed: ' + (e && e.message ? e.message : e) }; }
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return { error: "Flow's reCAPTCHA hasn't loaded — reload the Flow tab." };
  }

  let inflight = null;
  // One HTTP request from the page. method: GET | POST | PATCH. GETs to Flow's
  // own API (no token) ride on the page's cookies.
  async function request(url, method, body, token) {
    const ac = new AbortController();
    if (method !== 'GET') inflight = ac;
    try {
      const headers = {};
      if (token === '@google') {
        // New Flow: first-party signing, fresh for every call.
        headers.Authorization = await googleAuthHeader();
        headers['X-Goog-AuthUser'] = '0';
        const key = apiKey();
        if (key && /googleapis\.com\//.test(url) && !/[?&]key=/.test(url)) url += (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key);
      } else if (token) {
        // A bare token (old Flow) or a whole header Flow itself used.
        headers.Authorization = /^[A-Za-z0-9]+HASH\s|^Bearer\s/.test(token) ? token : 'Bearer ' + token;
      }
      if (body != null) headers['Content-Type'] = 'text/plain;charset=UTF-8';
      const r = await fetch(url, {
        method, headers, credentials: 'include', signal: ac.signal,
        body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      });
      const text = await r.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { /* not JSON */ }
      return r.ok ? { ok: true, status: r.status, data } : { ok: false, status: r.status, errText: text.slice(0, 600) };
    } catch (e) {
      return { ok: false, status: 0, aborted: e && e.name === 'AbortError', errText: e && e.message ? e.message : String(e) };
    } finally {
      if (inflight === ac) inflight = null;
    }
  }
  const post = (url, body, token) => request(url, 'POST', body, token);

  // ---- flow.google.com's own RPC channel (batchexecute) ----
  // The new Flow does everything through /_/AiSandboxAngularFrontend/data/
  // batchexecute with method ids (e.g. ogiZ0b = generate images). Same form
  // Flow's page posts: f.req + the page's XSRF token ("at"), session id and
  // build label from its config. Returns { ok, data } with the method's
  // decoded result.
  let rpcSeq = Math.floor(Math.random() * 9000) + 1000;
  async function rpc(rpcid, payload) {
    const w = window.WIZ_global_data || {};
    const app = (w.eptZe || '/_/AiSandboxAngularFrontend/').replace(/\/$/, '');
    rpcSeq += 100000;
    const q = new URLSearchParams({ rpcids: rpcid, 'source-path': location.pathname, hl: 'en', _reqid: String(rpcSeq), rt: 'c' });
    if (w.cfb2h) q.set('bl', w.cfb2h);
    if (w.FdrFJe) q.set('f.sid', w.FdrFJe);
    const body = 'f.req=' + encodeURIComponent(JSON.stringify([[[rpcid, JSON.stringify(payload), null, 'generic']]]))
      + (w.SNlM0e ? '&at=' + encodeURIComponent(w.SNlM0e) : '') + '&';
    const ac = new AbortController();
    inflight = ac;
    try {
      const r = await fetch(`${app}/data/batchexecute?${q}`, {
        method: 'POST', credentials: 'include', signal: ac.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' },
        body,
      });
      const text = await r.text();
      if (!r.ok) return { ok: false, status: r.status, errText: text.slice(0, 600) };
      // ")]}'" then length-prefixed JSON chunks; find this method's result.
      for (const line of text.split('\n')) {
        if (!line.startsWith('[[')) continue;
        let arr;
        try { arr = JSON.parse(line); } catch (_) { continue; }
        for (const item of arr) {
          if (item[0] === 'wrb.fr' && item[1] === rpcid) {
            if (item[2] == null) return { ok: false, status: 200, errText: 'Flow returned an error for this request' + (item[5] ? ' (' + JSON.stringify(item[5]).slice(0, 200) + ')' : '') + '.' };
            let data = null;
            try { data = JSON.parse(item[2]); } catch (_) { data = item[2]; }
            return { ok: true, status: 200, data };
          }
          if (item[0] === 'er') return { ok: false, status: 200, errText: 'Flow error: ' + JSON.stringify(item).slice(0, 300) };
        }
      }
      return { ok: false, status: 200, errText: 'Flow sent no result for ' + rpcid + '.' };
    } catch (e) {
      return { ok: false, status: 0, aborted: e && e.name === 'AbortError', errText: e && e.message ? e.message : String(e) };
    } finally {
      if (inflight === ac) inflight = null;
    }
  }

  const methods = {
    session,
    recaptcha,
    post,
    request,
    rpc,
    abort: () => { if (inflight) inflight.abort(); return true; },
    projectId: () => { const m = /\/project\/([a-f0-9-]+)/i.exec(location.pathname + location.href); return m ? m[1] : null; },
    ping: () => true,
  };

  window.addEventListener(REQ, async (e) => {
    // Details cross between the page and the extension's isolated world, where
    // objects don't survive — both directions use JSON strings.
    let msg = {};
    try { msg = typeof e.detail === 'string' ? JSON.parse(e.detail) : (e.detail || {}); } catch (_) { return; }
    const { id, method, args } = msg;
    let result;
    try {
      result = methods[method] ? await methods[method](...(args || [])) : { error: 'unknown method ' + method };
    } catch (err) {
      result = { error: err && err.message ? err.message : String(err) };
    }
    window.dispatchEvent(new CustomEvent(RES, { detail: JSON.stringify({ id, result }) }));
  });
  window.dispatchEvent(new CustomEvent(RES, { detail: JSON.stringify({ id: 'ready', result: true }) }));
})();

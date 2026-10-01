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

  async function session() {
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
    return { error: 'Not signed in to Flow (no session token). Open flow.google.com and sign in.' };
  }

  function siteKey() {
    for (const s of document.querySelectorAll('script[src*="recaptcha"]')) {
      const m = /[?&]render=([\w-]{20,})/.exec(s.src);
      if (m && m[1] !== 'explicit') return m[1];
    }
    return FALLBACK_SITE_KEY;
  }

  async function recaptcha(action) {
    for (let i = 0; i < 60; i++) {
      const g = window.grecaptcha && window.grecaptcha.enterprise;
      if (g && g.execute) {
        try {
          await new Promise((r) => (g.ready ? g.ready(r) : r()));
          const token = await g.execute(siteKey(), { action });
          if (token) return { token };
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
      // A bare token (old Flow) or a whole header Flow itself used (new Flow).
      if (token) headers.Authorization = /^[A-Za-z0-9]+HASH\s|^Bearer\s/.test(token) ? token : 'Bearer ' + token;
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

  const methods = {
    session,
    recaptcha,
    post,
    request,
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

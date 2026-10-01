// content/automation/flow-api.js
//
// The Automator's connection to Google Flow. Generation requests are the same
// ones Flow's own page sends when you press Generate — same endpoints, your
// session token, a reCAPTCHA token from Google's script on the page — so
// your account's credits, limits and Google's checks all apply as normal.
// The page-side half lives in flow-api-main.js.

(function () {
  if (window.VCFlowApi) return;

  const API = 'https://aisandbox-pa.googleapis.com';
  const REQ = 'vc-flow-api:req';
  const RES = 'vc-flow-api:res';

  const IMAGE_MODELS = { 'nano-banana-2': 'NARWHAL', 'nano-banana-pro': 'GEM_PIX_2', 'nano-banana-lite': 'HARBOR_SEAL' };
  const IMAGE_ASPECTS = {
    '16:9': 'IMAGE_ASPECT_RATIO_LANDSCAPE', '4:3': 'IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE', '1:1': 'IMAGE_ASPECT_RATIO_SQUARE',
    '3:4': 'IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR', '9:16': 'IMAGE_ASPECT_RATIO_PORTRAIT',
  };
  const VIDEO_ASPECTS = { '16:9': 'VIDEO_ASPECT_RATIO_LANDSCAPE', '9:16': 'VIDEO_ASPECT_RATIO_PORTRAIT' };

  // Text-to-video model key for Veo 3.1 at 8 seconds.
  function videoModelKey(quality, ratio) {
    const portrait = ratio === '9:16' ? '_portrait' : '';
    if (quality === 'lite') return 'veo_3_1_t2v_lite';
    if (quality === 'fast') return 'veo_3_1_t2v_fast' + portrait;
    return 'veo_3_1_t2v' + portrait; // quality
  }

  const sessionId = () => ';' + Date.now() + Math.random().toString(36).slice(2);
  const batchId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  const seed = () => Math.floor(Math.random() * 1e9);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- talking to the page-side script ----
  let ready = null;
  const pending = new Map();
  let seq = 0;

  window.addEventListener(RES, (e) => {
    let msg;
    try { msg = JSON.parse(e.detail); } catch (_) { return; }
    if (msg.id === 'ready') { if (ready && ready.resolve) ready.resolve(true); return; }
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); p(msg.result); }
  });

  function rawCall(method, args = [], timeoutMs = 120000) {
    const id = 'c' + (++seq);
    return new Promise((resolve) => {
      const t = setTimeout(() => { pending.delete(id); resolve({ error: 'timeout', ok: false, status: 0 }); }, timeoutMs);
      pending.set(id, (r) => { clearTimeout(t); resolve(r); });
      window.dispatchEvent(new CustomEvent(REQ, { detail: JSON.stringify({ id, method, args }) }));
    });
  }

  async function ensureInjected() {
    if (await rawCall('ping', [], 400) === true) return true;
    if (!ready) {
      let resolve;
      ready = { promise: new Promise((r) => { resolve = r; }) };
      ready.resolve = resolve;
      // 1. As an extension script (works where the page's CSP allows it).
      try {
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL('content/automation/flow-api-main.js');
        s.onload = () => s.remove();
        (document.head || document.documentElement).appendChild(s);
      } catch (_) { /* fall through */ }
      // 2. Inside VoiceCraft Studio the app can run it directly in the page.
      setTimeout(() => {
        if (document.documentElement.hasAttribute('data-voicecraft-host')) {
          window.postMessage({ channel: 'voicecraft-flow:to-host', type: 'inject-main', file: 'content/automation/flow-api-main.js' }, '*');
        }
      }, 800);
    }
    const ok = await Promise.race([ready.promise, sleep(6000).then(() => false)]);
    if (!ok && await rawCall('ping', [], 400) !== true) {
      ready = null;
      throw new Error("Couldn't connect to the Flow page — reload the Flow tab and try again.");
    }
    return true;
  }

  async function call(method, args, timeoutMs) {
    await ensureInjected();
    return rawCall(method, args, timeoutMs);
  }

  // ---- errors in plain words ----
  function describe(res) {
    const status = res && res.status;
    const text = ((res && res.errText) || '').toLowerCase();
    if (res && res.aborted) return { msg: 'Stopped', stopped: true };
    if (status === 429) return { msg: text.includes('daily') ? 'Daily generation limit reached — try again later.' : 'Google is rate-limiting requests — slow down (raise the pause between prompts).', fatal: text.includes('daily') };
    if (status === 401) return { msg: 'Flow session expired — refreshing…', expired: true };
    if (status === 403) {
      if (/permission|auth|credential|unauthenticated/.test(text)) return { msg: 'Flow session expired — refreshing…', expired: true };
      return { msg: 'Google blocked this request (unusual activity). Reload Flow, wait a bit, or raise the pause between prompts.', fatal: true };
    }
    if (status === 400) {
      if (text.includes('recaptcha')) return { msg: "Google's reCAPTCHA check failed — reload the Flow tab.", fatal: true };
      if (/safety|policy|blocked|filter/.test(text)) return { msg: 'Flow declined this prompt (content policy) — reword it and retry.', final: true };
      return { msg: 'Flow rejected the request (400). ' + (res.errText || '').slice(0, 160) };
    }
    if (!status) return { msg: 'No response from Flow' + (res && res.errText ? ': ' + res.errText.slice(0, 120) : '') + '.' };
    return { msg: `Flow returned an error (${status}). ` + (res.errText || '').slice(0, 160) };
  }

  class FlowApi {
    constructor() { this.session = null; }

    async connect(force = false) {
      if (this.session && !force) return this.session;
      let s = await call('session', [], 20000);
      if ((!s || !s.token) && window.__vcHost) {
        // flow.google.com has no session endpoint: use the sign-in Flow's own
        // API calls carry (the studio sees them; Flow makes some on load).
        for (let i = 0; i < 6 && !(s && s.token); i++) {
          const a = await window.__vcHost.request('get-flow-auth', {}, 5000);
          if (a && a.authorization) s = { token: a.authorization, authUser: a.authUser || null, base: location.origin, fromPage: true };
          else await new Promise((r) => setTimeout(r, 1500));
        }
      }
      if (!s || !s.token) {
        throw new Error((s && s.error && !window.__vcHost ? s.error : null)
          || "Couldn't find your Flow sign-in. Open your Flow project in this tab, make sure you're signed in, wait for it to load, then try again.");
      }
      this.session = s;
      return s;
    }

    async projectId() {
      const id = await call('projectId', [], 3000);
      if (!id) throw new Error('Open a Flow project first — the Automator adds results to the project on screen.');
      return id;
    }

    async recaptcha(action) {
      const r = await call('recaptcha', [action], 20000);
      if (!r || !r.token) throw new Error((r && r.error) || "Flow's reCAPTCHA didn't respond.");
      return r.token;
    }

    abort() { return rawCall('abort', [], 2000); }

    // Authenticated request with one automatic session refresh.
    async post(url, makeBody, method = 'POST') {
      for (let attempt = 0; attempt < 2; attempt++) {
        const s = await this.connect(attempt > 0);
        const res = await call('request', [url, method, await makeBody(), s.token], 300000);
        if (res && res.ok) return res;
        const d = describe(res);
        if (d.expired && attempt === 0) continue;
        const err = new Error(d.msg);
        err.fatal = !!d.fatal; err.stopped = !!d.stopped; err.final = !!d.final;
        throw err;
      }
      throw new Error('Flow session expired — reload the Flow tab and sign in again.');
    }

    // flow.google.com (Google's app framework) vs the older labs.google/fx site.
    isNewSite() { return !!(this.session && this.session.scheme === 'google'); }

    mediaUrl(name) {
      const base = (this.session && this.session.base) || 'https://labs.google/fx';
      return `${base}/api/trpc/media.getMediaUrlRedirect?name=${encodeURIComponent(name)}`;
    }
    thumbUrl(name) {
      return this.mediaUrl(name) + '&mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL';
    }

    // ---- the project's pictures (for @references and the picker) ----
    // Named pictures (Flow "workflows" with a display name) are addressable as
    // @name; uploads and generated images are listed for the picker. Trashed
    // ones are left out.
    async library() {
      const s = await this.connect();
      const projectId = await this.projectId();
      const input = encodeURIComponent(JSON.stringify({ json: { projectId } }));
      if (s.scheme === 'google') {
        throw new Error("Flow's new site doesn't offer the project's picture list the Automator used. Upload reference pictures with Upload…, or name results with #name and use @name in later prompts.");
      }
      const res = await call('request', [`${s.base}/api/trpc/flow.projectInitialData?input=${input}`, 'GET', null, null], 60000);
      if (!res || !res.ok) throw new Error("Couldn't read this Flow project's pictures" + (res && res.status ? ` (${res.status})` : '') + '.');
      const root = res.data && res.data.result && res.data.result.data && res.data.result.data.json && res.data.result.data.json.projectContents;
      const named = [], archived = new Set();
      if (root) {
        for (const key of Object.keys(root)) {
          if (!Array.isArray(root[key])) continue;
          for (const w of root[key]) {
            const md = w && w.metadata;
            if (!md || !md.displayName || !md.primaryMediaId) continue;
            if (md.archived) { archived.add(md.primaryMediaId); continue; }
            named.push({ handle: md.displayName, mediaId: md.primaryMediaId, workflowId: w.name || null, createTime: md.createTime || md.updateTime || '' });
          }
        }
      }
      const pictures = [];
      for (const m of (root && root.media) || []) {
        if (!m || !m.name || !m.image || archived.has(m.name)) continue;
        const createTime = (m.mediaMetadata && m.mediaMetadata.createTime) || '';
        pictures.push({ mediaId: m.name, uploaded: !!m.image.userUploadedImage, createTime });
      }
      const handleOf = new Map(named.map((n) => [n.mediaId, n.handle]));
      for (const p of pictures) p.handle = handleOf.get(p.mediaId) || null;
      pictures.sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)));
      return { projectId, named: named.filter((n) => !archived.has(n.mediaId)), pictures };
    }

    // Upload a picture from disk into the project. Returns its media id.
    async upload(file) {
      const projectId = await this.projectId();
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(new Error("Couldn't read " + file.name));
        fr.readAsDataURL(file);
      });
      const res = await this.post(`${API}/v1/flow/uploadImage`, async () => JSON.stringify({
        clientContext: { projectId, tool: 'PINHOLE' },
        fileName: file.name, imageBytes: String(dataUrl).split(',')[1],
        isHidden: false, isUserUploaded: true, mimeType: file.type || 'image/png',
      }));
      const name = res.data && res.data.media && res.data.media.name;
      if (!name) throw new Error(`Flow didn't accept ${file.name}.`);
      return name;
    }

    // Give a generated picture a name in Flow, so later prompts can use @name.
    async rename(workflowId, displayName) {
      const projectId = await this.projectId();
      await this.post(`${API}/v1/flowWorkflows/${workflowId}`, async () => JSON.stringify({
        workflow: { name: workflowId, projectId, metadata: { displayName } },
        updateMask: 'metadata.displayName',
      }), 'PATCH');
    }

    // One image. `parts` (text and @reference pieces) and `imageInputs` come
    // from resolveReferences(). Returns { name, url, thumb, workflowId }.
    async generateImage({ prompt, parts, imageInputs, model, aspect }) {
      const projectId = await this.projectId();
      const res = await this.post(`${API}/v1/projects/${projectId}/flowMedia:batchGenerateImages`, async () => {
        const ctx = {
          recaptchaContext: { applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB', token: await this.recaptcha('IMAGE_GENERATION') },
          projectId, tool: 'PINHOLE', sessionId: sessionId(),
        };
        return JSON.stringify({
          clientContext: ctx,
          mediaGenerationContext: { batchId: batchId() },
          useNewMedia: true,
          requests: [{
            clientContext: ctx,
            imageAspectRatio: IMAGE_ASPECTS[aspect] || IMAGE_ASPECTS['16:9'],
            imageInputs: imageInputs || [],
            imageModelName: IMAGE_MODELS[model] || IMAGE_MODELS['nano-banana-2'],
            seed: seed(),
            structuredPrompt: { parts: parts && parts.length ? parts : [{ text: prompt }] },
          }],
        });
      });
      const data = res.data || {};
      let name = null, fife = null, workflowId = null;
      for (const w of data.workflows || []) { if (w && w.metadata && w.metadata.primaryMediaId) { name = w.metadata.primaryMediaId; workflowId = w.name || null; break; } }
      for (const m of data.media || []) {
        if (!name && m && (m.name || m.mediaId)) name = m.name || m.mediaId;
        const f = m && m.image && m.image.generatedImage && m.image.generatedImage.fifeUrl;
        if (f && !fife) fife = f;
      }
      if (!name && !fife) throw new Error('Flow finished but returned no image (it may have been filtered).');
      // New Flow has no media redirect route: use the served URL it returned.
      if (this.isNewSite() && fife) return { name, workflowId, url: fife, thumb: fife };
      return { name, workflowId, url: name ? this.mediaUrl(name) : fife, thumb: name ? this.thumbUrl(name) : fife };
    }

    // One video: submit, then poll until Flow reports it done. Returns { url, name }.
    async generateVideo({ prompt, quality, ratio }, { onPoll, timeoutSec = 600, shouldStop } = {}) {
      const projectId = await this.projectId();
      const res = await this.post(`${API}/v1/video:batchAsyncGenerateVideoText`, async () => JSON.stringify({
        mediaGenerationContext: { batchId: batchId(), audioFailurePreference: 'BLOCK_SILENCED_VIDEOS' },
        clientContext: {
          projectId, tool: 'PINHOLE', sessionId: sessionId(), userPaygateTier: 'PAYGATE_TIER_NOT_PAID',
          recaptchaContext: { applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB', token: await this.recaptcha('VIDEO_GENERATION') },
        },
        requests: [{
          aspectRatio: VIDEO_ASPECTS[ratio] || VIDEO_ASPECTS['16:9'],
          seed: seed(), metadata: {},
          textInput: { structuredPrompt: { parts: [{ text: prompt }] } },
          videoModelKey: videoModelKey(quality, ratio),
        }],
        useV2ModelConfig: true,
      }));
      const media = res.data && res.data.media && res.data.media[0];
      const name = media && media.name;
      if (!name) throw new Error('Flow accepted the request but returned no video id.');

      const started = Date.now();
      let failures = 0;
      while (Date.now() - started < timeoutSec * 1000) {
        await sleep(5000);
        if (shouldStop && shouldStop()) { const e = new Error('Stopped'); e.stopped = true; throw e; }
        if (onPoll) onPoll(Math.round((Date.now() - started) / 1000));
        let st;
        try {
          st = await this.post(`${API}/v1/video:batchCheckAsyncVideoGenerationStatus`,
            async () => JSON.stringify({ media: [{ name, projectId }] }));
        } catch (e) {
          if (e.stopped || e.fatal || ++failures >= 5) throw e;
          continue;
        }
        failures = 0;
        const m = st.data && st.data.media && st.data.media[0];
        const ms = m && m.mediaMetadata && m.mediaMetadata.mediaStatus;
        const status = ms && ms.mediaGenerationStatus;
        if (/^MEDIA_GENERATION_STATUS_(COMPLETED?|SUCCESSFUL)$/.test(status || '')) {
          const served = this.isNewSite() ? findServedUrl(m) : null;
          if (served) return { name, url: served, thumb: served };
          return { name, url: this.mediaUrl(name), thumb: this.thumbUrl(name) };
        }
        if (status === 'MEDIA_GENERATION_STATUS_FAILED') {
          throw new Error('Flow rejected the video: ' + String(ms.failureReason || ms.errorMessage || 'no reason given').slice(0, 120));
        }
      }
      throw new Error(`Video wasn't ready after ${Math.round(timeoutSec / 60)} min.`);
    }
  }

  // The first served media URL in a Flow response object (fifeUrl, servingUri…).
  function findServedUrl(obj, depth = 0) {
    if (!obj || depth > 6) return null;
    if (typeof obj === 'string') return /^https:\/\/[^\s]+$/.test(obj) && /googleusercontent|storage\.googleapis|gstatic|fife|=s\d|video|\.mp4/i.test(obj) ? obj : null;
    if (typeof obj !== 'object') return null;
    for (const k of ['fifeUrl', 'servingUri', 'servingUrl', 'uri', 'url']) {
      if (typeof obj[k] === 'string' && /^https:\/\//.test(obj[k])) return obj[k];
    }
    for (const v of Object.values(obj)) { const u = findServedUrl(v, depth + 1); if (u) return u; }
    return null;
  }

  // Split a prompt into text and @reference parts. `lookup(handle)` returns a
  // media id or null. "@hero" or "@[hero with spaces]"; a handle matches with
  // or without its file extension, case-insensitively.
  function resolveReferences(text, lookup, max = 100) {
    const parts = [], refs = [], missing = [];
    const re = /@\[([^\]]+)\]|@([\p{L}0-9_.-]+)/gu;
    let last = 0, m;
    while ((m = re.exec(text))) {
      // Only a word-initial @ is a reference (not an e-mail address).
      if (m.index > 0 && !/[\s(["'“‘,]/.test(text[m.index - 1])) continue;
      const handle = (m[1] || m[2]).trim().replace(/[.,;:!?]+$/, '');
      // "@hero." — keep the full stop in the text, not in the handle.
      if (!m[1]) re.lastIndex = m.index + 1 + handle.length;
      const mediaId = lookup(handle);
      if (!mediaId) { missing.push(handle); continue; }
      if (m.index > last) parts.push({ text: text.slice(last, m.index) });
      parts.push({ reference: { media: { handle, mediaId } } });
      if (!refs.includes(mediaId) && refs.length < max) refs.push(mediaId);
      last = re.lastIndex;
    }
    if (last < text.length) parts.push({ text: text.slice(last) });
    if (!parts.length) parts.push({ text });
    return { parts, refs, missing };
  }
  const toImageInputs = (ids) => [...new Set(ids)].slice(0, 100).map((name) => ({ imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name }));

  window.VCFlowApi = FlowApi;
  window.VCResolveReferences = resolveReferences;
  window.VCToImageInputs = toImageInputs;
})();

// inject.js — helpers executed inside the Flow page via
// chrome.scripting.executeScript({ world: 'MAIN', func }), exposed on globalThis.__inj.
//
// Constraints:
// - Must stay un-obfuscated (the production build copies this file verbatim).
//   executeScript stringifies each function and runs it in the Flow page, which
//   has none of the bundle's scope; an obfuscated body would reference runtime
//   helpers (string-array decoder, etc.) that don't exist there.
// - Each function is self-contained and receives all inputs via parameters
//   (executeScript cannot capture closures).
(function () {
  globalThis.__inj = {
    // Flow session access token.
    getToken: async () => {
      try { return (await (await fetch('/fx/api/auth/session', { credentials: 'include' })).json()).access_token || null; } catch { return null; }
    },

    // The Google account currently logged into the Flow tab.
    getFlowEmail: async () => {
      try {
        const s = await (await fetch('/fx/api/auth/session', { credentials: 'include' })).json();
        return (s && s.user && s.user.email) || (s && s.email) || null;
      } catch { return null; }
    },

    // Project id from the Flow tab URL.
    getProjectId: () => { const m = location.href.match(/project\/([a-f0-9-]+)/); return m ? m[1] : null; },

    // Is reCAPTCHA Enterprise initialized on the page yet?
    recaptchaReady: () => !!(window.grecaptcha && window.grecaptcha.enterprise),

    // Run a reCAPTCHA Enterprise action → token.
    getRecaptcha: async (key, action) => {
      const g = window.grecaptcha && window.grecaptcha.enterprise;
      if (!g) return null;
      try { return await g.execute(key, { action }); } catch { return null; }
    },

    // POST batchGenerateImages (u=url, b=body json, t=token). Abortable via __inj.abort
    // (the controller's abort is parked on the page's window so a separate exec can call it).
    generate: async (u, b, t) => {
      const ac = new AbortController();
      window.__injAbort = () => { try { ac.abort(); } catch (_) {} };
      try {
        const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Authorization': 'Bearer ' + t }, credentials: 'include', body: b, signal: ac.signal });
        const txt = await r.text();
        if (!r.ok) return { error: 'HTTP ' + r.status, status: r.status, errText: txt.slice(0, 400) };
        try { return { ok: true, data: JSON.parse(txt) }; } catch { return { ok: true, data: null }; }
      } catch (e) { return { error: e.name === 'AbortError' ? 'aborted' : e.message, aborted: e.name === 'AbortError' }; }
      finally { window.__injAbort = null; }
    },

    // Abort an in-flight generate() (called on Stop for an immediate halt).
    abort: () => { try { if (window.__injAbort) window.__injAbort(); } catch (_) {} },

    // POST uploadImage (reference image) (u=url, b=body json, t=token) → media name.
    upload: async (u, b, t) => {
      try {
        const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Authorization': 'Bearer ' + t }, credentials: 'include', body: b });
        const txt = await r.text();
        if (!r.ok) return { error: 'HTTP ' + r.status, errText: txt.slice(0, 300) };
        try { const j = JSON.parse(txt); return { ok: true, name: j && j.media && j.media.name }; } catch { return { error: 'parse' }; }
      } catch (e) { return { error: e.message }; }
    },

    // Read the signed-in Flow account's paygate tier (key = Flow's public API key).
    // Returns { tier: 'PAYGATE_TIER_*'|null } — used to gate Ultra-only features (4K).
    getTier: async (key) => {
      try {
        const s = await (await fetch('/fx/api/auth/session', { credentials: 'include' })).json();
        const token = s && s.access_token;
        if (!token) return { error: 'no token' };
        const r = await fetch('https://aisandbox-pa.googleapis.com/v1/credits?key=' + encodeURIComponent(key), { headers: { Authorization: 'Bearer ' + token } });
        if (!r.ok) return { error: 'HTTP ' + r.status };
        const j = await r.json();
        return { tier: (j && j.userPaygateTier) || null, sku: (j && j.sku) || null };
      } catch (e) { return { error: e.message }; }
    },

    // Read the project's image media (pid=projectId). By default only user-uploaded
    // images; with incGen=true also include generated images (each item carries a
    // `generated` flag). Video media (m.video) is always excluded.
    fetchMedia: async (pid, incGen) => {
      try {
        const input = encodeURIComponent(JSON.stringify({ json: { projectId: pid } }));
        const r = await fetch('/fx/api/trpc/flow.projectInitialData?input=' + input, { credentials: 'include' });
        if (!r.ok) return { error: 'HTTP ' + r.status };
        const j = await r.json();
        const json = j && j.result && j.result.data && j.result.data.json;
        const media = (json && json.projectContents && json.projectContents.media) || [];
        const items = media
          .filter((m) => {
            if (!m || !m.name || !m.image) return false; // images only (skip m.video)
            if (m.image.userUploadedImage) return true;
            return !!(incGen && m.image.generatedImage);
          })
          .map((m) => ({ mediaId: m.name, createTime: (m.mediaMetadata && m.mediaMetadata.createTime) || '', generated: !(m.image && m.image.userUploadedImage) }));
        items.sort((a, b) => (b.createTime || '').localeCompare(a.createTime || '')); // newest first
        return { items };
      } catch (e) { return { error: e.message }; }
    },

    // Read the project's named workflows (pid=projectId) → [{ handle, mediaId, createTime }].
    // Names live on workflows (metadata.displayName), not on raw media, so we scan every
    // array in projectContents for workflow-shaped objects (robust to exact key naming).
    fetchWorkflows: async (pid) => {
      try {
        const input = encodeURIComponent(JSON.stringify({ json: { projectId: pid } }));
        const r = await fetch('/fx/api/trpc/flow.projectInitialData?input=' + input, { credentials: 'include' });
        if (!r.ok) return { error: 'HTTP ' + r.status };
        const j = await r.json();
        const root = j && j.result && j.result.data && j.result.data.json && j.result.data.json.projectContents;
        const out = [], archived = [];
        const scan = (arr) => {
          if (!Array.isArray(arr)) return;
          for (const w of arr) {
            const md = w && w.metadata;
            if (!md || !md.displayName || !md.primaryMediaId) continue;
            if (md.archived) { archived.push(md.primaryMediaId); continue; } // trashed → not a valid reference
            out.push({ handle: md.displayName, mediaId: md.primaryMediaId, createTime: md.createTime || md.updateTime || '' });
          }
        };
        if (root) for (const k of Object.keys(root)) scan(root[k]);
        return { items: out, archived };
      } catch (e) { return { error: e.message }; }
    },

    // Rename a workflow's displayName (wfId=workflowId, proj=projectId, name, tok=token).
    renameWorkflow: async (wfId, proj, name, tok) => {
      try {
        const body = JSON.stringify({ workflow: { name: wfId, projectId: proj, metadata: { displayName: name } }, updateMask: 'metadata.displayName' });
        const r = await fetch('https://aisandbox-pa.googleapis.com/v1/flowWorkflows/' + wfId, {
          method: 'PATCH', headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Authorization': 'Bearer ' + tok }, credentials: 'include', body
        });
        const txt = await r.text();
        if (!r.ok) return { error: 'HTTP ' + r.status, errText: txt.slice(0, 200) };
        return { ok: true };
      } catch (e) { return { error: e.message }; }
    },

    // 2K upscale (key=site key, mId=mediaId, proj=projectId, tok=token).
    upsample: async (key, mId, proj, tok) => {
      try {
        const g = window.grecaptcha && window.grecaptcha.enterprise;
        const rc = g ? await g.execute(key, { action: 'IMAGE_GENERATION' }) : null;
        if (!rc) return { error: 'no recaptcha' };
        const body = JSON.stringify({
          mediaId: mId,
          targetResolution: 'UPSAMPLE_IMAGE_RESOLUTION_2K',
          clientContext: {
            projectId: proj, tool: 'PINHOLE',
            recaptchaContext: { applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB', token: rc },
            sessionId: ';' + Date.now() + Math.random().toString(36).slice(2),
            userPaygateTier: 'PAYGATE_TIER_NOT_PAID'
          }
        });
        const r = await fetch('https://aisandbox-pa.googleapis.com/v1/flow/upsampleImage', {
          method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Authorization': 'Bearer ' + tok }, credentials: 'include', body
        });
        const txt = await r.text();
        if (!r.ok) return { error: 'HTTP ' + r.status, status: r.status, errText: txt.slice(0, 300) };
        let enc; try { enc = JSON.parse(txt).encodedImage; } catch { return { error: 'parse' }; }
        if (!enc) return { error: 'no encodedImage' };
        const bin = atob(enc);
        const a = new Uint8Array(bin.length);
        for (let n = 0; n < bin.length; n++) a[n] = bin.charCodeAt(n);
        return { ok: true, blobUrl: URL.createObjectURL(new Blob([a], { type: 'image/png' })) };
      } catch (e) { return { error: e.message }; }
    },

    // Load an image in-page and return a same-context blob: URL (u=url).
    toBlobUrl: (u) => new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          c.toBlob((b) => resolve(b ? { blobUrl: URL.createObjectURL(b) } : { error: 'toBlob null' }), 'image/jpeg', 0.95);
        } catch (e) { resolve({ error: e.message }); }
      };
      img.onerror = () => resolve({ error: 'image load failed' });
      img.src = u;
    }),

    // Free a previously created blob: URL (u=url).
    revoke: (u) => { try { URL.revokeObjectURL(u); } catch (_) {} }
  };
})();

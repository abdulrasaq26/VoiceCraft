// Channel Host panel wiring.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const FIELDS = [
    'channelName', 'name', 'gender', 'ageRange', 'clothingStyle',
    'personality', 'voice', 'speakingStyle', 'layout', 'size', 'position', 'background'
  ];
  const idFor = (f) => `host-${f.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`;

  let previewUrl = '';

  function status(msg, kind) {
    const el = $('host-status');
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || '';
    el.className = `status${kind ? ` ${kind}` : ''}`;
  }

  function fillOptions(sel, values) {
    if (!sel) return;
    sel.innerHTML = values
      .map((v) => (typeof v === 'string'
        ? `<option value="${v}">${v}</option>`
        : `<option value="${v.id}">${v.label}</option>`))
      .join('');
  }

  async function refreshPreview() {
    const img = $('host-preview');
    if (!img || !window.BlvckHost) return;
    const blob = await window.BlvckHost.faceBlob();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!blob) {
      previewUrl = '';
      img.hidden = true;
      return;
    }
    previewUrl = URL.createObjectURL(blob);
    img.src = previewUrl;
    img.hidden = false;
  }

  function load() {
    const h = window.BlvckHost.get();
    FIELDS.forEach((f) => {
      const el = $(idFor(f));
      if (el) el.value = h[f] == null ? '' : h[f];
    });
    const extra = $('host-ref-count');
    if (extra) {
      extra.textContent = h.refCount
        ? `${h.refCount} extra reference image(s) stored`
        : 'No extra reference images';
    }
    refreshPreview();
  }

  function persist() {
    const patch = {};
    FIELDS.forEach((f) => {
      const el = $(idFor(f));
      if (el) patch[f] = el.value;
    });
    window.BlvckHost.save(patch);
    const d = window.BlvckHost.descriptor();
    status(d ? `Host saved — “${d}”. Re-assemble the timeline to see overlay changes.` : 'Host saved.', 'info');
  }

  function init() {
    if (!$('host-card') || !window.BlvckHost) return;

    fillOptions($('host-layout'), window.BlvckHost.LAYOUTS);
    fillOptions($('host-size'), ['small', 'medium', 'large']);
    fillOptions($('host-position'), window.BlvckHost.POSITIONS);
    fillOptions($('host-age-range'), window.BlvckHost.AGE_RANGES);
    fillOptions($('host-clothing-style'), window.BlvckHost.CLOTHING_STYLES);
    fillOptions($('host-personality'), window.BlvckHost.PERSONALITIES);
    fillOptions($('host-background'), Object.keys(window.BlvckHost.BACKGROUNDS));

    load();

    FIELDS.forEach((f) => {
      const el = $(idFor(f));
      if (el) el.addEventListener('change', persist);
    });

    const face = $('host-face-upload');
    if (face) {
      face.addEventListener('change', async () => {
        const file = face.files && face.files[0];
        if (!file) return;
        await window.BlvckHost.setFace(file);
        await refreshPreview();
        status('Channel host face saved. It is stored per-channel and survives project resets.', 'info');
      });
    }

    const refs = $('host-refs-upload');
    if (refs) {
      refs.addEventListener('change', async () => {
        const files = [...(refs.files || [])];
        if (!files.length) return;
        const n = await window.BlvckHost.setReferences(files);
        load();
        status(
          `${n} reference image(s) saved${files.length > n ? ` (kept the first ${n}; the generator caps at ${window.BlvckHost.MAX_REFS})` : ''}.`,
          'info'
        );
      });
    }

    const clear = $('host-clear');
    if (clear) {
      clear.addEventListener('click', async () => {
        if (!confirm('Clear the channel host completely? This removes the face, the reference images and the profile.')) return;
        await window.BlvckHost.clear();
        // Reset the preview explicitly: revoking the object URL and hiding
        // the element is what makes this work without a page refresh.
        if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ''; }
        const img = $('host-preview');
        if (img) { img.removeAttribute('src'); img.hidden = true; }
        const face = $('host-face-upload'); if (face) face.value = '';
        const refs = $('host-refs-upload'); if (refs) refs.value = '';
        load();
        status('Channel host cleared — no host selected.', 'info');
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

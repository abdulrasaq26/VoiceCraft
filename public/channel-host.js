// Channel Host — the permanent on-screen identity of the channel.
//
// Deliberately CHANNEL-level, not project-level. The host is the thing that
// makes a viewer recognise your channel across videos, so it lives alongside
// Channel Brain rather than with per-project assets, and a project reset must
// never wipe it. data-manager.js registers it with global:false for that reason.
//
// Relationship to BlvckCast (character-library.js): a Cast character is someone
// who appears IN the story and is described in text. The Host is the presenter
// of the story, and is defined by uploaded PIXELS — their face is a fixed asset,
// not something regenerated per scene. Keeping them separate matters because
// they are consumed differently: cast descriptors go into generation prompts,
// while the host is composited straight onto the finished frame.
(() => {
  'use strict';

  const LS_KEY = 'blvck-tts:channel-host';
  const DB_NAME = 'blvck-channel';
  const STORE = 'host';

  const FACE_KEY = 'face';
  const refKey = (i) => `ref:${i}`;

  // Overlay layouts. `full` is the only one that takes the whole frame; the
  // rest leave the content visible underneath, which is the point — a presenter
  // that covers the visuals defeats the format.
  const LAYOUTS = [
    { id: 'none', label: 'No host overlay' },
    { id: 'circle', label: 'Circular avatar (webcam style)' },
    { id: 'rect', label: 'Rectangle facecam' },
    { id: 'corner', label: 'Corner presenter (soft edge)' },
    { id: 'full', label: 'Full presenter scene' }
  ];

  const SIZES = { small: 0.16, medium: 0.22, large: 0.3 };
  const POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

  const CLOTHING_STYLES = [
    'Casual business', 'Formal suit', 'Smart casual', 'Streetwear',
    'Lab coat / clinical', 'Outdoor / field'
  ];
  const PERSONALITIES = [
    'Friendly and trustworthy', 'Authoritative expert', 'Energetic and fast-paced',
    'Calm and measured', 'Investigative and sceptical', 'Warm and conversational'
  ];
  const AGE_RANGES = ['18-25', '25-35', '35-45', '45-55', '55-65', '65+'];

  const str = (v) => String(v == null ? '' : v).trim();

  function read() {
    try {
      const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      return v && typeof v === 'object' ? v : null;
    } catch {
      return null;
    }
  }

  function write(profile) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(profile));
    } catch {
      /* non-fatal */
    }
    try {
      window.dispatchEvent(new CustomEvent('blvck:host-changed'));
    } catch {
      /* no-op */
    }
  }

  function defaults() {
    return {
      channelName: '',
      name: '',
      gender: '',
      ageRange: '35-45',
      clothingStyle: 'Casual business',
      personality: 'Friendly and trustworthy',
      voice: '',
      speakingStyle: '',
      // Overlay presentation
      layout: 'none',
      size: 'medium',
      position: 'bottom-right',
      background: 'studio',
      refCount: 0,
      updatedAt: 0
    };
  }

  function get() {
    return Object.assign(defaults(), read() || {});
  }

  function save(patch) {
    const next = Object.assign(get(), patch || {}, { updatedAt: Date.now() });
    write(next);
    return next;
  }

  function isConfigured() {
    const h = read();
    return !!(h && str(h.name));
  }

  // --- reference images ----------------------------------------------------

  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('no idb'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(key, blob) {
    try {
      const db = await idbOpen();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, key);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      db.close();
      return true;
    } catch {
      return false;
    }
  }

  async function idbGet(key) {
    try {
      const db = await idbOpen();
      const v = await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readonly');
        const rq = tx.objectStore(STORE).get(key);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => rej(rq.error);
      });
      db.close();
      return v;
    } catch {
      return null;
    }
  }

  async function setFace(blob) {
    if (!blob) return false;
    const ok = await idbPut(FACE_KEY, blob);
    if (ok) save({});
    return ok;
  }

  function faceBlob() {
    return idbGet(FACE_KEY);
  }

  // Additional angles/expressions. More references give a generator more to work
  // with, but the LTX MSR path caps at 4 subjects, so there is no point storing
  // an unbounded pile.
  const MAX_REFS = 4;

  async function setReferences(blobs) {
    const list = (blobs || []).slice(0, MAX_REFS);
    for (let i = 0; i < list.length; i++) await idbPut(refKey(i), list[i]);
    save({ refCount: list.length });
    return list.length;
  }

  async function referenceBlobs() {
    const h = get();
    const out = [];
    for (let i = 0; i < (h.refCount || 0); i++) {
      const b = await idbGet(refKey(i));
      if (b) out.push(b);
    }
    return out;
  }

  function blobToBase64(blob) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => {
        const url = String(r.result || '');
        const i = url.indexOf(',');
        resolve(i > -1 ? url.slice(i + 1) : '');
      };
      r.onerror = () => resolve('');
      r.readAsDataURL(blob);
    });
  }

  // Face first, then the extra angles — ordering matters for MSR, where the
  // first subject image carries the most weight.
  async function referenceBase64List() {
    const out = [];
    const face = await faceBlob();
    if (face) out.push(await blobToBase64(face));
    for (const b of await referenceBlobs()) {
      if (out.length >= MAX_REFS) break;
      out.push(await blobToBase64(b));
    }
    return out.filter(Boolean);
  }

  async function hasFace() {
    return !!(await faceBlob());
  }

  // --- prompt text ---------------------------------------------------------

  // Canonical host description, for any generator that needs the host in text
  // form. Same fixed-order rule as the cast descriptors: a host sentence that
  // varies between scenes is a host who changes appearance between scenes.
  function descriptor() {
    const h = get();
    if (!str(h.name)) return '';
    const bits = [h.name];
    const person = [h.ageRange ? `aged ${h.ageRange}` : '', str(h.gender).toLowerCase()]
      .filter(Boolean)
      .join(', ');
    if (person) bits.push(person);
    if (h.clothingStyle) bits.push(`wearing ${String(h.clothingStyle).toLowerCase()}`);
    if (h.personality) bits.push(String(h.personality).toLowerCase());
    return bits.join(', ');
  }

  // Background description for full-presenter scenes.
  const BACKGROUNDS = {
    studio: 'a clean modern studio set with soft key lighting and a subtly blurred backdrop',
    newsroom: 'a virtual newsroom set with screens behind the presenter',
    whiteboard: 'a bright room beside a large whiteboard',
    classroom: 'a classroom with a chalkboard behind the presenter',
    documentary: 'a documentary interview setup, shallow depth of field, warm practical lighting'
  };

  function backgroundText() {
    const h = get();
    return BACKGROUNDS[h.background] || BACKGROUNDS.studio;
  }

  function clear() {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* no-op */
    }
    try {
      window.dispatchEvent(new CustomEvent('blvck:host-changed'));
    } catch {
      /* no-op */
    }
  }

  window.BlvckHost = {
    get,
    save,
    clear,
    isConfigured,
    setFace,
    faceBlob,
    hasFace,
    setReferences,
    referenceBlobs,
    referenceBase64List,
    descriptor,
    backgroundText,
    LAYOUTS,
    SIZES,
    POSITIONS,
    CLOTHING_STYLES,
    PERSONALITIES,
    AGE_RANGES,
    BACKGROUNDS,
    MAX_REFS
  };
})();

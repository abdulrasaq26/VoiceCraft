// Character Library — the canonical description of every recurring person in a
// project, and the bridge between that description and the reference portrait.
//
// Why this exists as its own module:
//
// storyboard.js already stored reference portraits (`ref:<name>` in the
// blvck-storyboard IndexedDB store) and keyed each scene's seed off the primary
// character. Its own comment explains the limitation that shaped that design —
// the Stable Diffusion adapter is text2img only, so a portrait could never be
// fed back in as conditioning, leaving the seed as the only lever.
//
// LTX-2.3 MSR removes that limitation. Its LiconStudio MSR LoRA takes 1–4
// subject images as genuine identity conditioning, so those same portraits stop
// being a hint and become the actual mechanism for keeping a face stable across
// scenes. That raises the bar on the description behind them: a portrait is only
// reusable if the character it depicts is defined once and never drifts.
//
// So this module owns the structured profile (age, ethnicity, hair, clothing,
// …), renders it to one canonical descriptor string, and hands both the text and
// the portrait to whichever generator asks — SDXL for stills, LTX for video.
(() => {
  'use strict';

  const LS_KEY = 'blvck-tts:characters';

  // Shared with storyboard.js — the portraits live in its store, and there is
  // no reason to keep a second copy.
  const DB_NAME = 'blvck-storyboard';
  const STORE = 'images';
  const refKey = (name) => `ref:${name}`;

  // Ordered so the rendered descriptor reads like a person rather than a form
  // dump. `label` drives the editor UI; `join` controls punctuation.
  const FIELDS = [
    { key: 'age', label: 'Age', hint: 'e.g. 58' },
    { key: 'gender', label: 'Gender', hint: 'e.g. Male' },
    { key: 'ethnicity', label: 'Ethnicity', hint: 'e.g. Indian' },
    { key: 'hair', label: 'Hair', hint: 'e.g. Grey' },
    { key: 'facialHair', label: 'Facial hair', hint: 'e.g. Short beard' },
    { key: 'build', label: 'Build', hint: 'e.g. Lean, stooped' },
    { key: 'clothing', label: 'Clothing', hint: 'one per line', multi: true },
    { key: 'traits', label: 'Visual traits', hint: 'one per line', multi: true },
    { key: 'notes', label: 'Notes', hint: 'anything else that must stay constant' }
  ];

  const str = (v) => String(v == null ? '' : v).trim();
  const lines = (v) =>
    (Array.isArray(v) ? v : String(v == null ? '' : v).split(/[\n,]/))
      .map((s) => String(s).trim())
      .filter(Boolean);

  function read() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }

  function write(all) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(all));
    } catch {
      /* quota — non-fatal, profiles are re-derivable from the bible */
    }
    emit();
  }

  function emit() {
    try {
      window.dispatchEvent(new CustomEvent('blvck:characters-changed'));
    } catch {
      /* no-op */
    }
  }

  const idOf = (name) => str(name).toLowerCase();

  function normalize(name, profile) {
    const p = profile || {};
    return {
      name: str(name),
      age: str(p.age),
      gender: str(p.gender),
      ethnicity: str(p.ethnicity),
      hair: str(p.hair),
      facialHair: str(p.facialHair),
      build: str(p.build),
      clothing: lines(p.clothing),
      traits: lines(p.traits),
      notes: str(p.notes),
      // Free-text fallback carried over from the storyboard bible, used only
      // when the structured fields are empty.
      description: str(p.description),
      updatedAt: Date.now()
    };
  }

  function list() {
    return Object.values(read()).sort((a, b) => str(a.name).localeCompare(str(b.name)));
  }

  function get(name) {
    return read()[idOf(name)] || null;
  }

  function upsert(name, profile) {
    const id = idOf(name);
    if (!id) return null;
    const all = read();
    const merged = normalize(name, Object.assign({}, all[id], profile));
    all[id] = merged;
    write(all);
    return merged;
  }

  function remove(name) {
    const all = read();
    delete all[idOf(name)];
    write(all);
  }

  function has(name) {
    return !!read()[idOf(name)];
  }

  // The one string every generator must agree on. Built in a fixed order so the
  // same profile always produces byte-identical text — an unstable descriptor
  // would defeat the whole point, since prompt drift moves the latent.
  function descriptorFor(name) {
    const c = get(name);
    if (!c) return str(name);

    // Descriptive fields are typed into a form ("Grey", "Male") but read as
    // mid-sentence prose here, so drop their leading capital. Ethnicity and
    // clothing are left alone — those genuinely can be proper nouns ("Indian",
    // "Nehru jacket") and lowercasing them would be wrong.
    const lc = (v) => {
      const s = str(v);
      return s ? s.charAt(0).toLowerCase() + s.slice(1) : '';
    };

    const person = [c.age ? `${c.age}-year-old` : '', str(c.ethnicity), lc(c.gender)]
      .filter(Boolean)
      .join(' ');

    const parts = [];
    parts.push(person ? `${c.name}, a ${person}` : c.name);
    if (c.build) parts.push(lc(c.build));
    if (c.hair) parts.push(`${lc(c.hair)} hair`);
    if (c.facialHair) parts.push(lc(c.facialHair));
    if (c.clothing.length) parts.push(`wearing ${c.clothing.join(' and ')}`);
    if (c.traits.length) parts.push(c.traits.map(lc).join(', '));

    const out = parts.filter(Boolean).join(', ');
    // Structured fields win; the bible's free text is only a fallback so an
    // un-edited character still contributes something.
    if (out && out !== c.name) return out;
    return c.description ? `${c.name}, ${c.description}` : c.name;
  }

  // Block appended to image/video prompts for the characters in a scene.
  function promptBlockFor(names) {
    const wanted = (Array.isArray(names) ? names : [names]).map(str).filter(Boolean);
    if (!wanted.length) return '';
    const seen = new Set();
    const out = [];
    for (const n of wanted) {
      const id = idOf(n);
      if (seen.has(id)) continue;
      seen.add(id);
      const d = descriptorFor(n);
      if (d) out.push(d);
    }
    return out.join('. ');
  }

  // Seed derivation, kept byte-identical to storyboard.js projectSeed/sceneSeed.
  // Duplicated rather than imported because the two modules load independently
  // and a missing global would silently change every seed — which would look
  // exactly like the consistency bug this system exists to prevent.
  function hash32(str_) {
    let h = 2166136261;
    const s = String(str_ || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h % 1000000);
  }

  function projectSeed() {
    return hash32((window.BlvckAssets && window.BlvckAssets.title()) || 'aether');
  }

  function seedFor(name) {
    return (projectSeed() + hash32(idOf(name))) % 1000000;
  }

  // --- reference portraits (shared store with storyboard.js) ---------------

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

  async function referenceBlob(name) {
    try {
      const db = await idbOpen();
      const blob = await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readonly');
        const rq = tx.objectStore(STORE).get(refKey(str(name)));
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => rej(rq.error);
      });
      db.close();
      return blob || null;
    } catch {
      return null;
    }
  }

  async function hasReference(name) {
    return !!(await referenceBlob(name));
  }

  async function referenceDataUrl(name) {
    const blob = await referenceBlob(name);
    if (!blob) return '';
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => resolve('');
      r.readAsDataURL(blob);
    });
  }

  // Base64 payload without the data: prefix — what the LTX /generate body wants.
  async function referenceBase64(name) {
    const url = await referenceDataUrl(name);
    const i = url.indexOf(',');
    return i > -1 ? url.slice(i + 1) : '';
  }

  // --- bible import --------------------------------------------------------

  // Seed the library from the storyboard bible's cast. Existing profiles are
  // never overwritten — a character the user has edited by hand is the
  // authority, and silently replacing their work would be worse than skipping.
  function importFromBible(bible) {
    const cast = (bible && Array.isArray(bible.characters) && bible.characters) || [];
    let added = 0;
    const all = read();
    for (const c of cast) {
      const name = str(c && c.name);
      if (!name || all[idOf(name)]) continue;
      all[idOf(name)] = normalize(name, { description: str(c.description) });
      added++;
    }
    if (added) write(all);
    return added;
  }

  /**
   * How a named character LOOKS to the procedural renderer.
   *
   * The missing join. Cast has always known what a character looks like and
   * everything it knows reached image and video PROMPTS only — descriptors,
   * seeds, reference images. The compositor drew anonymous figures with no
   * idea they had identities, so the Director could emit
   * identity=old_man_alone and the frame was byte-identical to
   * young_woman_alone. Measured: 0 differing pixels.
   *
   * DERIVED, NOT STORED, so an identity the Director invents on the spot still
   * looks consistent without anyone registering it first. A registered Cast
   * member's own seed takes precedence when present, which is what keeps a
   * named character stable across a whole project.
   *
   * Deliberately does NOT choose a free colour. Sequence colour continuity was
   * fixed two commits ago by giving the whole run one palette, and handing
   * every character an arbitrary hue would undo exactly that. Identity shifts
   * WITHIN the palette and changes size — the channel `instruct` proved does
   * most of the work in telling an adult from a child.
   */
  function appearanceFor(identity, palette) {
    const id = String(identity || '').trim().toLowerCase();
    if (!id) return null;

    let h = 2166136261;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const known = has(id) ? seedFor(id) : null;
    const seed = known != null ? Number(known) : (h >>> 0);
    const r1 = ((seed % 997) / 997);
    const r2 = (((seed >>> 7) % 991) / 991);

    // Words that describe stature outrank the hash: a child should be small
    // because it is a child, not because its name happened to hash low.
    //
    // Tested against the identity with underscores turned into spaces. `_` is
    // a WORD character in JS regex, so /\bchild\b/ does not match inside
    // "child_at_window" — there is no boundary after "child". The stature test
    // silently never fired and the child rendered adult-sized. Fourth
    // appearance of this family in one session, and the first I wrote while
    // fixing the previous three.
    const words = id.replace(/[_\-]+/g, ' ');
    const small = /\b(child|kid|boy|girl|daughter|son|baby|toddler|student|pupil)\b/.test(words);
    const large = /\b(man|woman|father|mother|doctor|officer|judge|soldier|manager)\b/.test(words);

    const base = (palette && palette.accent) || '#f5b301';
    return {
      // A shift along the palette, not a replacement for it.
      colour: shiftHue(base, (r1 - 0.5) * 26),
      scale: small ? 0.74 : (large ? 1.06 : 0.92 + r2 * 0.16),
      seed
    };
  }

  /** Rotate a hex colour's hue by a few degrees, keeping its light and sat. */
  function shiftHue(hex, deg) {
    const s = String(hex).replace('#', '');
    const n = s.length === 3 ? s.split('').map((c) => parseInt(c + c, 16))
      : [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
    if (n.some(isNaN)) return hex;
    const [r, g, b] = n.map((v) => v / 255);
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    const d = mx - mn;
    let hh = 0;
    if (d) {
      if (mx === r) hh = ((g - b) / d) % 6;
      else if (mx === g) hh = (b - r) / d + 2;
      else hh = (r - g) / d + 4;
    }
    hh = (hh * 60 + deg + 360) % 360;
    const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    const c = (1 - Math.abs(2 * l - 1)) * sat;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = l - c / 2;
    const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hh / 60) % 6];
    return '#' + seg.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
  }

  // ⚠ FIVE OF ITS SIX CALL SITES ARE IN ltx-video.js, WHICH IS SCHEDULED FOR
  // REMOVAL. Only storyboard.js:502 (importFromBible) survives that deletion.
  //
  // Cast is not orphaned by removing LTX, but it is reduced to a single
  // consumer, and everything it does for character consistency — reference
  // images, seeds, descriptors — currently only reaches image and video
  // prompts. None of it reaches the procedural renderer, which has its own
  // notion of who is on screen and no connection to this one.
  window.BlvckCast = {
    appearanceFor,
    FIELDS,
    list,
    get,
    upsert,
    remove,
    has,
    descriptorFor,
    promptBlockFor,
    seedFor,
    referenceBlob,
    referenceDataUrl,
    referenceBase64,
    hasReference,
    importFromBible
  };
})();

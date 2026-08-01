// Asset Consistency Engine for Blvck-TTS v4.0
// Manages 5 Bibles (Story, Character, Location, Style, Prop Bibles) to eliminate object & visual drift
(() => {
  'use strict';

  const BIBLE_STORAGE_KEY = 'blvck:asset_bibles';

  // These start EMPTY. They used to ship pre-filled with sample data from a
  // Black Death demo — canon "Medieval Europe 1347 Black Death plague era" and
  // style "Historical Documentary Animation / Muted Earth Tones & Sepia" — and
  // buildConsistencyPromptBlock injected them into every image prompt for every
  // project. A modern kitchen scene was being told it was medieval plague-era,
  // which both forced the sepia look and contradicted the project's own bible,
  // so the model got two incompatible briefs and drifted between them.
  const EMPTY = () => ({
    story: { canon: '', rules: [] },
    characters: {}, // { 'Thomas the Blacksmith': { traits: '...', image_url: '' } }
    locations: {},  // { 'Forge at Dusk': { description: '...' } }
    styles: { activeStyle: '', palette: '', camera: '' },
    props: {}       // { 'Sword': { description: '...', image_url: '' } }
  });

  let bibles = EMPTY();

  // Values from that sample project. Anyone who used the app before this fix
  // has them sitting in localStorage, so loading has to strip them or the old
  // behaviour survives the upgrade.
  const STALE_SEED = [
    'medieval europe 1347 black death plague era',
    'historical documentary animation',
    'muted earth tones & sepia',
    'slow cinematic panning'
  ];
  const isStale = (v) => STALE_SEED.includes(String(v || '').trim().toLowerCase());

  function loadBibles() {
    try {
      const raw = localStorage.getItem(BIBLE_STORAGE_KEY);
      if (raw) {
        bibles = { ...EMPTY(), ...JSON.parse(raw) };
      }
    } catch (e) {
      console.warn('[AssetConsistency] Failed loading bibles:', e);
    }
    let cleaned = false;
    if (bibles.story && isStale(bibles.story.canon)) { bibles.story.canon = ''; cleaned = true; }
    if (bibles.styles) {
      ['activeStyle', 'palette', 'camera'].forEach((k) => {
        if (isStale(bibles.styles[k])) { bibles.styles[k] = ''; cleaned = true; }
      });
    }
    if (cleaned) {
      console.warn('[AssetConsistency] Removed leftover sample canon/style that was being injected into every image prompt.');
      saveBibles();
    }
  }

  function saveBibles() {
    try {
      localStorage.setItem(BIBLE_STORAGE_KEY, JSON.stringify(bibles));
    } catch (e) {
      console.warn('[AssetConsistency] Failed saving bibles:', e);
    }
  }

  loadBibles();

  function setCharacter(name, details) {
    bibles.characters[name] = details;
    saveBibles();
  }

  // Store a reference portrait for a recurring character. images.js has been
  // calling this since it was written, but it was never defined — so saving a
  // character reference threw a TypeError and the portrait was lost.
  function setCharacterReference(name, imageUrl) {
    if (!name) return;
    const existing = bibles.characters[name] || { traits: '' };
    bibles.characters[name] = { ...existing, image_url: imageUrl || '' };
    saveBibles();
  }

  function getCharacterReference(name) {
    const c = bibles.characters[name];
    return (c && c.image_url) || null;
  }

  function setProp(name, details) {
    bibles.props[name] = details;
    saveBibles();
  }

  function setLocation(name, details) {
    bibles.locations[name] = details;
    saveBibles();
  }

  function setStyle(styleName, details) {
    bibles.styles = { activeStyle: styleName, ...details };
    saveBibles();
  }

  // Generate consistency prompt block to inject into image/storyboard generation
  // Emits ONLY what this channel has actually defined. It previously asserted
  // "VISUAL STYLE: ... | Palette: ..." on every call, falling back to
  // 'Historical Documentary' / 'Muted Earth Tones' when nothing was set — so
  // silence was indistinguishable from deliberately choosing a sepia
  // documentary, and that assertion overrode the project's own visual style.
  function buildConsistencyPromptBlock(detectedChars = [], detectedProps = [], detectedLoc = '') {
    const lines = [];
    const s = bibles.styles || {};

    if (s.activeStyle || s.palette) {
      const bits = [s.activeStyle, s.palette && `Palette: ${s.palette}`].filter(Boolean);
      lines.push(`VISUAL STYLE: ${bits.join(' | ')}`);
    }

    if (bibles.story && bibles.story.canon) {
      lines.push(`CANON ERA: ${bibles.story.canon}`);
    }

    if (detectedLoc && bibles.locations[detectedLoc]) {
      lines.push(`LOCATION RULES (${detectedLoc}): ${bibles.locations[detectedLoc].description}`);
    }

    for (const charName of detectedChars) {
      if (bibles.characters[charName]) {
        lines.push(`CHARACTER (${charName}): ${bibles.characters[charName].traits}`);
      }
    }

    for (const propName of detectedProps) {
      if (bibles.props[propName]) {
        lines.push(`PROP (${propName}): ${bibles.props[propName].description}`);
      }
    }

    return lines.join('\n');
  }

  // Wipe the canon and style rules. These persist across projects by design
  // (a channel's recurring cast is worth keeping), but a leftover era or
  // palette from a previous video actively fights the next one, so it has to
  // be clearable without hunting through localStorage.
  function resetCanon() {
    bibles.story = { canon: '', rules: [] };
    bibles.styles = { activeStyle: '', palette: '', camera: '' };
    saveBibles();
  }

  function resetAll() {
    bibles = EMPTY();
    saveBibles();
  }

  window.AssetConsistency = {
    getBibles: () => bibles,
    setCharacter,
    setCharacterReference,
    getCharacterReference,
    setProp,
    setLocation,
    setStyle,
    resetCanon,
    resetAll,
    buildConsistencyPromptBlock
  };
})();

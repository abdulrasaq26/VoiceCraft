// Asset Consistency Engine for Blvck-TTS v4.0
// Manages 5 Bibles (Story, Character, Location, Style, Prop Bibles) to eliminate object & visual drift
(() => {
  'use strict';

  const BIBLE_STORAGE_KEY = 'blvck:asset_bibles';

  let bibles = {
    story: { canon: 'Medieval Europe 1347 Black Death plague era', rules: [] },
    characters: {}, // { 'Thomas the Blacksmith': { traits: 'Tall, bearded, leather apron', image_url: '' } }
    locations: {},  // { 'Forge at Dusk': { description: 'Stone forge, glowing coals, wooden rafters' } }
    styles: { activeStyle: 'Historical Documentary Animation', palette: 'Muted Earth Tones & Sepia', camera: 'Slow Cinematic Panning' },
    props: {}       // { 'Blacksmith Sword': { description: 'Double-edged broadsword with baronial crest insignia', image_url: '' } }
  };

  function loadBibles() {
    try {
      const raw = localStorage.getItem(BIBLE_STORAGE_KEY);
      if (raw) {
        bibles = { ...bibles, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.warn('[AssetConsistency] Failed loading bibles:', e);
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
  function buildConsistencyPromptBlock(detectedChars = [], detectedProps = [], detectedLoc = '') {
    const lines = [];

    lines.push(`VISUAL STYLE: ${bibles.styles.activeStyle || 'Historical Documentary'} | Palette: ${bibles.styles.palette || 'Muted Earth Tones'}`);

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

  window.AssetConsistency = {
    getBibles: () => bibles,
    setCharacter,
    setProp,
    setLocation,
    setStyle,
    buildConsistencyPromptBlock
  };
})();

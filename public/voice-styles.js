// Multi-reference emotion for Fish Speech.
//
// Fish has no emotion parameter and no tag parser — expression is carried
// entirely by the reference clip (see docs/FISH_VOICE_STUDIO_SPEC.md). So an
// "emotion" here is a sibling reference of the same speaker, named
// `Speaker__style`:
//
//     Aria__neutral   Aria__warm    Aria__urgent
//     Atlas__neutral  Atlas__somber
//
// That gives per-passage delivery without asking the engine for anything it
// does not have: a marker like [urgent] in the script is resolved HERE into a
// reference_id, the script is split at those markers, and each segment is
// synthesized against its own reference. The engine only ever receives plain
// text and a reference id — it never sees a tag.
(() => {
  'use strict';

  const SEP = '__';

  function parseId(id) {
    const s = String(id || '');
    const i = s.indexOf(SEP);
    if (i === -1) return { speaker: s, style: null, id: s };
    return { speaker: s.slice(0, i), style: s.slice(i + SEP.length) || null, id: s };
  }

  function makeId(speaker, style) {
    return style ? `${speaker}${SEP}${style}` : String(speaker);
  }

  const titleCase = (s) => String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

  // Group a flat voice list by speaker. Speakers with no variants still get an
  // entry so callers can treat both shapes the same way.
  function groupBySpeaker(voices) {
    const groups = new Map();
    (voices || []).forEach((v) => {
      const { speaker, style } = parseId(v.id);
      if (!groups.has(speaker)) groups.set(speaker, { speaker, variants: [] });
      groups.get(speaker).variants.push({ id: v.id, style, voice: v });
    });
    return [...groups.values()];
  }

  // Styles available for the speaker that owns `voiceId`, as {style: id}.
  // Empty when the speaker has no variants.
  function styleMapFor(voiceId, voices) {
    const { speaker } = parseId(voiceId);
    const map = {};
    (voices || []).forEach((v) => {
      const p = parseId(v.id);
      if (p.speaker === speaker && p.style) map[p.style.toLowerCase()] = v.id;
    });
    return map;
  }

  function hasVariants(voiceId, voices) {
    return Object.keys(styleMapFor(voiceId, voices)).length > 0;
  }

  // Split a script at [style] markers into segments, each carrying the
  // reference id it should be synthesized with.
  //
  // Only markers that name a real variant of this speaker switch anything.
  // Anything else is left for stripPerformanceTags to remove, because an
  // unrecognised bracket would otherwise be read aloud.
  function segmentScript(text, voiceId, voices) {
    const src = String(text || '');
    const styles = styleMapFor(voiceId, voices);
    const segments = [];
    let current = { reference_id: voiceId, style: parseId(voiceId).style, text: '' };

    const re = /\[([^\]\n]{1,40})\]/g;
    let last = 0, m;
    while ((m = re.exec(src)) !== null) {
      const key = m[1].trim().toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(styles, key)) continue; // not ours
      current.text += src.slice(last, m.index);
      if (current.text.trim()) segments.push({ ...current, text: current.text.trim() });
      current = { reference_id: styles[key], style: key, text: '' };
      last = re.lastIndex;
    }
    current.text += src.slice(last);
    if (current.text.trim()) segments.push({ ...current, text: current.text.trim() });

    return segments.length ? segments : [{ reference_id: voiceId, style: parseId(voiceId).style, text: src.trim() }];
  }

  // Does this script actually use emotion markers for this speaker?
  function usesStyleMarkers(text, voiceId, voices) {
    return segmentScript(text, voiceId, voices).length > 1;
  }

  // Fish returns nothing but a reference id, so the picker's gender/style
  // filters have nothing to work with unless we read the id itself. Our own
  // pack encodes both (Aria_Female_Warm, Atlas_Documentary), so infer from
  // those tokens — and stay neutral for user-cloned names we cannot know,
  // rather than guessing someone's voice wrong.
  const GENDER_TOKENS = [
    [/(^|[_\- ])(female|woman|fem)([_\- ]|$)/i, 'FEMALE'],
    [/(^|[_\- ])(male|man)([_\- ]|$)/i, 'MALE']
  ];

  // Maps to the picker's own style vocabulary; anything unrecognised is left
  // as plain narration instead of inventing a category.
  const STYLE_TOKENS = [
    [/documentary/i, 'documentary'],
    [/narrator|narration/i, 'narration'],
    [/storytell|story|sage/i, 'storytelling'],
    [/audiobook/i, 'audiobook'],
    [/expressive|dramatic|urgent|angry|excited/i, 'dramatic'],
    [/whisper|asmr|calm|somber|sad/i, 'asmr'],
    [/conversation|warm|natural|happy|friendly/i, 'conversational'],
    [/educational|teach|lesson/i, 'educational'],
    [/cinematic|trailer|epic/i, 'cinematic'],
    [/character|charact/i, 'character']
  ];

  function inferTraits(id) {
    const hay = String(id || '').replace(/__/g, ' ');
    let gender = 'NEUTRAL';
    for (const [re, g] of GENDER_TOKENS) if (re.test(hay)) { gender = g; break; }
    const styles = [];
    for (const [re, s] of STYLE_TOKENS) if (re.test(hay) && !styles.includes(s)) styles.push(s);
    return { gender, styles: styles.length ? styles : ['narration'] };
  }

  window.BlvckVoiceStyles = {
    inferTraits,
    SEP,
    parseId,
    makeId,
    titleCase,
    groupBySpeaker,
    styleMapFor,
    hasVariants,
    segmentScript,
    usesStyleMarkers
  };
})();

// Speech Director & Prosody Studio for AetherStudio
//
// Engine-agnostic on purpose. Everything here works by rewriting the SCRIPT
// TEXT itself — punctuation, ellipses and paragraph breaks — never by emitting
// engine-specific markup. That matters because our TTS engines read plain
// punctuation but none of them parse performance tags: self-hosted Fish Speech
// S2 Pro has no tag parser at all (verified against its source), so a literal
// "[whisper]" would be read aloud or corrupt the line. See
// docs/FISH_VOICE_STUDIO_SPEC.md.
(() => {
  'use strict';

  // Bracketed performance tags ("[whisper]", "[dramatic pause]") are read
  // literally by every engine we support, so they are stripped before the text
  // can reach synthesis. Bounded to short spans so ordinary bracketed prose is
  // left alone.
  function stripPerformanceTags(text) {
    if (!text) return '';
    return String(text)
      .replace(/\[[^\]\n]{1,40}\]/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ +([,.!?;:])/g, '$1')
      .trim();
  }

  // Number & Date Naturalizer
  function naturalizeNumbersAndDates(text) {
    if (!text || typeof text !== 'string') return '';
    let result = text;

    // 1. Convert 4-digit years (1900-2099) into words e.g. 1945 -> nineteen forty-five, 1912 -> nineteen twelve
    result = result.replace(/\b(19|20)(\d{2})\b/g, (match, century, decade) => {
      const cNum = parseInt(century, 10);
      const dNum = parseInt(decade, 10);
      const cWords = { 19: 'nineteen', 20: 'twenty' }[cNum];
      if (dNum === 0) return `${cWords} hundred`;
      if (dNum < 10) return `${cWords} oh-${numberToWord(dNum)}`;
      return `${cWords} ${numberToWord(dNum)}`;
    });

    // 2. Convert currencies e.g. $50 -> fifty dollars, $1000 -> one thousand dollars
    result = result.replace(/\$([0-9,]+)/g, (match, amount) => {
      const num = parseInt(amount.replace(/,/g, ''), 10);
      return `${numberToWord(num)} dollars`;
    });

    // 3. Convert small cardinal numbers (1-20)
    result = result.replace(/\b([1-9]|1[0-9]|20)\b/g, (match, num) => {
      return numberToWord(parseInt(num, 10));
    });

    return result;
  }

  function numberToWord(n) {
    const units = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

    if (n < 20) return units[n] || String(n);
    if (n < 100) {
      const t = Math.floor(n / 10);
      const u = n % 10;
      return tens[t] + (u ? `-${units[u]}` : '');
    }
    if (n < 1000) {
      const h = Math.floor(n / 100);
      const rem = n % 100;
      return `${units[h]} hundred${rem ? ` ${numberToWord(rem)}` : ''}`;
    }
    return String(n);
  }

  // Automatic Prosody & Pause Generator
  //
  // `intensityPercent` is a real dial, not decoration: light rules apply from
  // 10%, and the opinionated style-specific emphasis only kicks in past 50%, so
  // the default setting stays close to the author's own punctuation.
  function generateProsodyPauses(script, style = 'documentary', intensityPercent = 50) {
    if (!script) return '';
    // Never let a pasted performance tag survive into synthesis.
    let text = stripPerformanceTags(String(script).trim());

    const intensity = Math.max(0, Math.min(100, intensityPercent)) / 100;

    // 1. Convert sentence ends into paragraph breaks
    text = text.replace(/([.!?])\s+/g, '$1\n\n');

    // 2. Lengthen the beat on clause punctuation. The punctuation itself is
    //    kept — dropping it (the previous behaviour) turned "Hello, world" into
    //    "Hello... world" and lost the comma's own grammatical cue.
    if (intensity > 0.1) {
      text = text.replace(/([,;])\s+/g, '$1.. ');
      text = text.replace(/\s*—\s*/g, '... ');
    }

    // 3. Style-specific emphasis. Opt-in above half intensity because these are
    //    interpretive: they change how a line is performed, not just how long
    //    the gaps are.
    if (intensity > 0.5) {
      if (style === 'documentary' || style === 'historical') {
        // Only the documentary "In... 1943," idiom: a clause-opening
        // preposition followed by a date or proper noun. The previous rule
        // matched every preposition regardless of case or what followed, so
        // ordinary phrases became "in... the" and "at... it" and the delivery
        // stuttered.
        text = text.replace(/(^|\n|[.!?]\s*)(In|During|After|Before|By)\s+(?=[A-Z0-9])/g, '$1$2... ');
      } else if (style === 'storytelling') {
        text = text.replace(/\b(slowly|suddenly|quietly|without warning|in the shadows)\b/gi, '$1...');
      } else if (style === 'motivational') {
        text = text.replace(/\b(never|always|remember|listen)\b/gi, '$1...');
      }
    }

    // 4. Clean double pauses and excessive newlines
    text = text.replace(/\.{4,}/g, '...');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
  }

  // Full Script Optimization Pipeline
  function optimizeScript(script, options = {}) {
    const {
      style = 'documentary',
      intensity = 50,
      naturalizeDates = true,
      naturalizeCurrencies = true
    } = options;

    let processed = stripPerformanceTags(script);

    if (naturalizeDates || naturalizeCurrencies) {
      processed = naturalizeNumbersAndDates(processed);
    }

    processed = generateProsodyPauses(processed, style, intensity);

    return processed;
  }

  // Speech Analytics Engine
  function analyzeSpeechStats(script, speed = 1.0, style = 'documentary') {
    if (!script) {
      return { durationText: '0m 0s', words: 0, wpm: 0, pauseCount: 0, style };
    }

    const words = script.trim().split(/\s+/).filter(Boolean).length;
    const pauseCount = (script.match(/\.\.\.|\n\n/g) || []).length;

    // Base WPM by style
    const baseWPM = {
      documentary: 130,
      historical: 125,
      storytelling: 135,
      educational: 145,
      motivational: 160,
      news: 170,
      podcast: 150
    }[style.toLowerCase()] || 140;

    const effectiveWPM = Math.round(baseWPM * speed);
    const totalMinutes = words / Math.max(50, effectiveWPM) + (pauseCount * 0.02);
    const mins = Math.floor(totalMinutes);
    const secs = Math.round((totalMinutes - mins) * 60);

    return {
      durationText: `${mins}m ${secs}s`,
      words,
      wpm: effectiveWPM,
      pauseCount,
      style
    };
  }

  // Traits worth matching on, and the words that hint at them. Scored against
  // whatever metadata a voice actually carries, so this works for any provider.
  const INTENT_TRAITS = [
    { when: /history|medieval|ancient|war|documentary|battle|empire/i,
      look: ['documentary', 'narrator', 'authoritative', 'deep', 'historical', 'atlas'] },
    { when: /story|mystery|suspense|thriller|horror|legend/i,
      look: ['storytelling', 'fable', 'dramatic', 'deep', 'sage', 'expressive'] },
    { when: /science|tech|educational|tutorial|lesson|explain/i,
      look: ['educational', 'clear', 'bright', 'professional', 'michael'] },
    { when: /uk|british|royal|london/i,
      look: ['uk', 'british', 'gb', 'bm_', 'bf_'] },
    { when: /calm|meditation|sleep|relax|asmr/i,
      look: ['calm', 'warm', 'soft', 'natural', 'river'] },
    { when: /news|report|breaking|update/i,
      look: ['news', 'broadcast', 'professional', 'crisp'] }
  ];

  // AI Voice Recommender (Auto Select Best Voice)
  //
  // Picks from the voices that are actually loaded for the ACTIVE provider.
  // It used to return hardcoded Kokoro ids (af_heart, bm_fable, ...) whatever
  // the provider was, so with Fish Audio selected it recommended voices that do
  // not exist on that engine and the caller silently fell through to a no-op.
  function autoSelectBestVoice(topic = '', style = 'documentary', availableVoices = null) {
    const voices = Array.isArray(availableVoices) && availableVoices.length
      ? availableVoices
      : (typeof window !== 'undefined' && window.getTtsProvider && window.BlvckAI
          ? (window.getTtsProvider(window.BlvckAI.ttsProvider()).voices() || [])
          : []);

    if (!voices.length) {
      return { voiceId: null, voiceName: null, reason: 'No voices are loaded for the active provider yet.' };
    }

    const intent = `${topic} ${style}`;
    const wanted = INTENT_TRAITS.filter((t) => t.when.test(intent)).flatMap((t) => t.look);

    const describe = (v) => [
      v.id, v.name, v.descriptor, v.family, v.gender, v.accent, v.age,
      Array.isArray(v.styles) ? v.styles.join(' ') : v.styles
    ].filter(Boolean).join(' ').toLowerCase();

    let best = null, bestScore = 0, bestHits = [];
    for (const v of voices) {
      const hay = describe(v);
      const hits = wanted.filter((w) => hay.includes(w));
      if (hits.length > bestScore) { best = v; bestScore = hits.length; bestHits = hits; }
    }

    if (!best) {
      const fallback = voices[0];
      return {
        voiceId: fallback.id,
        voiceName: fallback.name || fallback.id,
        // Say so plainly rather than inventing a rationale for an arbitrary pick.
        reason: `No voice metadata matched "${style}", so this is simply the first available voice.`
      };
    }

    return {
      voiceId: best.id,
      voiceName: best.name || best.id,
      reason: `Matched ${bestHits.slice(0, 3).map((h) => `"${h}"`).join(', ')} for a ${style} script.`
    };
  }

  window.BlvckSpeechDirector = {
    naturalizeNumbersAndDates,
    generateProsodyPauses,
    stripPerformanceTags,
    optimizeScript,
    analyzeSpeechStats,
    autoSelectBestVoice
  };

  // Back-compat alias. The module was named for Kokoro but was never
  // Kokoro-specific — it only ever rewrote punctuation.
  window.KokoroSpeechDirector = window.BlvckSpeechDirector;
})();

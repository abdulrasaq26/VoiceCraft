// Kokoro Speech Director & Prosody Studio for Blvck-TTS v5.2
// Advanced prosody engine, automatic pause generator, date/number naturalizer, voice recommendation, and speech analytics
(() => {
  'use strict';

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
  function generateProsodyPauses(script, style = 'documentary', intensityPercent = 50) {
    if (!script) return '';
    let text = String(script).trim();

    const intensity = Math.max(0, Math.min(100, intensityPercent)) / 100;

    // 1. Convert sentence ends into paragraph breaks
    text = text.replace(/([.!?])\s+/g, '$1\n\n');

    // 2. Insert pause markers (...) on clause punctuation (commas, semicolons, dashes)
    if (intensity > 0.1) {
      text = text.replace(/([,;—])\s+/g, '... ');
    }

    // 3. Style-specific pause insertions
    if (style === 'documentary' || style === 'historical') {
      text = text.replace(/\b(in|on|by|at|during|after|before)\s+([a-zA-Z0-9]+)/gi, '$1... $2');
      text = text.replace(/\b(began|ended|discovered|defeated|built|sailed|crossed|fought)\b/gi, '$1...');
    } else if (style === 'storytelling') {
      text = text.replace(/\b(slowly|suddenly|quietly|without warning|in the shadows|deep|dark|silent)\b/gi, '$1...');
    } else if (style === 'motivational') {
      text = text.replace(/\b(never|always|today|now|remember|listen|focus)\b/gi, '$1...!');
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

    let processed = script;

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

  // AI Voice Recommender (Auto Select Best Voice)
  function autoSelectBestVoice(topic = '', style = 'documentary') {
    const haystack = `${topic} ${style}`.toLowerCase();

    if (/history|medieval|ancient|war|documentary|battle/i.test(haystack)) {
      return { voiceId: 'af_heart', voiceName: 'Kokoro Heart (US Female)', reason: 'Warm, authoritative historical documentary tone.' };
    }
    if (/story|mystery|suspense|thriller/i.test(haystack)) {
      return { voiceId: 'bm_fable', voiceName: 'Kokoro Fable (UK Male)', reason: 'Deep, suspenseful British storytelling voice.' };
    }
    if (/science|tech|educational|tutorial|lesson/i.test(haystack)) {
      return { voiceId: 'am_michael', voiceName: 'Kokoro Michael (US Male)', reason: 'Clear, engaging educational narrator.' };
    }
    if (/uk|british|royal|empire/i.test(haystack)) {
      return { voiceId: 'bf_emma', voiceName: 'Kokoro Emma (UK Female)', reason: 'Prestige British narration voice.' };
    }

    return { voiceId: 'af_bella', voiceName: 'Kokoro Bella (US Female)', reason: 'Versatile, high-clarity all-round narrator.' };
  }

  window.KokoroSpeechDirector = {
    naturalizeNumbersAndDates,
    generateProsodyPauses,
    optimizeScript,
    analyzeSpeechStats,
    autoSelectBestVoice
  };
})();

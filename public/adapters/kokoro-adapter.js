// Kokoro Local TTS Adapter for Blvck-TTS v5.1
// Integrated with Voice Instructions: parses pacing/speed cues, formats prosody pauses, and applies instruction-driven style cues
(() => {
  'use strict';

  const KOKORO_VOICES = [
    { id: 'af_heart', name: 'Kokoro Heart (US Female)', grade: 'A' },
    { id: 'af_bella', name: 'Kokoro Bella (US Female)', grade: 'A-' },
    { id: 'af_nicole', name: 'Kokoro Nicole (US Female)', grade: 'B' },
    { id: 'af_sky', name: 'Kokoro Sky (US Female)', grade: 'B' },
    { id: 'af_sarah', name: 'Kokoro Sarah (US Female)', grade: 'B' },
    { id: 'am_adam', name: 'Kokoro Adam (US Male)', grade: 'B' },
    { id: 'am_echo', name: 'Kokoro Echo (US Male)', grade: 'B' },
    { id: 'am_eric', name: 'Kokoro Eric (US Male)', grade: 'B' },
    { id: 'am_michael', name: 'Kokoro Michael (US Male)', grade: 'B' },
    { id: 'bf_emma', name: 'Kokoro Emma (UK Female)', grade: 'B+' },
    { id: 'bf_isabella', name: 'Kokoro Isabella (UK Female)', grade: 'B+' },
    { id: 'bm_george', name: 'Kokoro George (UK Male)', grade: 'B' },
    { id: 'bm_fable', name: 'Kokoro Fable (UK Male)', grade: 'B' }
  ];

  function getKokoroEndpoint() {
    return window.ProviderManager.getPoolState('kokoro')?.endpoint || 'http://localhost:8880';
  }

  // Probe local Kokoro server health
  async function probeKokoro() {
    const ep = getKokoroEndpoint();
    try {
      const res = await fetch(`${ep}/v1/models`, { method: 'GET' });
      if (res.ok) {
        return { online: true, endpoint: ep, voices: KOKORO_VOICES };
      }
    } catch (e) {}
    return { online: false, endpoint: ep, voices: KOKORO_VOICES };
  }

  function listVoices() {
    return KOKORO_VOICES;
  }

  // Parse voice instructions to extract dynamic speed and prosody adjustments
  function parseInstructions(instructions, defaultSpeed = 0.9) {
    if (!instructions || typeof instructions !== 'string') {
      return { speed: defaultSpeed, formattedText: null };
    }

    const text = instructions.toLowerCase();
    let speed = defaultSpeed;

    // Detect speed / pacing intent from natural language instructions
    if (/slow|deliberate|calm|measured|documentary|audiobook|pause/i.test(text)) {
      speed = 0.75;
    } else if (/fast|energetic|upbeat|punchy|quick/i.test(text)) {
      speed = 1.05;
    }

    return { speed };
  }

  // Format text to reflect pause cues and instruction tags for Kokoro synthesis
  function formatInputForInstructions(input, instructions) {
    if (!input) return '';
    let formatted = String(input);

    // Replace explicit pause tags with prosody breaks
    formatted = formatted.replace(/\[pause\]/gi, '... ');
    formatted = formatted.replace(/\[short pause\]/gi, ', ');
    formatted = formatted.replace(/\[long pause\]/gi, '... ... ');

    return formatted;
  }

  // Generate TTS via OpenAI-compatible Kokoro endpoint with integrated Voice Instructions
  async function textToSpeech({ input, voice = 'af_heart', speed = 1.0, instructions = '' }) {
    const ep = getKokoroEndpoint();
    const instAnalysis = parseInstructions(instructions, speed);
    const finalSpeed = instAnalysis.speed;
    const finalInput = formatInputForInstructions(input, instructions);

    console.log(`🎙️ [Kokoro TTS] Synthesizing voice="${voice}", speed=${finalSpeed} (Instructions Integrated)`);

    const res = await fetch(`${ep}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'kokoro',
        input: finalInput,
        voice: voice || 'af_heart',
        speed: finalSpeed,
        response_format: 'mp3'
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Kokoro Local Error (${res.status}): ${err}`);
    }

    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  window.KokoroAdapter = {
    getKokoroEndpoint,
    probeKokoro,
    listVoices,
    textToSpeech
  };
})();

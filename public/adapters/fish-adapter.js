// Fish Audio / Fish Speech TTS Adapter for Blvck-TTS
(() => {
  'use strict';

  let FISH_VOICES = [
    { id: 'default', name: 'Fish Audio (Default Colab Model)', grade: 'A' },
  ];
  let lastError = '';

  function getFishEndpoint() {
    let ep = window.ProviderManager.getPoolState('fishaudio')?.endpoint || 'https://api.fish.audio';
    // Remove trailing slashes
    return ep.replace(/\/+$/, '');
  }

  function getHeaders(ep) {
    const headers = { 
      'x-fish-endpoint': ep,
      'Accept': 'application/json'
    };
    if (ep.includes('api.fish.audio')) {
      const key = window.ProviderManager.getActiveKey('fishaudio');
      if (key) {
        headers['Authorization'] = `Bearer ${key}`;
      }
    }
    return headers;
  }

  // Probe Fish Speech API health & fetch voices.
  // Reports the REAL reachability of the endpoint — a Colab/Kaggle tunnel that has
  // expired must surface as offline, otherwise the UI silently offers voices that
  // cannot synthesize anything.
  async function probeFish() {
    const ep = getFishEndpoint();
    const headers = getHeaders(ep);
    let online = false;
    lastError = '';

    // Check health
    try {
      const res = await fetch(`/api/proxy/fish/v1/health`, { method: 'GET', headers }).catch(() => null);
      if (res && res.ok) {
        online = true;
      } else if (res) {
        lastError = `Health check returned ${res.status}.`;
      } else {
        lastError = `Could not reach ${ep}.`;
      }
    } catch (e) {
      lastError = e.message;
    }

    // Fetch voices dynamically
    try {
      if (ep.includes('api.fish.audio')) {
        // Official API uses /v1/models
        const res = await fetch(`/api/proxy/fish/v1/models`, { method: 'GET', headers });
        if (res.ok) {
          const data = await res.json();
          if (data && data.items) {
             FISH_VOICES = data.items.map(m => ({ id: m._id, name: m.title || m.name || m._id, grade: 'A' }));
          }
        } else {
          lastError = `Voice list failed (${res.status}): ${(await res.text()).slice(0, 200)}`;
          console.warn('[Fish Adapter]', lastError);
        }
      } else {
        // Colab / Kaggle tunnel uses /v1/references/list
        const res = await fetch(`/api/proxy/fish/v1/references/list?format=json&t=${Date.now()}`, { method: 'GET', headers });
        if (res.ok) {
          const data = await res.json();
          if (data && data.reference_ids && Array.isArray(data.reference_ids)) {
             const customVoices = data.reference_ids.map(id => ({ id, name: `Custom: ${id}`, grade: 'A' }));
             FISH_VOICES = [
               { id: 'default', name: 'Fish Audio (Default Base Model)', grade: 'A' },
               ...customVoices
             ];
             if (!customVoices.length) {
               lastError = 'The Fish server reported zero reference voices — run the voice-pack cell in the notebook, then re-run the API server cell.';
               console.warn('[Fish Adapter]', lastError);
             }
          }
        } else {
          lastError = `Voice list failed (${res.status}): ${(await res.text()).slice(0, 200)}`;
          console.warn('[Fish Adapter]', lastError);
        }
      }
    } catch (e) {
      lastError = e.message;
      console.warn('[Fish Adapter] Failed to fetch dynamic voices:', e);
    }

    return { online, endpoint: ep, voices: FISH_VOICES, error: lastError };
  }

  function listVoices() {
    return FISH_VOICES;
  }

  // Ranges are taken from ServeTTSRequest in fish_speech/utils/schema.py.
  // The server rejects out-of-range values outright, so clamp rather than
  // forward whatever a slider happened to emit.
  const clamp = (v, lo, hi, dflt) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  };

  // Build the subset of ServeTTSRequest fields we expose. Only defined values
  // are sent so the server's own defaults apply to anything left unset.
  function buildGenParams(p = {}) {
    const out = {};
    if (p.temperature != null) out.temperature = clamp(p.temperature, 0.1, 1.0, 0.8);
    if (p.top_p != null) out.top_p = clamp(p.top_p, 0.1, 1.0, 0.8);
    if (p.repetition_penalty != null) out.repetition_penalty = clamp(p.repetition_penalty, 0.9, 2.0, 1.1);
    if (p.chunk_length != null) out.chunk_length = Math.round(clamp(p.chunk_length, 100, 1000, 200));
    if (p.max_new_tokens != null) out.max_new_tokens = Math.round(clamp(p.max_new_tokens, 128, 4096, 1024));
    if (p.normalize != null) out.normalize = !!p.normalize;
    // On by default: the server re-encodes the reference clip on every single
    // request otherwise (visible as "Loaded audio ... Encoded prompt" per call),
    // which wastes VRAM churn on a card that has tens of MiB to spare.
    out.use_memory_cache = p.use_memory_cache === 'off' ? 'off' : 'on';
    if (p.seed != null && p.seed !== '') {
      const s = parseInt(p.seed, 10);
      if (Number.isFinite(s)) out.seed = s;
    }
    return out;
  }

  // Generate TTS via Fish Speech /v1/tts endpoint with chunk streaming.
  // `params` maps onto ServeTTSRequest; note there is deliberately no `speed`
  // — the engine has no such parameter (see docs/FISH_VOICE_STUDIO_SPEC.md).
  // `segments` (optional) is [{text, reference_id}] from BlvckVoiceStyles —
  // per-passage emotion, where each stretch of script is voiced by a different
  // reference of the same speaker. When absent the whole script uses `voice`.
  async function textToSpeech({ input, voice = 'default', params = {}, segments = null, onProgress }) {
    if (!input || !input.trim()) return null;

    const ep = getFishEndpoint();
    const headers = getHeaders(ep);
    headers['Content-Type'] = 'application/json';
    
    if (ep.includes('api.fish.audio') && !headers['Authorization']) {
      throw new Error('Fish Audio API key is required for the official endpoint.');
    }

    // Split text into safe chunk sizes to prevent GPU OOM on 16GB cards.
    //
    // On a 15 GB T4 the engine OOMs past roughly 180 GENERATED tokens, and
    // character count predicts that badly: measured on real runs, 121/145/148/
    // 158/171-token generations succeeded while 189/193/194/199 failed — yet
    // the 199-token failure came from a 113-character line and the 145-token
    // success from a 139-character one. Pause markers are the reason: "..."
    // and ",.." become long silences that cost tokens.
    //
    // So this is only a first guess. renderOne() below halves and retries any
    // chunk the GPU actually rejects, which is what makes long scripts work
    // regardless of how pause-heavy they are.
    const MAX_CHUNK_CHARS = Math.max(60, Math.min(400, Number(params.maxChunkChars) || 120));
    const splitIntoChunks = (text) => {
      const out = [];
      let cur = '';
      for (const s of String(text).split(/(?<=[.!?\n])\s+/)) {
        if ((cur.length + s.length) > MAX_CHUNK_CHARS) {
          if (cur) out.push(cur);
          cur = s;
        } else {
          cur += (cur ? ' ' : '') + s;
        }
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };

    // Each chunk carries the reference it should be voiced with, so a script
    // using per-passage emotion switches reference mid-run while a plain one
    // behaves exactly as before.
    // Last guard before the wire: any bracket marker still present here was not
    // resolved into a reference (unknown style, or a speaker with no variants),
    // and Fish has no tag parser — it would speak the word. Strip it.
    const deTag = (t) => String(t).replace(/\[[^\]\n]{1,40}\]/g, '').replace(/[ \t]{2,}/g, ' ').trim();

    const work = [];
    const passages = (segments && segments.length) ? segments : [{ text: input, reference_id: voice }];
    for (const seg of passages) {
      for (const chunk of splitIntoChunks(deTag(seg.text))) {
        if (!chunk.trim()) continue;
        work.push({ text: chunk, reference_id: seg.reference_id || voice, style: seg.style || null });
      }
    }
    if (!work.length) return null;

    const gen = buildGenParams(params);
    const allAudioBuffers = [];

    // Split a chunk roughly in half on a sentence, then clause, then word
    // boundary — whichever exists — so a retry never cuts mid-word.
    const halve = (text) => {
      const t = String(text).trim();
      if (t.length < 24) return null;
      const mid = Math.floor(t.length / 2);
      for (const re of [/[.!?]\s+/g, /[,;:]\s+/g, /\s+/g]) {
        let best = -1, m;
        re.lastIndex = 0;
        while ((m = re.exec(t)) !== null) {
          const end = m.index + m[0].length;
          if (best === -1 || Math.abs(end - mid) < Math.abs(best - mid)) best = end;
        }
        if (best > 8 && best < t.length - 8) return [t.slice(0, best).trim(), t.slice(best).trim()];
      }
      return null;
    };

    const isOom = (status, body) =>
      status === 500 && /out of memory|CUDA|Failed to generate speech/i.test(String(body));

    async function renderOne(item, depth = 0) {
      const payload = { text: item.text, format: 'mp3', ...gen };
      if (item.reference_id && item.reference_id !== 'default') {
        payload.reference_id = item.reference_id;
      }
      // A fixed seed must stay fixed across chunks, otherwise each chunk is a
      // different take and the delivery drifts mid-script.

      const res = await fetch(`/api/proxy/fish/v1/tts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (res.ok) return [await res.arrayBuffer()];

      const err = await res.text();

      // The engine OOMs as a function of GENERATED tokens, not input length,
      // and the two correlate poorly: pause markers ("...", ",..") become long
      // silences that cost many tokens, so a 113-character line can generate
      // more than a 139-character one. No fixed character limit can be right
      // for every script, so shrink the failing chunk and retry instead of
      // failing the whole run.
      if (isOom(res.status, err) && depth < 3) {
        const parts = halve(item.text);
        if (parts) {
          if (onProgress) onProgress(`Chunk too large for the GPU — splitting and retrying…`);
          const out = [];
          for (const p of parts) {
            if (!p) continue;
            out.push(...await renderOne({ ...item, text: p }, depth + 1));
          }
          return out;
        }
      }
      throw new Error(`Fish Audio API error (${res.status}): ${err}`);
    }

    for (let i = 0; i < work.length; i++) {
      const item = work[i];
      if (onProgress) {
        onProgress(item.style
          ? `Generating part ${i + 1} of ${work.length} (${item.style})...`
          : `Generating part ${i + 1} of ${work.length}...`);
      }
      allAudioBuffers.push(...await renderOne(item));
    }

    if (onProgress) onProgress('Finalizing audio...');
    // MP3 files can be safely concatenated at the binary level
    const blob = new Blob(allAudioBuffers, { type: 'audio/mp3' });
    return URL.createObjectURL(blob);
  }

  window.FishAdapter = {
    probeFish,
    listVoices,
    textToSpeech,
    lastError: () => lastError
  };

  // Auto-check on load (non-blocking)
  probeFish().then(state => {
    console.log(
      `[Fish Adapter] Backend status: ${state.online ? 'Online' : 'Offline'} (${state.endpoint})` +
      (state.error ? ` — ${state.error}` : ` — ${state.voices.length} voice(s)`)
    );
    window.dispatchEvent(new CustomEvent('blvck:tts-provider-changed'));
  });

  // Re-probe when user saves new settings (like Ngrok URL)
  window.addEventListener('blvck:provider-status-changed', () => {
    probeFish().then(() => {
      window.dispatchEvent(new CustomEvent('blvck:tts-provider-changed'));
    });
  });
})();

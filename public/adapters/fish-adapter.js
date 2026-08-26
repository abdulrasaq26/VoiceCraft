// Fish Audio / Fish Speech TTS Adapter for Blvck-TTS
(() => {
  'use strict';

  let FISH_VOICES = [
    { id: 'default', name: 'Fish Audio (Default Colab Model)', grade: 'A' },
  ];
  let lastError = '';

  // The last run's per-chunk requests, so a wrong-sounding voice can be traced
  // to what was asked for rather than guessed at. Read with
  // FishAdapter.lastRequests() in the console.
  let lastRequests = [];

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
  /**
   * Speak a passage.
   *
   * `signal` aborts the request that is in flight, so Cancel means now rather
   * than "after this piece", which on a slow engine is a minute away.
   *
   * `resume` is what makes an interrupted run cheap. A long passage is spoken
   * as many small pieces, and until now a failure on the last one threw away
   * every finished piece before it — on a tunnel that drops, that is several
   * minutes of GPU time lost per attempt, repeatedly. Given a resume store,
   * each finished piece is kept the moment it arrives and a later attempt picks
   * up at the first one missing:
   *
   *   resume.seed        the seed a previous attempt used, so the voice of the
   *                      kept pieces and the new ones is the same take
   *   resume.onSeed(n)   called once with the seed in force, to be stored
   *   resume.get(i)      a finished piece, or null
   *   resume.put(i, buf) keep one
   */
  /** The shape a caller checks for with err.name === 'AbortError'. */
  function abortError() {
    const e = new Error('the request was cancelled');
    e.name = 'AbortError';
    return e;
  }

  function joinBuffers(list) {
    if (list.length === 1) return list[0];
    const total = list.reduce((n, b) => n + b.byteLength, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const b of list) { out.set(new Uint8Array(b), at); at += b.byteLength; }
    return out.buffer;
  }

  async function textToSpeech({ input, voice = 'default', params = {}, segments = null,
                                onProgress, signal, resume = null }) {
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

    lastRequests = [];

    // 'default' means "no reference" to this engine, so the base model answers
    // and the result is nobody's chosen voice. That is a legitimate request,
    // but it is indistinguishable in the output from a selection that failed to
    // arrive — which is exactly how a lost voice went unnoticed. Say it.
    if (!voice || voice === 'default') {
      console.warn('[Fish] no voice reference for this run — the base model will '
        + 'answer, which will not match any named voice.');
      if (onProgress) onProgress('No voice reference selected — using the base model.');
    }

    const work = [];
    const passages = (segments && segments.length) ? segments : [{ text: input, reference_id: voice }];
    for (const seg of passages) {
      for (const chunk of splitIntoChunks(deTag(seg.text))) {
        if (!chunk.trim()) continue;
        work.push({ text: chunk, reference_id: seg.reference_id || voice, style: seg.style || null });
      }
    }
    if (!work.length) return null;

    // A VOICE THAT IS NOT THERE DOES NOT FAIL — IT IS SUBSTITUTED.
    //
    // Measured against the live server: a reference id it has never heard of
    // returns 200 and a perfectly good mp3, spoken by the base model. Nothing
    // in the response says a substitution happened. So a whole narration can be
    // produced in the wrong voice and the only way to discover it is to listen
    // to the finished thing — which is the most expensive moment to find out.
    //
    // This is not a hypothetical: the voice studio already warns that
    // references live in the RUNNING Fish session and that anything added
    // afterwards is gone when the notebook restarts. That restart is exactly
    // when a saved project keeps pointing at a voice the server no longer has.
    //
    // So the ids are checked against what the server actually holds before a
    // run is spent. Failing to READ the list is not evidence of absence and
    // must not block the run — that conflation is its own bug, and this file
    // has had it before.
    const wanted = [...new Set(work.map((w) => w.reference_id))]
      .filter((r) => r && r !== 'default');
    if (wanted.length) {
      let have = null;
      try {
        const res = await fetch(`/api/proxy/fish/v1/references/list?format=json&t=${Date.now()}`,
                                { method: 'GET', headers });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.reference_ids)) have = data.reference_ids;
        }
      } catch (e) { have = null; }

      if (have) {
        const missing = wanted.filter((r) => !have.includes(r));
        if (missing.length) {
          throw new Error(`the voice ${missing.map((m) => `"${m}"`).join(', ')} is not on the `
            + `speech server any more. A reference the server does not have is silently replaced `
            + `by the base model, so this run would have come back in the wrong voice rather than `
            + `failing. Voices live in the running Fish session — create it again, or choose one `
            + `the server still has.`);
        }
      } else if (onProgress) {
        onProgress('Could not read the voice list — going ahead without checking the reference.');
      }
    }

    const gen = buildGenParams(params);

    // One seed for the whole run.
    //
    // Fish samples afresh for every request, so a script split into eight
    // chunks was eight independent takes of the same reference — the timbre
    // drifts and a listener hears the voice change mid-video. The comment in
    // renderOne has always said the seed must stay fixed across chunks; nothing
    // ever set one, because buildGenParams only emits `seed` when the CALLER
    // supplies it and the voice studio does not.
    //
    // A caller's explicit seed still wins, so a producer can reproduce a take
    // exactly. Otherwise one is drawn here, once, and reused for every chunk:
    // runs still differ from each other, but a single run is internally
    // consistent, which is the property that was missing.
    // A resumed run MUST keep the seed of the attempt whose pieces it is
    // reusing. Fish samples afresh per request, so finishing a passage under a
    // new seed would splice two different takes of the same voice together and
    // the join would be audible.
    if (gen.seed == null && resume && resume.seed != null) gen.seed = Number(resume.seed);
    if (gen.seed == null) {
      gen.seed = Math.floor(Math.random() * 2147483647);
      if (onProgress) onProgress(`Voice seed ${gen.seed} (same take across the whole script)`);
    }
    if (resume && typeof resume.onSeed === 'function') {
      try { resume.onSeed(gen.seed); } catch (e) { /* storing it is best effort */ }
    }
    console.log(`[Fish] seed ${gen.seed} for ${work.length} chunk(s), reference `
      + `${JSON.stringify([...new Set(work.map((w) => w.reference_id))])}`);

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

    // "Failed to generate speech" IS NOT A DIAGNOSIS.
    //
    // It was treated as one, and matching it here meant every 500 this engine
    // can produce was read as a GPU running out of memory. Measured against the
    // live server: nine of eleven references rendered the same sixteen-character
    // line, while `Jessica Anna` and `Aria__default` returned
    //
    //   {"statusCode":500,"message":"Failed to generate speech",
    //    "error":"Internal Server Error"}
    //
    // in 2.9s with an 88-byte body, identically for a 16-character text and a
    // 37-character one. A machine that is out of memory does not fail before it
    // starts generating, does not fail at the same speed regardless of length,
    // and does not succeed nine times out of eleven on the same input. That is a
    // reference the engine cannot load, wearing the generic message this API
    // returns for anything that goes wrong inside it.
    //
    // The cost of the confusion was not just a bad message. A preview of
    // thirty-seven characters was classified as too large for the GPU, halved,
    // and retried down three levels - eight requests, several seconds each,
    // every one of them certain to fail - before reporting the generic error
    // anyway. So the match is now only on what actually names the condition.
    const isOom = (status, body) =>
      status === 500 && /out of memory|CUDA|OutOfMemory|cuBLAS|device-side assert/i.test(String(body));

    // WHICH OF THREE THINGS WENT WRONG?
    //
    // The first version of this asked whether a short line speaks WITHOUT the
    // reference. That cannot tell the two interesting cases apart, and it
    // misreported the more common one: a voice that speaks perfectly well on
    // its own, failing only when a long chunk of script is added to it.
    //
    // The reference is encoded INTO the prompt, so reference tokens and spoken
    // text share one sequence budget (text2semantic/inference.py raises when
    // the total reaches max_seq_len). A 14s reference is fine for a preview and
    // can still be too much for paragraph nine. That is a chunk that needs
    // splitting, not a broken voice, and telling somebody to pick another voice
    // is both wrong and expensive.
    //
    // So the first question is now the RIGHT one: does this reference speak a
    // short line? If it does, the voice is good and the chunk was too big.
    //   budget     the voice speaks alone; this text plus it does not
    //   reference  the voice fails even on a short line, but the engine speaks
    //   engine     nothing speaks, including no reference at all
    //   unknown    the question could not be asked, which is not an answer
    let refVerdict = null;
    async function diagnose(referenceId) {
      if (refVerdict !== null) return refVerdict;
      const SHORT = 'Testing one two.';
      const speaks = async (body) => {
        try {
          const r = await fetch(`/api/proxy/fish/v1/tts`, {
            method: 'POST', headers, body: JSON.stringify(body)
          });
          const ok = r.ok;
          try { await r.arrayBuffer(); } catch (e) { /* drained */ }
          return ok;
        } catch (e) { return null; }
      };

      const withRef = await speaks({ text: SHORT, format: 'mp3', reference_id: referenceId });
      if (withRef === true) { refVerdict = 'budget'; return refVerdict; }
      if (withRef === null) { refVerdict = 'unknown'; return refVerdict; }

      const bare = await speaks({ text: SHORT, format: 'mp3' });
      refVerdict = bare === true ? 'reference' : (bare === false ? 'engine' : 'unknown');
      return refVerdict;
    }

    async function renderOne(item, depth = 0) {
      // gen carries the run seed, so every chunk is the same take of the voice.
      const payload = { text: item.text, format: 'mp3', ...gen };
      if (item.reference_id && item.reference_id !== 'default') {
        payload.reference_id = item.reference_id;
      }
      // What actually goes on the wire, per chunk. A voice coming back wrong is
      // otherwise impossible to attribute: the request that carried the
      // reference and the audio that came back are never seen together.
      lastRequests.push({
        reference_id: payload.reference_id || '(none — server default)',
        seed: payload.seed,
        chars: item.text.length,
        text: item.text.slice(0, 48)
      });

      if (signal && signal.aborted) throw abortError();
      const res = await fetch(`/api/proxy/fish/v1/tts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal
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
      // A 500 carrying a reference is the case worth naming, because the engine
      // says the same sentence whatever went wrong and the producer cannot see
      // which of the situations they are in.
      if (res.status === 500 && payload.reference_id) {
        const verdict = await diagnose(payload.reference_id);

        // The voice is fine and this chunk was too long to sit beside it.
        // Split and carry on — the same remedy the OOM path uses, for the same
        // underlying reason: a sequence that did not fit.
        if (verdict === 'budget' && depth < 3) {
          const parts = halve(item.text);
          if (parts) {
            if (onProgress) {
              onProgress('This passage is too long to sit beside the voice reference — '
                + 'splitting it and carrying on…');
            }
            const out = [];
            for (const p of parts) {
              if (!p) continue;
              out.push(...await renderOne({ ...item, text: p }, depth + 1));
            }
            return out;
          }
        }
        if (verdict === 'budget') {
          throw new Error(`this passage will not fit beside the voice "${payload.reference_id}" `
            + `even after splitting it three times. The reference is encoded into the prompt `
            + `alongside the text, so a shorter reference leaves more room for the script — `
            + `try re-creating the voice from a shorter recording. `
            + `(Fish returned ${res.status}: ${err})`);
        }
        if (verdict === 'reference') {
          // Where the real reason is. views.py catches every exception in the
          // TTS path, logs it with a traceback, and returns this one sentence
          // regardless - so the answer exists, it is just on the other machine.
          throw new Error(`the voice "${payload.reference_id}" could not be used — the same `
            + `request without it speaks normally, so the engine is up and this reference is `
            + `the problem. Delete the voice and create it again, or pick another. The real `
            + `reason is in the notebook cell running the Fish API server: look for `
            + `"Error in TTS generation" — the server returns this same generic sentence for `
            + `every internal failure. (Fish returned ${res.status}: ${err})`);
        }
        if (verdict === 'engine') {
          throw new Error(`the speech engine is failing on every voice, including none at all — `
            + `this is the engine rather than "${payload.reference_id}". `
            + `(Fish returned ${res.status}: ${err})`);
        }
      }
      throw new Error(`Fish Audio API error (${res.status}): ${err}`);
    }

    let reused = 0;
    for (let i = 0; i < work.length; i++) {
      if (signal && signal.aborted) throw abortError();
      const item = work[i];

      // Already spoken on an earlier attempt. Said out loud rather than
      // silently skipped, because "resuming" that quietly re-ran everything is
      // exactly the bug this is here to prevent.
      if (resume && typeof resume.get === 'function') {
        let kept = null;
        try { kept = await resume.get(i); } catch (e) { kept = null; }
        if (kept && kept.byteLength) {
          allAudioBuffers.push(kept);
          reused++;
          if (onProgress) onProgress(`Piece ${i + 1} of ${work.length} — kept from the last attempt`);
          continue;
        }
      }

      // "Piece", not "part": a part is one file in the producer's queue and a
      // piece is one request inside it. Both counted from one, both called
      // "part", was unreadable in the queue — a row named "Part 4" reporting
      // "Generating part 3 of 9".
      if (onProgress) {
        onProgress(item.style
          ? `Piece ${i + 1} of ${work.length} (${item.style})…`
          : `Piece ${i + 1} of ${work.length}…`);
      }
      const buffers = await renderOne(item);
      allAudioBuffers.push(...buffers);
      if (resume && typeof resume.put === 'function') {
        // One piece may have been halved and re-halved by the OOM retry above,
        // so what is kept is the whole piece, joined.
        try { await resume.put(i, joinBuffers(buffers)); }
        catch (e) { console.warn('[Fish] could not keep piece ' + (i + 1) + ': ' + e.message); }
      }
    }
    if (reused && onProgress) {
      onProgress(`Resumed: ${reused} of ${work.length} piece(s) were already spoken.`);
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
    lastError: () => lastError,
    lastRequests: () => lastRequests.slice()
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

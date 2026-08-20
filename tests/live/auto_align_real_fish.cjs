// The whole timing chain, with nothing stubbed except the Director.
//
// auto_align_live.cjs proves the storyboard's WIRING with a fake aligner. This
// proves the thing itself: real speech out of Fish, real forced alignment
// against it, and scene cuts that land on the words as actually spoken.
//
// The narration is three sentences of deliberately different lengths. The
// project is seeded with a flat 10s-per-cue subtitle track first — the shape
// character-count apportioning produces, and what the cuts used to follow. If
// the cue list handed to the Director still reads 10/10/10 afterwards, the
// alignment changed nothing no matter what the badge says.
//
// Needs FISH_API_URL live. Skips rather than fails when it is not, because a
// sleeping notebook is not a defect in this code.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');

const PORT = process.argv[2] || '3491';
const env = fs.readFileSync(PROJECT + '/.env', 'utf8');
const ENDPOINT = ((env.match(/^FISH_API_URL=(.*)$/m) || [])[1] || '')
  .trim().replace(/^"|"$/g, '').replace(/\/+$/, '');

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

const SENTENCES = [
  'A single database holds several hundred movie scripts.',
  'Researchers sit for hours at library terminals, hunting for material that once required a written request and a very long wait.',
  'The collection also preserves recordings of unproduced radio shows.'
];
const SCRIPT = SENTENCES.join(' ');

// The estimate the project starts on: a flat grid, which is what the cuts
// followed before any of this.
const FLAT_SRT = SENTENCES.map((t, i) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${i + 1}\n00:00:${p(i * 10)},000 --> 00:00:${p(i * 10 + 10)},000\n${t}\n`;
}).join('\n');

const spans = (cues) => (cues || []).map((c) => {
  const [a, b] = c.timestamp.split(/\s*-\s*/);
  const sec = (t) => { const m = t.match(/(\d+):(\d+):(\d+)/); return +m[1] * 3600 + +m[2] * 60 + +m[3]; };
  return sec(b) - sec(a);
});

(async () => {
  if (!ENDPOINT) {
    console.log('SKIPPED: no FISH_API_URL in .env');
    process.exit(0);
  }
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null,
    protocolTimeout: 600000,
    args: ['--window-size=1400,950']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 120)); });
  page.on('console', (m) => {
    const t = m.text();
    if (/Align|align|coverage/i.test(t)) console.log('  [console] ' + t.slice(0, 150));
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  // ── Is the server actually up, and can it align? ──────────────────────────
  const live = await page.evaluate(async (ep) => {
    try {
      const r = await fetch('/api/proxy/fish/aether/status', {
        headers: { 'x-fish-endpoint': ep }, signal: AbortSignal.timeout(20000)
      });
      if (!r.ok) return { ok: false, why: 'HTTP ' + r.status };
      const j = JSON.parse(await r.text());
      return { ok: true, alignment: j.alignment === true, voices: (j.voices || []).length };
    } catch (e) { return { ok: false, why: e.message }; }
  }, ENDPOINT);

  if (!live.ok || !live.alignment) {
    console.log(`SKIPPED: Fish is not available for alignment (${live.why || 'no /v1/align'})`);
    await browser.close();
    process.exit(0);
  }
  console.log(`  Fish is up: ${live.voices} voices, alignment supported\n`);

  // ── Speak the narration for real ──────────────────────────────────────────
  console.log('  generating narration through Fish…');
  const spoken = await page.evaluate(async (ep, script) => {
    const t0 = Date.now();

    // Through the app's OWN adapter, not a hand-rolled fetch.
    //
    // The first version of this called /v1/tts directly and got HTTP 500 on the
    // full script, then intermittently on a single sentence that had succeeded
    // moments earlier. That is the engine running out of GPU memory, which
    // tracks GENERATED tokens rather than input length - so no chunk size is
    // reliably safe. FishAdapter.textToSpeech already chunks, and halves and
    // retries whatever the GPU actually rejects. Reimplementing that here would
    // have meant a test that was flakier than the product it was testing, and
    // testing a path no user takes.
    window.ProviderManager.setEndpoint('fishaudio', ep);
    let url;
    try {
      url = await window.FishAdapter.textToSpeech({ input: script, params: { seed: 20260820 } });
    } catch (e) {
      return { ok: false, why: e.message };
    }
    if (!url) return { ok: false, why: 'the adapter returned no audio' };

    const blob = await (await fetch(url)).blob();
    const buf = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await ctx.decodeAudioData(buf.slice(0));

    // Filed exactly where collectNarration looks for a finished batch.
    const id = 'batch-realfish';
    await new Promise((resolve, reject) => {
      const rq = indexedDB.open('blvck-tts', 1);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore('audio'); } catch (e) {} };
      rq.onsuccess = () => {
        const db = rq.result;
        const tx = db.transaction('audio', 'readwrite');
        tx.objectStore('audio').put(blob, `${id}:0`);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      rq.onerror = () => reject(rq.error);
    });
    localStorage.setItem('blvck-tts:batch', JSON.stringify({
      id, project: 'Timing Proof', ext: 'mp3', audioFormat: 'mp3', script,
      items: [{ index: 0, part: 1, text: script, status: 'done' }]
    }));
    return { ok: true, bytes: blob.size, seconds: decoded.duration, tookMs: Date.now() - t0 };
  }, ENDPOINT, SCRIPT);

  if (!spoken.ok) {
    check('Fish produced narration audio', false, spoken.why);
    console.log('\nFAILED — cannot test alignment without audio');
    await browser.close();
    process.exit(1);
  }
  console.log(`  ${(spoken.bytes / 1024).toFixed(0)}KB, ${spoken.seconds.toFixed(2)}s of speech `
            + `in ${(spoken.tookMs / 1000).toFixed(1)}s\n`);

  // ── Seed the project on the ESTIMATE, then let Analyze measure it ─────────
  await page.evaluate((ep, script, srt) => {
    localStorage.setItem('blvck:keys_fishaudio', ep);
    localStorage.setItem('blvck-tts:script-last', JSON.stringify({ script }));
    window.BlvckAssets.setSubtitlesSRT(srt, 'audio');

    // Only the Director is stubbed. It records the cue list it is handed —
    // that list is what decides where the cuts fall.
    window.__cuesSeenByDirector = null;
    window.AIManager.generateJSON = async (endpoint, payload) => {
      if (payload && payload.cues) window.__cuesSeenByDirector = payload.cues;
      return { scenes: (payload.cues || []).map((c) => ({
        index: c.index, timestamp: c.timestamp, subtitle: c.text,
        camera: 'Wide', sceneSummary: c.text.slice(0, 40), visualType: 'stock_video'
      })) };
    };
    window.AIManager.lastRawResponse = () => '';
    window.BlvckLTX = Object.assign({}, window.BlvckLTX, {
      planWithDirector: async () => { throw new Error('not part of this test'); },
      reset: () => {}
    });
    if (window.StockMedia) window.StockMedia.acquire = async () => { throw new Error('not part of this test'); };
  }, ENDPOINT, SCRIPT, FLAT_SRT);

  console.log('  running Generate Visual Plan & Fetch Media (alignment is REAL)…');
  await page.evaluate(() => {
    document.querySelectorAll('.workspace-page').forEach((p) => { p.hidden = true; });
    const sb = document.getElementById('workspace-storyboard');
    if (sb) sb.hidden = false;
    document.getElementById('sb-import').click();
  });
  await new Promise((r) => setTimeout(r, 800));
  const t0 = Date.now();
  await page.evaluate(() => document.getElementById('sb-analyze').click());

  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const done = await page.evaluate(() => !document.getElementById('sb-analyze').disabled
                                        && !!window.__cuesSeenByDirector);
    if (done) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const tookMs = Date.now() - t0;

  const out = await page.evaluate(async () => {
    let state = null;
    try { state = await window.BlvckAlign.status(); } catch (e) { state = null; }
    const t = window.BlvckAlign.current();
    return {
      cues: window.__cuesSeenByDirector,
      status: (document.getElementById('sb-status') || {}).textContent || '',
      badge: (document.getElementById('sb-signals') || {}).textContent || '',
      alignState: state && state.state,
      wordCount: state && state.wordCount,
      source: t && t.source,
      segments: t && (t.segments || []).map((s) => ({
        start: Math.round(s.start * 100) / 100,
        end: Math.round(s.end * 100) / 100,
        text: (s.text || '').slice(0, 46)
      })),
      srt: window.BlvckAssets.subtitlesSRT().slice(0, 120)
    };
  });

  console.log(`\n  finished in ${(tookMs / 1000).toFixed(1)}s`);
  console.log(`  alignment state: ${out.alignState} · source: ${out.source} · ${out.wordCount} word timings`);
  console.log('\n  what Whisper measured:');
  for (const s of out.segments || []) {
    console.log(`    ${String(s.start).padStart(6)}s → ${String(s.end).padStart(6)}s  "${s.text}…"`);
  }
  const got = spans(out.cues);
  console.log(`\n  cue spans handed to the Director: ${JSON.stringify(got)}`);
  console.log(`  the estimate they replaced:        [10,10,10]`);

  check('the narration was measured, not estimated', out.alignState === 'aligned' && out.source === 'whisper',
        { state: out.alignState, source: out.source });
  check('Whisper returned word timings', (out.wordCount || 0) > 15, out.wordCount);
  check('the cuts no longer sit on the flat estimate',
        got.length > 0 && !got.every((s) => s === 10), got);
  check('the sentences got different durations, as they were actually spoken',
        new Set(got).size > 1, got);
  check('every cut fits inside the audio that exists',
        got.reduce((a, b) => a + b, 0) <= Math.ceil(spoken.seconds) + 2,
        { totalCut: got.reduce((a, b) => a + b, 0), audio: spoken.seconds });
  check('the project subtitles were rewritten from the measurement',
        !out.srt.includes('00:00:10,000'), out.srt);
  check('and the run says the timing was measured', /Timing: measured/.test(out.status),
        out.status.slice(0, 170));
  check('the badge agrees', /Whisper aligned/.test(out.badge), out.badge.slice(0, 120));
  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));

  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'REAL SPEECH, REAL ALIGNMENT, CUTS ON THE SPOKEN WORD'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });

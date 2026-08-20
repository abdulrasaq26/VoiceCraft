// Why the visual pass costs 40-68s, measured rather than guessed.
//
// The baseline established the reasoning is sound and the machinery is too slow
// and too flaky to ship: 2 of 5 beats failed outright, and the judge alone took
// 29-49s. Reconstructing the judge prompt offline showed it is only ~1000
// tokens, so context size is not the cause. That leaves the model, the queue,
// and the way requests are scheduled - which is what this measures.
//
// Deliberately modest in volume. The endpoint has been saturated once already
// in this work, and a benchmark that causes the failure it is trying to explain
// tells you nothing.
//
// Writes tests/live/vision_bench_v1.json. The five-beat baseline artifact is
// never touched.
const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const OUT = path.join(PROJECT, 'tests', 'live', 'vision_bench_v1.json');
const env = fs.readFileSync(PROJECT + '/.env', 'utf8');
const KEY = (env.match(/^NVIDIA_NIM_API=(.*)$/m) || [])[1].trim().replace(/^"|"$/g, '');

const VISION = 'meta/llama-3.2-11b-vision-instruct';
// Candidate judges, cheapest first. The judgement is a structured comparison
// over eight short descriptions - it is not obvious that it needs 70B.
const JUDGES = ['meta/llama-3.1-8b-instruct', 'meta/llama-3.3-70b-instruct'];

const DESCRIBE = 'Describe only what is physically visible in this image, in one short '
  + 'sentence. Say what a person would see: subjects, what they are doing, the setting. '
  + 'Do not guess at names, brands or events.';

function call(model, messages, maxTokens) {
  const body = JSON.stringify({ model, messages, temperature: 0.1, max_tokens: maxTokens });
  const started = Date.now();
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'integrate.api.nvidia.com', path: '/v1/chat/completions', method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json',
                 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        const ms = Date.now() - started;
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { /* reported below */ }
        const usage = (parsed && parsed.usage) || {};
        resolve({
          ms, status: res.statusCode,
          ok: res.statusCode === 200 && !!(parsed && parsed.choices),
          promptTokens: usage.prompt_tokens || null,
          completionTokens: usage.completion_tokens || null,
          queue: (parsed && parsed.nvext && parsed.nvext.scheduler_snapshot) || null,
          tokPerSec: (parsed && parsed.nvext && parsed.nvext.request_throughput
                      && parsed.nvext.request_throughput.generation_tokens_per_second) || null,
          error: res.statusCode !== 200 ? raw.slice(0, 120) : null
        });
      });
    });
    req.on('error', (e) => resolve({ ms: Date.now() - started, status: 0, ok: false, error: e.message }));
    req.setTimeout(70000, () => { req.destroy(); resolve({ ms: Date.now() - started, status: 0, ok: false, error: 'client timeout' }); });
    req.write(body);
    req.end();
  });
}

const look = (url) => call(VISION, [{ role: 'user', content: [
  { type: 'text', text: DESCRIBE }, { type: 'image_url', image_url: { url } }] }], 90);

async function pooled(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(new Array(Math.min(size, items.length)).fill(0).map(async () => {
    for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const stat = (rows) => {
  const ok = rows.filter((r) => r.ok);
  const times = ok.map((r) => r.ms).sort((a, b) => a - b);
  return {
    n: rows.length, ok: ok.length,
    errRate: Math.round(((rows.length - ok.length) / rows.length) * 100),
    statuses: rows.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {}),
    medianMs: times.length ? times[Math.floor(times.length / 2)] : null,
    p95Ms: times.length ? times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] : null,
    maxQueue: Math.max(0, ...rows.map((r) => (r.queue && r.queue.num_running_reqs) || 0))
  };
};

(async () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(PROJECT, 'tests', 'live', 'baseline_five_beats.json'), 'utf8'));
  // Real frames from the measured run, so the benchmark exercises the same work.
  const frames = [];
  for (const r of baseline.results) {
    for (const j of (r.vision.judged || [])) {
      if (j.picture && frames.indexOf(j.picture) < 0) frames.push(j.picture);
    }
  }
  console.log(`${frames.length} real frames available from the baseline\n`);

  const report = { at: new Date().toISOString(), concurrency: [], judge: [] };

  // ── Phase 6H: what concurrency does the endpoint actually like? ───────────
  console.log('CONCURRENCY — 8 image requests per level, same eight frames each time');
  console.log('level  ok/n  err%  median  p95     statuses            peak queue');
  const eight = frames.slice(0, 8);
  for (const level of [1, 2, 3, 4]) {
    const t0 = Date.now();
    const rows = await pooled(eight, level, (u) => look(u));
    const s = stat(rows);
    s.level = level;
    s.wallMs = Date.now() - t0;
    report.concurrency.push({ level, wallMs: s.wallMs, ...s });
    console.log(`  ${String(level).padEnd(5)}${String(s.ok + '/' + s.n).padEnd(6)}`
      + `${String(s.errRate).padEnd(6)}${String(s.medianMs).padEnd(8)}${String(s.p95Ms).padEnd(8)}`
      + `${JSON.stringify(s.statuses).padEnd(20)}${s.maxQueue}   wall ${(s.wallMs / 1000).toFixed(1)}s`);
    // Let the service settle between levels so one level does not poison the next.
    await new Promise((r) => setTimeout(r, 5000));
  }

  // ── Phase 6B/6G: is a 70B judge necessary? ───────────────────────────────
  console.log('\nJUDGE — same prompt, different models and candidate counts');
  console.log('model                         cands  status  ms      prompt/out tokens  tok/s');
  const beat = baseline.results.find((r) => (r.vision.judged || []).length >= 8);
  const jd = beat.vision.judged;
  const mkPrompt = (n) => {
    const list = jd.slice(0, n).map((j, i) =>
      `${i + 1}. visible: ${j.sees}\n   the library calls it: ${(j.tags || []).join(', ')}`).join('\n');
    return `You are the editor of a documentary, choosing which clip to cut in.\n\n`
      + `THE NARRATOR SAYS: "${beat.beat.narration}"\n\nTHE SHOT THIS BEAT NEEDS:\n`
      + `The shot: ${beat.beat.intent.concept}\n\nCANDIDATES:\n${list}\n\n`
      + 'For each, judge whether it would illustrate that sentence on screen.\n'
      + 'Reply with ONLY a JSON array like this:\n'
      + '[{"i":1,"subject":0.9,"action":0.8,"environment":0.7,"fit":0.85,'
      + '"contradiction":0.0,"class":"direct_illustration","entity":"none"}]';
  };
  for (const model of JUDGES) {
    for (const n of [4, 8]) {
      const r = await call(model, [{ role: 'user', content: mkPrompt(n) }], 700);
      report.judge.push({ model, candidates: n, ...r });
      console.log(`  ${model.padEnd(30)}${String(n).padEnd(7)}${String(r.status).padEnd(8)}`
        + `${String(r.ms).padEnd(8)}${String((r.promptTokens || '?') + '/' + (r.completionTokens || '?')).padEnd(19)}`
        + `${r.tokPerSec ? r.tokPerSec.toFixed(1) : '?'}`);
      await new Promise((res) => setTimeout(res, 3000));
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\nwritten to ${path.relative(PROJECT, OUT)}`);
})();

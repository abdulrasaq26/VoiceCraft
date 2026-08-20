// 6F/6G/6H — is the failure ours or the provider's, and do retries help?
//
// The previous concurrency benchmark ran its levels in blocks, so level
// correlated with time, and this endpoint's failures arrive in windows. It
// concluded that concurrency 4 was healthier than concurrency 1, which is the
// opposite of saturation and was simply the clock. That result was recorded as
// inconclusive and is not used here.
//
// The fix is interleaving. Trials are emitted round-robin across concurrency
// levels, so every level is spread evenly through the run and a bad window hits
// all of them alike. If failures still track the level after that, the cause is
// ours; if they track the clock, it is the provider's.
//
// The other question is whether a failure is worth retrying at all. Every failed
// attempt is retried immediately, twice, with backoff, and the outcome recorded
// per attempt. An 80% recovery rate makes retries the cheapest fix available; a
// 5% one makes them a way to spend two extra seconds to be told no again.
//
// Writes tests/live/reliability_v1.json. Nothing else is touched, and no
// production code changes on the strength of it.
const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const OUT = path.join(PROJECT, 'tests', 'live', 'reliability_v1.json');
const KEY = (fs.readFileSync(PROJECT + '/.env', 'utf8')
  .match(/^NVIDIA_NIM_API=(.*)$/m) || [])[1].trim().replace(/^"|"$/g, '');

const VISION = 'meta/llama-3.2-11b-vision-instruct';
const LEVELS = [1, 2, 3, 4];
const TRIALS_PER_LEVEL = 6;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 400, 1200];
const PER_ATTEMPT_TIMEOUT_MS = 30000;

const DESCRIBE = 'Describe only what is physically visible in this image, in one short '
  + 'sentence. Do not guess at names, brands or events.';

function once(url) {
  const body = JSON.stringify({
    model: VISION, temperature: 0.1, max_tokens: 60,
    messages: [{ role: 'user', content: [
      { type: 'text', text: DESCRIBE }, { type: 'image_url', image_url: { url } }] }]
  });
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
        let ok = false;
        try { ok = res.statusCode === 200 && !!JSON.parse(raw).choices; } catch (e) { ok = false; }
        resolve({ ms: Date.now() - started, status: res.statusCode,
                  ok, kind: ok ? 'ok' : String(res.statusCode) });
      });
    });
    req.on('error', (e) => resolve({ ms: Date.now() - started, status: 0, ok: false,
      kind: /ECONNRESET/i.test(e.message) ? 'ECONNRESET' : 'neterror', detail: e.message.slice(0, 60) }));
    req.setTimeout(PER_ATTEMPT_TIMEOUT_MS, () => {
      req.destroy();
      resolve({ ms: Date.now() - started, status: 0, ok: false, kind: 'timeout' });
    });
    req.write(body); req.end();
  });
}

/** One trial: attempt, and retry a failure to see whether it recovers. */
async function trial(url, level, startedAt) {
  const attempts = [];
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    if (BACKOFF_MS[n - 1]) await new Promise((r) => setTimeout(r, BACKOFF_MS[n - 1]));
    const a = await once(url);
    attempts.push({ n, ...a, atSec: Math.round((Date.now() - startedAt) / 1000) });
    if (a.ok) break;
  }
  const first = attempts[0];
  const last = attempts[attempts.length - 1];
  return {
    level, attempts,
    initialOk: first.ok,
    finalOk: last.ok,
    recovered: !first.ok && last.ok,
    firstKind: first.kind,
    totalMs: attempts.reduce((s, a) => s + a.ms, 0)
  };
}

(async () => {
  const baseline = JSON.parse(fs.readFileSync(
    path.join(PROJECT, 'tests', 'live', 'baseline_five_beats.json'), 'utf8'));
  const frames = [];
  for (const r of baseline.results) {
    for (const j of (r.vision.judged || [])) {
      if (j.picture && frames.indexOf(j.picture) < 0) frames.push(j.picture);
    }
  }

  // Interleaved plan: round-robin the levels so each is spread across the run.
  const plan = [];
  for (let i = 0; i < TRIALS_PER_LEVEL; i++) {
    for (const level of LEVELS) plan.push({ level, url: frames[(i * LEVELS.length + level) % frames.length] });
  }
  console.log(`${plan.length} trials, levels interleaved, up to ${MAX_ATTEMPTS} attempts each`);
  console.log(`frames available: ${frames.length}\n`);

  const startedAt = Date.now();
  const results = [];
  // Run the plan in order, but execute each level's trial at that level's
  // concurrency: a level-3 slot fires three requests together.
  for (const step of plan) {
    const batch = new Array(step.level).fill(0).map((_, k) =>
      trial(frames[(results.length + k) % frames.length], step.level, startedAt));
    const done = await Promise.all(batch);
    results.push(...done);
    const t = Math.round((Date.now() - startedAt) / 1000);
    const okNow = done.filter((d) => d.finalOk).length;
    process.stdout.write(`  t+${String(t).padStart(3)}s  level ${step.level}  `
      + `${okNow}/${done.length} ok  ${done.map((d) => d.firstKind).join(',')}\n`);
    await new Promise((r) => setTimeout(r, 800));
  }

  // ── Analysis ──────────────────────────────────────────────────────────────
  const initial = results.filter((r) => r.initialOk).length;
  const final = results.filter((r) => r.finalOk).length;
  const failedFirst = results.filter((r) => !r.initialOk);
  const recovered = failedFirst.filter((r) => r.recovered).length;
  const kinds = results.reduce((m, r) => { m[r.firstKind] = (m[r.firstKind] || 0) + 1; return m; }, {});
  const okTimes = results.filter((r) => r.finalOk)
    .map((r) => r.attempts.filter((a) => a.ok)[0].ms).sort((a, b) => a - b);
  const pct = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : null;

  const byLevel = {};
  for (const lv of LEVELS) {
    const rows = results.filter((r) => r.level === lv);
    byLevel[lv] = { n: rows.length,
      initialOk: rows.filter((r) => r.initialOk).length,
      finalOk: rows.filter((r) => r.finalOk).length };
  }

  // Temporal clustering: bucket first-attempt failures into 30s windows.
  const buckets = {};
  for (const r of results) {
    const b = Math.floor(r.attempts[0].atSec / 30) * 30;
    buckets[b] = buckets[b] || { n: 0, fail: 0 };
    buckets[b].n++;
    if (!r.initialOk) buckets[b].fail++;
  }

  console.log('\n── RELIABILITY ─────────────────────────────────────────────');
  console.log(`  initial success   ${initial}/${results.length}  (${Math.round(100 * initial / results.length)}%)`);
  console.log(`  retry recovery    ${recovered}/${failedFirst.length}`
    + (failedFirst.length ? `  (${Math.round(100 * recovered / failedFirst.length)}%)` : '  (nothing failed)'));
  console.log(`  final success     ${final}/${results.length}  (${Math.round(100 * final / results.length)}%)`);
  console.log(`  first-attempt outcomes: ${JSON.stringify(kinds)}`);
  console.log(`  latency of successful attempts  p50 ${pct(okTimes, 0.5)}ms  `
    + `p95 ${pct(okTimes, 0.95)}ms  max ${okTimes[okTimes.length - 1]}ms`);

  console.log('\n  by concurrency level (interleaved, so time is spread evenly):');
  for (const lv of LEVELS) {
    const b = byLevel[lv];
    console.log(`    level ${lv}   initial ${b.initialOk}/${b.n}   final ${b.finalOk}/${b.n}`);
  }

  console.log('\n  first-attempt failures over time (30s windows):');
  for (const k of Object.keys(buckets).sort((a, b) => a - b)) {
    const b = buckets[k];
    console.log(`    t+${String(k).padStart(3)}s  ${String(b.fail).padStart(2)}/${String(b.n).padStart(2)} failed  `
      + '#'.repeat(b.fail));
  }

  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(),
    levels: LEVELS, trialsPerLevel: TRIALS_PER_LEVEL, maxAttempts: MAX_ATTEMPTS,
    backoffMs: BACKOFF_MS, perAttemptTimeoutMs: PER_ATTEMPT_TIMEOUT_MS,
    summary: { initial, final, failedFirst: failedFirst.length, recovered,
               kinds, byLevel, buckets,
               p50: pct(okTimes, 0.5), p95: pct(okTimes, 0.95), max: okTimes[okTimes.length - 1] },
    results }, null, 2));
  console.log(`\n  written to ${path.relative(PROJECT, OUT)}`);
})();

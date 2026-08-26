// What the speech engine's failures actually mean, and what we tell the producer.
//
// Reported from the studio: previewing a cloned voice returned
//
//   Fish Audio API error (500): {"statusCode":500,
//    "message":"Failed to generate speech","error":"Internal Server Error"}
//
// Two separate faults were behind that one line, and neither was the one the
// code believed in.
//
// THE 500 WAS BEING READ AS A GPU OUT OF MEMORY, because isOom matched the
// string "Failed to generate speech" — which is this API's generic 500 for
// anything that goes wrong inside it. So a thirty-seven-character preview was
// classified as too large for the card, halved, and retried down three levels:
// eight requests, all certain to fail, before reporting the generic error
// anyway.
//
// AND A VOICE THE SERVER DOES NOT HAVE DOES NOT FAIL AT ALL. It returns 200 and
// a good mp3 spoken by the base model, with nothing to say a substitution
// happened — so an entire narration can come back in the wrong voice and the
// only way to find out is to listen to it.
//
// This measures both against the real server. Nothing is stubbed.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'fish_voice_faults_v1.json');
const env = fs.readFileSync(PROJECT + '/.env', 'utf8');
const envGet = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : '';
};

const fails = [];
const notes = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

const PREVIEW = 'Hello! This is a preview of my voice.';
const FISH = envGet('FISH_API_URL');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 900000,
    args: ['--window-size=1300,900', '--autoplay-policy=no-user-gesture-required']
  });
  const page = (await browser.pages())[0];
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message.slice(0, 120)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  // Seed the endpoint and count every TTS request the adapter makes.
  await page.evaluate((fish) => {
    localStorage.setItem('blvck:tts_provider', 'fishaudio');
    if (fish && window.ProviderManager) window.ProviderManager.setEndpoint('fishaudio', fish);
    window.__ttsCalls = 0;
    const orig = window.fetch;
    window.fetch = function (...args) {
      const url = String(args[0] || '');
      if (url.includes('/v1/tts')) window.__ttsCalls++;
      return orig.apply(this, args);
    };
  }, FISH);

  // ── Which references does the server actually have, and which speak? ─────
  console.log('=== the server\'s own reference list ===');
  const survey = await page.evaluate(async (text, fish) => {
    const A = window.BlvckFishAdapter || window.FishAdapter;
    const H = { 'Content-Type': 'application/json', Accept: 'application/json',
                'x-fish-endpoint': fish };
    const res = await fetch(`/api/proxy/fish/v1/references/list?format=json&t=${Date.now()}`,
                            { headers: H });
    if (!res.ok) return { why: `the reference list could not be read (${res.status})` };
    const data = await res.json();
    const ids = (data && data.reference_ids) || [];
    const speaks = [], broken = [];
    for (const id of ids) {
      const r = await fetch('/api/proxy/fish/v1/tts', {
        method: 'POST', headers: H,
        body: JSON.stringify({ text, format: 'mp3', reference_id: id })
      });
      if (r.ok) { speaks.push(id); try { await r.arrayBuffer(); } catch (e) {} }
      else broken.push({ id, status: r.status, body: (await r.text()).slice(0, 120) });
    }
    return { ids, speaks, broken, hasAdapter: !!A };
  }, 'Testing one two.', FISH);

  if (survey.why) {
    check('the reference list could be read', false, survey.why);
    await browser.close();
    process.exit(1);
  }
  console.log(`  ${survey.ids.length} references · ${survey.speaks.length} speak · ${survey.broken.length} return 500`);
  for (const b of survey.broken) console.log(`    broken: ${b.id} -> ${b.status} ${b.body}`);
  check('at least one reference speaks, so the engine itself is up',
        survey.speaks.length > 0, survey);

  // ── A voice the server has never heard of ───────────────────────────────
  console.log('\n=== a reference the server does not have ===');
  const ghost = await page.evaluate(async (text, fish) => {
    const r = await fetch('/api/proxy/fish/v1/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json',
                 'x-fish-endpoint': fish },
      body: JSON.stringify({ text, format: 'mp3', reference_id: 'zz-no-such-voice-zz' })
    });
    const bytes = r.ok ? (await r.arrayBuffer()).byteLength : 0;
    return { status: r.status, bytes };
  }, PREVIEW, FISH);
  console.log(`  raw engine: HTTP ${ghost.status} · ${ghost.bytes} bytes`);
  check('THE ENGINE SUBSTITUTES SILENTLY — this is what the guard exists for',
        ghost.status === 200 && ghost.bytes > 1000, ghost);

  const guarded = await page.evaluate(async (text) => {
    const A = window.BlvckFishAdapter || window.FishAdapter;
    if (!A || !A.textToSpeech) return { why: 'the fish adapter is not exposed' };
    window.__ttsCalls = 0;
    try {
      const out = await A.textToSpeech({ input: text, voice: 'zz-no-such-voice-zz' });
      return { spoke: true, bytes: out ? (out.byteLength || out.size || 0) : 0,
               calls: window.__ttsCalls };
    } catch (e) {
      return { spoke: false, message: e.message, calls: window.__ttsCalls };
    }
  }, PREVIEW);

  if (guarded.why) {
    notes.push(guarded.why);
    console.log(`  (skipped: ${guarded.why})`);
  } else {
    console.log(`  through the adapter: ${guarded.spoke ? 'spoke' : 'refused'} · ${guarded.calls} tts request(s)`);
    if (!guarded.spoke) console.log(`    "${String(guarded.message).slice(0, 190)}"`);
    check('THE ADAPTER REFUSES A VOICE THE SERVER DOES NOT HAVE',
          guarded.spoke === false, guarded);
    check('and says the run would have come back in the wrong voice',
          /wrong voice/i.test(String(guarded.message || '')), guarded.message);
    check('without spending a single request on it',
          guarded.calls === 0, guarded);
  }

  // ── A reference that is present but will not load ───────────────────────
  console.log('\n=== a reference the server has but cannot use ===');
  if (!survey.broken.length) {
    notes.push('no broken reference on the server right now — the 500 path was not exercised');
    console.log('  SKIPPED, loudly: every reference on this server speaks, so there is nothing');
    console.log('  to measure here. This is a real gap in the run, not a pass.');
  } else {
    const badId = survey.broken[0].id;
    const bad = await page.evaluate(async (text, id) => {
      const A = window.BlvckFishAdapter || window.FishAdapter;
      if (!A || !A.textToSpeech) return { why: 'the fish adapter is not exposed' };
      window.__ttsCalls = 0;
      const t0 = Date.now();
      try {
        await A.textToSpeech({ input: text, voice: id });
        return { spoke: true, calls: window.__ttsCalls, ms: Date.now() - t0 };
      } catch (e) {
        return { spoke: false, message: e.message, calls: window.__ttsCalls, ms: Date.now() - t0 };
      }
    }, PREVIEW, badId);

    if (bad.why) {
      notes.push(bad.why);
      console.log(`  (skipped: ${bad.why})`);
    } else {
      console.log(`  "${badId}": ${bad.spoke ? 'spoke' : 'refused'} after ${bad.calls} tts request(s)`
        + ` in ${(bad.ms / 1000).toFixed(1)}s`);
      if (!bad.spoke) console.log(`    "${String(bad.message).slice(0, 220)}"`);

      check('a reference that will not load is reported as a failure', bad.spoke === false, bad);
      check('THE MESSAGE NAMES THE VOICE RATHER THAN THE ENGINE',
            /could not be used|is the problem/i.test(String(bad.message || ''))
            && String(bad.message || '').includes(badId), bad.message);
      // One failed render plus one probe without the reference. The old code
      // halved a 37-character preview three times over: eight requests.
      check('AND IT STOPS AFTER TWO REQUESTS, NOT EIGHT',
            bad.calls <= 3, { calls: bad.calls });
    }
  }

  // ── The working case still works ────────────────────────────────────────
  console.log('\n=== a reference that is fine ===');
  if (!survey.speaks.length) {
    notes.push('no working reference to check');
  } else {
    const goodId = survey.speaks[0];
    const good = await page.evaluate(async (text, id) => {
      const A = window.BlvckFishAdapter || window.FishAdapter;
      if (!A || !A.textToSpeech) return { why: 'the fish adapter is not exposed' };
      window.__ttsCalls = 0;
      try {
        // textToSpeech hands back an object URL, not a blob, so the audio has
        // to be read back through it to be weighed at all.
        const out = await A.textToSpeech({ input: text, voice: id });
        const bytes = out ? (await (await fetch(out)).blob()).size : 0;
        return { spoke: true, bytes, calls: window.__ttsCalls };
      } catch (e) { return { spoke: false, message: e.message, calls: window.__ttsCalls }; }
    }, PREVIEW, goodId);

    if (good.why) { notes.push(good.why); console.log(`  (skipped: ${good.why})`); }
    else {
      console.log(`  "${goodId}": ${good.spoke ? `spoke, ${good.bytes} bytes` : 'refused'}`
        + ` · ${good.calls} request(s)`);
      check('a good voice still speaks, and the guard did not get in its way',
            good.spoke === true && good.bytes > 1000, good);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(), survey, ghost, guarded, notes
  }, null, 2));

  if (notes.length) console.log('\nNOT MEASURED: ' + notes.join(' · '));
  console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' · ') : 'All checks passed.'}`);
  console.log(`Written to ${OUT}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();

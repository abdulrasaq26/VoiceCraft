// The library grows from what beats actually asked for.
//
// Two components were added, and neither was invented. Both come out of this
// project's own records — beats the Renderer's Director wrote before the
// HyperFrame library existed, which that library then had no way to draw:
//
//   "Cargo Ship: 3g/km, Lorry: 20g/km, Plane: 500g/km"
//   "1933: Surveying started, 1935: Towers topped out, 1937: First cars crossed"
//
// A progression could have taken either list and would have misstated both. The
// first is not three stages, it is three amounts, and the sentence is about how
// far apart they are. The second is not three steps either; drop the years and
// most of the beat goes with them.
//
// So the tests here are about the thing that makes each component the component
// it claims to be:
//
//   comparison  THE BAR IS DRAWN TO SCALE. A bar chart whose bars do not encode
//               the numbers is a decoration with a caption. Measured off the
//               laid-out frame, not read out of the source.
//   timeline    every date survives, in order.
//   both        a list they cannot honestly draw is REFUSED, by name, before
//               anything is painted — the Renderer shipped a chart that passed
//               every check it had and then threw inside the export loop.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'components_growth_v1.json');
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 900000,
    args: ['--window-size=1300,900']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(() => { localStorage.removeItem('blvck:visual-style'); });
  await page.reload({ waitUntil: 'load' });

  const record = { at: new Date().toISOString() };

  // ── What a beat may now ask for ─────────────────────────────────────────
  console.log('=== the two beats that had nowhere to go ===');
  const draws = await page.evaluate(() => {
    const C = window.BlvckHyperFrameComponents;
    const chart = { kind: 'comparison', label: 'Grams of CO2 per tonne kilometre',
                    items: ['Cargo Ship: 3g/km', 'Lorry: 20g/km', 'Plane: 500g/km'] };
    const dates = { kind: 'timeline', label: 'Construction',
                    items: ['1933: Surveying started', '1935: Towers topped out',
                            '1937: First cars crossed'] };
    return {
      kinds: C.KINDS,
      chart: C.canDraw(chart), dates: C.canDraw(dates),
      vocabulary: C.vocabulary(),
      // The refusals, which are the half that keeps the export loop safe.
      noFigures: C.canDraw({ kind: 'comparison',
                             items: ['Cargo ships', 'Lorries', 'Aeroplanes'] }),
      oneFigureMissing: C.canDraw({ kind: 'comparison',
                                    items: ['Cargo Ship: 3g/km', 'Lorry: a lot more'] }),
      tooFew: C.canDraw({ kind: 'comparison', items: ['Cargo Ship: 3g/km'] }),
      noDates: C.canDraw({ kind: 'timeline',
                           items: ['Surveying started', 'Towers topped out'] }),
      notAKind: C.canDraw({ kind: 'sankey', items: ['a', 'b'] })
    };
  });
  console.log(`  the library is now: ${draws.kinds.join(', ')}`);
  record.kinds = draws.kinds;

  check('a comparison of three quantities can be drawn', draws.chart.ok === true, draws.chart);
  check('and three dated events can be drawn', draws.dates.ok === true, draws.dates);
  check('both appear in what the Composer is told exists',
        /comparison/.test(draws.vocabulary) && /timeline/.test(draws.vocabulary), draws.vocabulary);

  check('A LIST WITH NO FIGURES IN IT IS REFUSED, not drawn as empty bars',
        draws.noFigures.ok === false && /figure/.test(draws.noFigures.why), draws.noFigures);
  check('and so is one where a single item lost its number',
        draws.oneFigureMissing.ok === false, draws.oneFigureMissing);
  check('two are needed before there is anything to compare',
        draws.tooFew.ok === false, draws.tooFew);
  check('a timeline with no whens is refused too',
        draws.noDates.ok === false && /when/.test(draws.noDates.why), draws.noDates);
  check('and a component nobody has is still refused by name',
        draws.notAKind.ok === false && /sankey/.test(draws.notAKind.why), draws.notAKind);

  // ── The bar is the argument ─────────────────────────────────────────────
  console.log('\n=== the bars, measured off the laid-out frame ===');
  const bars = await page.evaluate(async () => {
    const C = window.BlvckHyperFrameComponents;

    // Laid out for real, then the timeline is run to its end so the bars are
    // at the widths a viewer sees rather than the zero they start from.
    const widthsOf = async (items) => {
      const src = C.compose({ seconds: 6, elements: [{ kind: 'comparison', label: 'x', items }] });
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:-9999px;top:0;width:1920px;height:1080px;border:0';
      document.body.appendChild(f);
      f.srcdoc = src;
      await new Promise((r) => { f.onload = r; setTimeout(r, 4000); });
      const w = f.contentWindow;
      // Seek the paused timeline to the end, exactly as the renderer does.
      try { w.__timelines.main.progress(1, false); } catch (e) { /* reported below */ }
      await new Promise((r) => setTimeout(r, 250));
      const d = f.contentDocument;
      const track = d.querySelector('.hf-cmp-track').getBoundingClientRect().width;
      const out = [...d.querySelectorAll('.hf-cmp-bar')]
        .map((b) => Math.round(b.getBoundingClientRect().width));
      const labels = [...d.querySelectorAll('.hf-cmp-l')].map((x) => x.textContent.trim());
      const values = [...d.querySelectorAll('.hf-cmp-v')].map((x) => x.textContent.trim());
      const ran = !!(w.__timelines && w.__timelines.main);
      f.remove();
      return { track: Math.round(track), bars: out, labels, values, ran };
    };

    return {
      even: await widthsOf(['Rail: 25 tonnes', 'Road: 50 tonnes', 'Air: 100 tonnes']),
      extreme: await widthsOf(['Cargo Ship: 3g/km', 'Lorry: 20g/km', 'Plane: 500g/km'])
    };
  });

  console.log(`  25/50/100 → bars ${bars.even.bars.join(' / ')} of a ${bars.even.track}px track`);
  console.log(`  3/20/500  → bars ${bars.extreme.bars.join(' / ')}`);
  console.log(`  labels ${JSON.stringify(bars.even.labels)}  values ${JSON.stringify(bars.even.values)}`);
  record.bars = bars;

  check('the composition really does carry a runnable timeline', bars.even.ran === true, bars.even);

  const [a, b, c] = bars.even.bars;
  check('a quantity twice another draws a bar twice as long',
        Math.abs(b / a - 2) < 0.12, { a, b, ratio: b / a });
  check('and four times another, four times as long',
        Math.abs(c / a - 4) < 0.12, { a, c, ratio: c / a });
  check('the largest fills the track', Math.abs(c - bars.even.track) <= 2, bars.even);

  check('the name and the figure are both on screen, not only the bar',
        bars.even.labels[0] === 'Rail' && bars.even.values[0] === '25 tonnes', bars.even);

  // The case that makes a bar chart useless if it is drawn naively.
  const [x, y, z] = bars.extreme.bars;
  console.log(`  the smallest bar is ${Math.round((x / bars.extreme.track) * 1000) / 10}% of the track`);
  // A percentage floor looked kinder and was a lie: at 4% the 3 and the 20 came
  // out THE SAME LENGTH, which states that two different numbers are equal.
  check('a bar too small to see is still not allowed to vanish',
        x >= 3, { x, track: bars.extreme.track });
  check('AND THREE IS NEVER DRAWN THE SAME LENGTH AS TWENTY',
        x < y && y < z, { x, y, z });
  check('the smallest stays honest about how small it is',
        x < bars.extreme.track * 0.02, { x, track: bars.extreme.track });
  check('and the figures themselves are on screen, since the bars cannot say it',
        bars.extreme.values.join(' ') === '3g/km 20g/km 500g/km', bars.extreme.values);

  // ── The dates ───────────────────────────────────────────────────────────
  console.log('\n=== the timeline ===');
  const tml = await page.evaluate(async () => {
    const C = window.BlvckHyperFrameComponents;
    const EV = window.BlvckHyperFrameEvaluator;
    const src = C.compose({ seconds: 6, elements: [{
      kind: 'timeline', label: 'Construction',
      items: ['1933: Surveying started', '1935: Towers topped out', '1937: First cars crossed']
    }] });
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-9999px;top:0;width:1920px;height:1080px;border:0';
    document.body.appendChild(f);
    f.srcdoc = src.replace(new RegExp('<script[^]*?</' + 'script>', 'g'), '');
    await new Promise((r) => { f.onload = r; setTimeout(r, 3000); });
    const d = f.contentDocument;
    const whens = [...d.querySelectorAll('.hf-tml-when')].map((x) => x.textContent.trim());
    const whats = [...d.querySelectorAll('.hf-tml-what')].map((x) => x.textContent.trim());
    const tops = [...d.querySelectorAll('.hf-tml-row')].map((x) => Math.round(x.getBoundingClientRect().y));
    f.remove();
    const layout = await EV.inspectLayout(src);
    return { whens, whats, tops, layout: { ok: layout.ok, problems: layout.problems.map((p) => p.why),
                                           density: layout.density } };
  });
  console.log(`  ${tml.whens.map((w, i) => `${w} ${tml.whats[i]}`).join('  ·  ')}`);
  record.timeline = tml;

  check('every year survives into the frame',
        tml.whens.join(',') === '1933,1935,1937', tml.whens);
  check('with what happened in each of them',
        tml.whats[2] === 'First cars crossed', tml.whats);
  check('and they run down the frame in the order given',
        tml.tops[0] < tml.tops[1] && tml.tops[1] < tml.tops[2], tml.tops);
  check('the evaluator finds nothing wrong with the layout',
        tml.layout.ok === true, tml.layout);

  // ── Both, in a house, evaluated ─────────────────────────────────────────
  console.log('\n=== in each house, and through the evaluator ===');
  const houses = await page.evaluate(async () => {
    const S = window.BlvckHouseStyle;
    const C = window.BlvckHyperFrameComponents;
    const EV = window.BlvckHyperFrameEvaluator;
    const out = {};
    for (const name of ['broadcast-brief', 'archival', 'data-brief']) {
      S.set(name);
      const src = C.compose({ seconds: 6, elements: [
        { kind: 'comparison', label: 'Grams per tonne kilometre',
          items: ['Cargo Ship: 3g/km', 'Lorry: 20g/km', 'Plane: 500g/km'] },
        { kind: 'stat', value: '167x', label: 'the difference' }
      ] });
      const layout = await EV.inspectLayout(src);
      out[name] = { ok: layout.ok, problems: layout.problems.map((p) => p.why),
                    density: layout.density,
                    barColour: (src.match(/\.hf-cmp-bar\{[^}]*background:([^;}]+)/) || [])[1] || '',
                    prefers: S.current().prefers };
    }
    S.set('broadcast-brief');
    return out;
  });
  for (const [k, v] of Object.entries(houses)) {
    console.log(`  ${k.padEnd(16)} ${v.ok ? 'clean' : v.problems.join('; ')}   `
      + `bar ${v.barColour}   ${Math.round(v.density * 100)}% of the frame`);
  }
  record.houses = houses;
  check('a comparison beside a figure evaluates clean in every house',
        Object.values(houses).every((v) => v.ok), houses);
  check('and the bar is painted in the house accent, not a colour of its own',
        new Set(Object.values(houses).map((v) => v.barColour)).size === 3, houses);
  check('the data brief now reaches for a comparison',
        houses['data-brief'].prefers.includes('comparison'), houses['data-brief'].prefers);
  check('and the archival house for a timeline',
        houses.archival.prefers.includes('timeline'), houses.archival.prefers);

  // ── And it reaches a file ───────────────────────────────────────────────
  console.log('\n=== rendered, and read back out of the video ===');
  const rendered = await page.evaluate(async () => {
    const C = window.BlvckHyperFrameComponents;
    const HF = window.BlvckHyperFrame;
    const scene = { index: 1, subtitle: 'x', timelineStart: 0, timelineEnd: 5,
                    timestamp: '00:00:00 - 00:00:05' };
    localStorage.setItem('blvck-tts:storyboard', JSON.stringify({
      project: { title: 'growth' }, cues: [], scenes: [scene] }));
    const live = window.BlvckStoryboard.scenes();
    live.length = 0; live.push(scene);

    const src = C.compose({ seconds: 5, elements: [
      { kind: 'comparison', label: 'Grams per tonne kilometre',
        items: ['Cargo Ship: 3g/km', 'Lorry: 20g/km', 'Plane: 500g/km'] }
    ] });
    const t0 = Date.now();
    let out;
    try {
      out = await HF.renderScene(scene, { source: src,
        vendor: [{ name: 'gsap.min.js', text: await HF.gsap() }] });
    } catch (err) { return { error: err.message }; }

    // Read a frame late in the clip, when the bars have grown.
    const url = URL.createObjectURL(out.blob);
    const v = document.createElement('video');
    v.muted = true; v.src = url;
    const ok = await new Promise((res) => {
      v.onloadeddata = () => res(true); v.onerror = () => res(false);
      setTimeout(() => res(v.readyState >= 2), 20000);
    });
    if (!ok) return { error: 'the render would not decode', bytes: out.blob.size };
    // Seeking into one of these renders sometimes hands back a black frame —
    // observed repeatedly at the tail, and occasionally elsewhere, on a file
    // that reads correctly a moment either side. So more than one instant is
    // tried and the first frame with anything painted on it is used. The motion
    // settles at 1.3s, measured, so every instant here is past the end of it.
    // Read at the frame's own resolution. Halving it put the smallest bar —
    // three pixels wide, which is the whole point of the minimum — under the
    // measurement's own noise floor.
    const c = document.createElement('canvas');
    c.width = 1920; c.height = 1080;
    const g = c.getContext('2d');
    const dur = v.duration || 5;
    let d = null, at = null;
    for (const frac of [0.6, 0.5, 0.7, 0.4, 0.8]) {
      await new Promise((res) => {
        v.onseeked = () => res();
        try { v.currentTime = dur * frac; } catch (e) { res(); }
        setTimeout(res, 8000);
      });
      g.drawImage(v, 0, 0, c.width, c.height);
      const px = g.getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 0; i < px.length; i += 40) if (px[i] > 40 || px[i + 1] > 40 || px[i + 2] > 40) lit++;
      if (lit > 200) { d = px; at = Math.round(v.currentTime * 100) / 100; break; }
    }
    if (!d) return { error: 'every frame read back blank', bytes: out.blob.size };

    // The accent is the bar — but the figures are painted in the accent too, so
    // counting accent PIXELS per row would measure "3g/km" as if it were bar.
    // The longest unbroken horizontal run is the bar and only the bar: a glyph
    // stroke is a few pixels wide, a bar is hundreds.
    const rowInk = {};
    for (let y = 0; y < c.height; y++) {
      let run = 0, best = 0;
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i] > 200 && d[i + 1] > 140 && d[i + 1] < 210 && d[i + 2] < 90) {
          run++; if (run > best) best = run;
        } else { run = 0; }
      }
      if (best >= 2) rowInk[y] = best;
    }
    const bands = [];
    let run = null;
    for (const y of Object.keys(rowInk).map(Number).sort((p, q) => p - q)) {
      if (run && y === run.to + 1) { run.to = y; run.max = Math.max(run.max, rowInk[y]); }
      else { if (run) bands.push(run); run = { from: y, to: y, max: rowInk[y] }; }
    }
    if (run) bands.push(run);
    URL.revokeObjectURL(url);
    return { bytes: out.blob.size, renderMs: Date.now() - t0, seconds: out.seconds, at,
             bands: bands.filter((x) => x.to - x.from >= 4).map((x) => x.max) };
  });

  if (rendered.error) {
    check('a comparison renders to a real file', false, rendered);
  } else {
    console.log(`  ${(rendered.bytes / 1024).toFixed(0)}KB in ${(rendered.renderMs / 1000).toFixed(1)}s`);
    console.log(`  at ${rendered.at}s the bars in the file are ${rendered.bands.join(' / ')} px long`);
    record.rendered = rendered;
    check('a comparison renders to a real file', rendered.bytes > 0, rendered);
    check('and three bars of three different lengths are in the video',
          rendered.bands.length >= 3
          && Math.max(...rendered.bands) > Math.min(...rendered.bands) * 8, rendered.bands);
  }

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  fs.writeFileSync(OUT, JSON.stringify(record, null, 2));
  console.log(`\n  written to ${path.relative(PROJECT, OUT)}`);
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'THE LIBRARY GREW WHERE BEATS WERE ALREADY ASKING'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });

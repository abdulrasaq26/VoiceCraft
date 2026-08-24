// One look for the whole film, and a look learned from a picture.
//
// A style system that only changes CSS is a theme picker. This one has to be
// shown reaching three places:
//
//   the frame     the components paint with the style's tokens, and the
//                 browser resolves them to the pixels it will actually paint
//   the motion    a film that breathes and a film that snaps are different
//                 films, and the difference is in the rendered timeline
//   the brief     the model is told what the house reaches for, AND the
//                 parser refuses what the house does not put on screen
//
// And the reference derivation has one property that matters more than
// fidelity: WHATEVER PICTURE IT IS GIVEN, THE RESULT MUST BE LEGIBLE. A palette
// taken honestly off a photograph is very often mid-grey on mid-grey. So the
// test hands it deliberately hostile references — a near-white one, a flat grey
// one, a saturated yellow one — and checks the contrast floor holds in every
// case, not only the flattering one.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 300000,
    args: ['--window-size=1300,900']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(() => localStorage.removeItem('blvck:visual-style'));
  await page.reload({ waitUntil: 'load' });

  // ── The frame the browser would actually paint ──────────────────────────
  console.log('=== the same beat, in two houses ===');
  const painted = await page.evaluate(async () => {
    const S = window.BlvckHouseStyle;
    const C = window.BlvckHyperFrameComponents;

    const els = [{ kind: 'title', text: 'The same sentence', kicker: 'Chapter one' },
                 { kind: 'progression', items: ['One', 'Two', 'Three'] }];

    // Resolved by the browser, not read off the source: this is the colour
    // that ends up in the file.
    const resolve = async (source) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:-9999px;top:0;width:1920px;height:1080px;border:0';
      document.body.appendChild(f);
      f.srcdoc = String(source).replace(new RegExp('<script[^]*?</' + 'script>', 'g'), '');
      await new Promise((r) => { f.onload = r; setTimeout(r, 3000); });
      const d = f.contentDocument;
      const g = (sel, prop) => getComputedStyle(d.querySelector(sel))[prop];
      const out = { ground: g('body', 'backgroundColor'),
                    head: g('.hf-head', 'color'),
                    headFont: g('.hf-head', 'fontFamily'),
                    kicker: g('.hf-kicker', 'color') };
      f.remove();
      return out;
    };

    const shot = {};
    for (const name of ['broadcast-brief', 'archival', 'data-brief']) {
      S.set(name);
      const src = C.compose({ elements: els, seconds: 6 });
      shot[name] = await resolve(src);
      // The motion is in the timeline the renderer will run, so it is read
      // from the source rather than from a computed style.
      shot[name].ease = (src.match(/ease:"([^"]+)"/) || [])[1] || '';
      shot[name].firstDuration = parseFloat((src.match(/duration:([\d.]+)/) || [])[1] || '0');
      shot[name].maxElements = S.current().maxElements;
    }
    S.set('broadcast-brief');
    return shot;
  });

  for (const [k, v] of Object.entries(painted)) {
    console.log(`  ${k.padEnd(16)} ground ${v.ground.padEnd(20)} type ${v.head.padEnd(20)} `
      + `ease ${v.ease.padEnd(12)} first move ${v.firstDuration}s`);
  }
  check('the ground the browser paints changes with the house',
        new Set(Object.values(painted).map((v) => v.ground)).size === 3, painted);
  check('and so does the type colour',
        new Set(Object.values(painted).map((v) => v.head)).size === 3, painted);
  check('archival really is paper — a light ground, not a dark one',
        /^rgb\(2[0-9]{2}, 2[0-9]{2}, 2[0-9]{2}\)$/.test(painted.archival.ground), painted.archival);
  check('and its typeface is not the default',
        painted.archival.headFont !== painted['broadcast-brief'].headFont, painted);
  check('the archival film moves more slowly than the data brief',
        painted.archival.firstDuration > painted['data-brief'].firstDuration,
        { archival: painted.archival.firstDuration, data: painted['data-brief'].firstDuration });
  check('and they do not share an easing curve',
        painted.archival.ease !== painted['data-brief'].ease, painted);

  // ── The brief, and the gate behind it ───────────────────────────────────
  console.log('\n=== what the house will and will not put on screen ===');
  const brief = await page.evaluate(() => {
    const S = window.BlvckHouseStyle;
    const C = window.BlvckHyperFrameComposer;
    const four = JSON.stringify({ elements: [
      { kind: 'title', text: 'One' },
      { kind: 'stat', value: '40%', label: 'two' },
      { kind: 'progression', items: ['a', 'b'] },
      { kind: 'title', text: 'Four' }
    ], reason: 'x' });

    const out = {};
    for (const name of ['archival', 'data-brief']) {
      S.set(name);
      const prompt = C._composePrompt({
        narration: 'A sentence.', intent: { concept: 'x', conveys: [] },
        assetLines: '', unmet: [], hasFootage: false
      });
      const plan = C._parseScene(four, { assets: [] });
      out[name] = {
        limit: C._limitFor(),
        kept: plan.elements.length,
        refused: plan.rejected.map((r) => r.why),
        briefMentions: (prompt.match(/THE FILM: ([a-z ]+)/) || [])[1] || '',
        favours: (prompt.match(/favours these components: ([^\n.]+)/) || [])[1] || ''
      };
    }
    S.set('broadcast-brief');
    return out;
  });
  for (const [k, v] of Object.entries(brief)) {
    console.log(`  ${k.padEnd(12)} limit ${v.limit}  kept ${v.kept}  favours ${v.favours}`);
    if (v.refused.length) console.log(`               refused: ${v.refused[0]}`);
  }
  check('the model is told which film it is working on',
        brief.archival.briefMentions.includes('archival')
        && brief['data-brief'].briefMentions.includes('data'), brief);
  check('and what that house reaches for',
        brief.archival.favours.includes('image') && brief['data-brief'].favours.includes('stat'), brief);
  check('THE HOUSE RULE IS A GATE, NOT A SUGGESTION — archival keeps two of four',
        brief.archival.kept === 2 && brief.archival.refused.length === 2, brief.archival);
  check('while the data brief keeps all four',
        brief['data-brief'].kept === 4 && brief['data-brief'].refused.length === 0, brief['data-brief']);
  check('and the refusal says whose rule it was',
        /this film puts on screen at once/.test(brief.archival.refused[0] || ''), brief.archival);

  // ── A look learned from a picture ───────────────────────────────────────
  console.log('\n=== learning a look from a reference ===');
  const learned = await page.evaluate(async () => {
    const S = window.BlvckHouseStyle;

    // Painted rather than fetched, so the input is known exactly.
    const picture = (paint) => {
      const c = document.createElement('canvas');
      c.width = 240; c.height = 135;
      paint(c.getContext('2d'), c);
      return c.toDataURL('image/png');
    };

    const refs = {
      // A real-looking frame: a deep teal wall with a small warm lamp in it.
      teal: picture((g, c) => {
        g.fillStyle = '#0e3f46'; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#123f48'; g.fillRect(0, 90, c.width, 45);
        g.fillStyle = '#e8842a'; g.fillRect(180, 40, 30, 22);
      }),
      // Hostile: an overexposed near-white frame. Naive derivation puts white
      // type on a white ground.
      blown: picture((g, c) => {
        g.fillStyle = '#f4f2ee'; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#e9e6e0'; g.fillRect(0, 100, c.width, 35);
      }),
      // Hostile: no colour at all. There is no accent to find here and one
      // should not be invented.
      grey: picture((g, c) => {
        g.fillStyle = '#7d7d7d'; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#6f6f6f'; g.fillRect(0, 70, c.width, 65);
      }),
      // Hostile: saturated yellow, the colour that fails against everything.
      yellow: picture((g, c) => {
        g.fillStyle = '#ffe10a'; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#f5d400'; g.fillRect(0, 80, c.width, 55);
      })
    };

    const hue = (h) => {
      const n = parseInt(h.slice(1), 16);
      const r = ((n >> 16) & 255) / 255, g2 = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
      const max = Math.max(r, g2, b), min = Math.min(r, g2, b), d = max - min;
      if (!d) return -1;
      let x = max === r ? ((g2 - b) / d) % 6 : max === g2 ? (b - r) / d + 2 : (r - g2) / d + 4;
      x *= 60; return x < 0 ? x + 360 : x;
    };

    S.set('broadcast-brief');
    const defaults = S.current().tokens;
    const out = { defaultBg: defaults.bg, defaultAccent: defaults.accent, refs: {} };

    for (const [name, src] of Object.entries(refs)) {
      const r = await S.fromReference(src, { name, apply: false });
      out.refs[name] = {
        bg: r.tokens.bg, ink: r.tokens.ink, accent: r.tokens.accent,
        contrast: r.contrast,
        bgHue: Math.round(hue(r.tokens.bg)),
        defaultAccentHue: Math.round(hue(defaults.accent)),
        accentHue: Math.round(hue(r.tokens.accent)),
        dominant: r.palette[0].hex, dominantHue: Math.round(hue(r.palette[0].hex))
      };
    }

    // And applied, it reaches the frame.
    const applied = await S.fromReference(refs.teal, { name: 'teal' });
    const C = window.BlvckHyperFrameComponents;
    const src = C.compose({ elements: [{ kind: 'title', text: 'A line' }], seconds: 4 });
    out.reachesTheFrame = src.includes(applied.tokens.bg) && src.includes(applied.tokens.accent);
    out.inForce = S.current().tokens.bg;
    out.referenceRecorded = S.current().reference && S.current().reference.name;

    S.clearReference();
    out.afterForget = S.current().tokens.bg;
    return out;
  });

  for (const [k, v] of Object.entries(learned.refs)) {
    console.log(`  ${k.padEnd(7)} ground ${v.bg} (from ${v.dominant})  type ${v.ink}  accent ${v.accent}`
      + `   ${v.contrast.ink}:1 / ${v.contrast.accent}:1`);
  }

  const angle = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  check('the ground keeps the reference\'s own colour',
        angle(learned.refs.teal.bgHue, learned.refs.teal.dominantHue) < 25, learned.refs.teal);
  check('and it is not simply the default with a new name',
        learned.refs.teal.bg !== learned.defaultBg, learned);
  check('the accent is picked out of the picture, not from the style',
        learned.refs.teal.accent !== learned.defaultAccent
        && angle(learned.refs.teal.accentHue, 30) < 30, learned.refs.teal);

  // The property that matters more than fidelity.
  for (const [name, v] of Object.entries(learned.refs)) {
    check(`${name}: type clears 4.5:1 against the ground it was given`,
          v.contrast.ink >= 4.5, v);
    // Including the case where no accent was found in the picture and the
    // style's own was inherited — it was chosen against a different ground.
    check(`${name}: and the accent clears 3:1 against it too`,
          v.contrast.accent >= 3, v);
  }
  check('a blown-out white frame becomes a light house, not white on white',
        learned.refs.blown.bg > '#c0c0c0' && learned.refs.blown.contrast.ink >= 4.5, learned.refs.blown);
  check('a picture with no colour in it does not get an invented hue',
        Math.abs(learned.refs.grey.accentHue - learned.refs.grey.defaultAccentHue) < 12,
        learned.refs.grey);
  check('and saturated yellow is made to work rather than left illegible',
        learned.refs.yellow.contrast.ink >= 4.5 && learned.refs.yellow.contrast.accent >= 3,
        learned.refs.yellow);

  check('an applied reference reaches the composition',
        learned.reachesTheFrame === true, learned);
  check('and the workspace can say where the look came from',
        learned.referenceRecorded === 'teal', learned);
  check('forgetting it returns the film to its own style',
        learned.afterForget === learned.defaultBg, learned);

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'ONE LOOK, IT REACHES THE FRAME, AND IT STAYS LEGIBLE'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });

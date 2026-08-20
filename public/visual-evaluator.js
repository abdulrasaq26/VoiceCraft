// Does this clip actually tell the story?
//
// The layer between retrieval and selection. Everything before it answers
// "what came back"; this answers the only question that matters to a viewer:
// if this clip were on screen while the narrator said this sentence, would the
// audience feel it was illustrating what they are hearing?
//
// Why it has to LOOK at the clip
// ──────────────────────────────
// The metadata ranker in stock-media.js reads what an asset SAYS about itself,
// and that ceiling is easy to demonstrate. For "Spider-Man swings through the
// city" a city skyline and a swinging park bench score identically on word
// overlap: one contains "city", the other contains "swing". Words cannot
// separate those. A picture can.
//
// Two stages, and the separation IS the design
// ────────────────────────────────────────────
// 1. DESCRIBE — a vision model says what is in each thumbnail, knowing nothing
//    about the narration.
// 2. JUDGE — a text model reads those descriptions against the beat, all of
//    them together, and scores them.
//
// The first version did both at once and was wrong in two ways a score alone
// would never have revealed. Shown three different clips under a beat naming a
// stage act, it reported seeing that act in all three — including one whose
// library tags read "band, orchestra, acoustic, brass". It was not looking, it
// was agreeing. And it echoed the output template back verbatim, returning the
// literal string "<six words on what is visible>" with fit 0.0, which parsed
// cleanly as a confident zero and turned perfectly good footage into
// NO_SUITABLE_ASSET.
//
// Asked neutrally, the same model on the same image is accurate and fast: "a
// stage with a band performing in front of a crowd", in 1.1s. So the describer
// is never told which answer would be convenient, and the output shape is shown
// as a filled example rather than as a placeholder.
//
// Measured against the live service while designing this:
//   • meta/llama-3.2-11b-vision-instruct reads a Pixabay thumbnail in 1.0-2.6s.
//   • It accepts a REMOTE image URL, so no download, no base64 and no proxy —
//     the thumbnail URL every provider already returns is enough, and it is
//     faster than inlining the same image as base64.
//   • At most ONE image per prompt, so pictures cannot be batched. Their
//     DESCRIPTIONS can, which is better anyway: judged together the model can
//     see that only candidate four shows the action, which it cannot know when
//     each is presented alone.
//   • It returns an intermittent 500 on an image it served a moment earlier,
//     so a describe is retried once.
//   • nvidia/nvclip would have been the cheaper instrument and is not
//     provisioned on this account.
//
// What it deliberately does NOT do
// ────────────────────────────────
// It does not search, download, cache, or decide rights. Those exist once
// already in stock-media.js and this calls none of them. It is handed
// candidates and returns judgements; acquire() remains the only thing that
// chooses and fetches.
(() => {
  'use strict';

  const VISION_MODEL = 'meta/llama-3.2-11b-vision-instruct';
  const JUDGE_MODEL  = 'meta/llama-3.3-70b-instruct';

  // Newlines built rather than escaped: this file is dense with string
  // assembly, and a mangled escape produces something that will not parse.
  const NL = String.fromCharCode(10);

  // A description is a small request against a small image. The generous
  // budgets elsewhere in this app are for reasoning that legitimately takes
  // minutes; a candidate that has not answered in 25s is holding up a beat
  // with other candidates waiting.
  const LOOK_TIMEOUT_MS  = 25000;
  const JUDGE_TIMEOUT_MS = 60000;
  // Enough parallelism that the pass feels free, few enough not to look like a
  // burst to the provider.
  const CONCURRENCY = 4;
  // Beyond this the cost stops buying accuracy: the metadata pass has already
  // ordered them, and the eighth is rarely right when the first seven were wrong.
  const MAX_JUDGED = 8;

  // ── How sure we have to be, given what the narration is claiming ──────────
  //
  // "The Apollo 11 astronauts landed on the Moon in July 1969" and "space
  // exploration captured the public imagination" are not the same evidential
  // problem. A generic astronaut clip is dishonest under the first and
  // perfectly serviceable under the second, so one threshold for both is wrong
  // in one direction or the other.
  const SPECIFICITY_FLOOR = {
    exact_event:      0.72,
    specific_person:  0.72,
    specific_place:   0.66,
    historical_event: 0.60,
    general_event:    0.48,
    concept:          0.38,
    metaphorical:     0.34
  };
  const DEFAULT_FLOOR = 0.50;

  const CLASS_RANK = {
    direct_illustration: 4,
    strong_contextual:   3,
    weak_contextual:     2,
    generic_filler:      1,
    contradictory:       0
  };

  function floorFor(specificity) {
    const f = SPECIFICITY_FLOOR[String(specificity || '').trim()];
    return typeof f === 'number' ? f : DEFAULT_FLOOR;
  }

  function withDeadline(promise, ms, what) {
    let timer;
    const bell = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(what + ' did not answer in ' + ms + 'ms')), ms);
    });
    return Promise.race([promise, bell]).finally(() => clearTimeout(timer));
  }

  /** Run jobs a few at a time rather than all at once. */
  async function pooled(items, size, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(new Array(Math.min(size, items.length)).fill(0).map(async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }));
    return out;
  }

  // ── The brief ─────────────────────────────────────────────────────────────

  /**
   * Render the structured intent as something a model can judge against.
   *
   * Uses whatever fields the Director actually supplied. The structure is
   * additive: a plan carrying only `concept` still produces a usable brief,
   * which is what keeps existing projects working while the schema catches up.
   */
  function briefOf(intent) {
    const i = intent || {};
    const line = (label, v) => {
      if (!v) return '';
      const text = Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v).trim();
      return text ? label + ': ' + text : '';
    };
    return [
      line('The shot', i.concept),
      line('Subject', i.subject),
      line('Action', i.action),
      line('Environment', i.environment),
      line('Period', i.timePeriod && (i.timePeriod.label || i.timePeriod)),
      line('Why it is here', i.narrativeRole),
      line('Must show', i.requiredElements),
      line('Must NOT be', i.avoid)
    ].filter(Boolean).join(NL);
  }

  function candidateText(asset) {
    const a = asset || {};
    const archive = a.archive || {};
    const said = [(a.tags || []).join(', '), archive.title, archive.description]
      .filter(Boolean).join(' - ');
    return said.slice(0, 200) || '(the library says nothing about it)';
  }

  // ── Stage one: what is in the picture? ────────────────────────────────────

  const DESCRIBE = 'Describe only what is physically visible in this image, in one short '
    + 'sentence. Say what a person would see: subjects, what they are doing, the setting. '
    + 'Do not guess at names, brands or events.';

  async function describe(asset) {
    const picture = asset.thumbnailUrl || asset.previewUrl || '';
    if (!picture) return { asset, sees: '', sawPicture: false };
    const content = [{ type: 'text', text: DESCRIBE },
                     { type: 'image_url', image_url: { url: picture } }];
    // Retried more than once, and cheaply, because the failure is transient and
    // fast. Measured: the endpoint answers an image in about 1.4s, and when it
    // fails it fails in about 1.0s with "Inference connection error while
    // making inference request" - the same URL succeeding and 500ing on
    // consecutive calls minutes apart. Three attempts with a short pause costs
    // at most a few seconds and is the difference between a beat being judged
    // and a beat silently falling back to metadata.
    let lastErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 400 * (attempt - 1)));
      try {
        const text = await withDeadline(window.LLMAdapters.nvidiaNimChat({
          model: VISION_MODEL,
          messages: [{ role: 'user', content }],
          temperature: 0.1,
          max_tokens: 90
        }), LOOK_TIMEOUT_MS, 'the describer');
        const sees = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 170);
        if (sees) return { asset, sees, sawPicture: true };
      } catch (err) {
        lastErr = err.message;
      }
    }
    return { asset, sees: '', sawPicture: false, error: lastErr };
  }

  // ── Was the frame worth looking at? ───────────────────────────────────────
  //
  // Pixabay's thumbnail is frame zero, and a great many stock clips open on a
  // title card, a watermark or a logo. Measured on the beat this layer was
  // built for, the top four Pixabay candidates described themselves as:
  //
  //   "white text on a black background that reads co>err"
  //   "a black and white graphic reading MOTION GRAPHIC DESIGNER"
  //   "the words ICONIK Media Group in gold lettering"
  //   "a man holding a white cup with a logo"
  //
  // Every one of those clips is concert footage. All four sizes Pixabay offers
  // are the SAME frame at different resolutions, so there is no better still to
  // ask for. Pexels is different - its poster is representative, and the same
  // pass described a concert clip as "a crowd of people in a dark room, with
  // some individuals holding up their hands".
  //
  // Scoring a title card as generic_filler is therefore a lie about the CLIP.
  // It is the same distinction the metadata layer already draws: absence of
  // evidence is not evidence of a bad match. An uninformative frame means the
  // candidate was not seen, so it keeps the place metadata gave it rather than
  // being promoted or rejected on a look that revealed nothing.
  const FRAME_IS_TEXT = /\b(?:text|words?|lettering|logo|title card|caption|watermark|typography|font|graphic|blank|solid (?:black|white))\b/i;
  const FRAME_HAS_SUBJECT = /\b(?:person|people|man|woman|men|women|child|children|crowd|audience|building|street|city|room|landscape|animal|hand|face|car|tree|water|sky|stage|field|worker|desk|machine|vehicle|boat|road)/i;

  function informative(sees) {
    const t = String(sees || '');
    if (!t.trim()) return false;
    // A frame that is ABOUT text, and shows nothing else, taught us nothing.
    if (FRAME_IS_TEXT.test(t) && !FRAME_HAS_SUBJECT.test(t)) return false;
    return true;
  }

  // ── A guard that was tried and removed ────────────────────────────────────
  //
  // The endpoint does not always fail cleanly. Degraded, it returns fluent
  // sentences that have nothing to do with the image, and the tell is that they
  // repeat across different pictures. Measured twice here: three clips all
  // described as "Blue Man Group performing on stage", and four cityscape and
  // aerial-drone clips all described as "a man in a turtleneck sweater".
  //
  // Detecting that by comparing descriptions to each other does not work, and
  // the counter-example is the case this whole layer is for. Three genuine exam
  // clips were described as "a young woman at a desk writing", "two people at
  // desks writing" and "a young man at a desk with a pencil" - correct,
  // useful, and every bit as similar to each other as the turtlenecks were.
  // Similar descriptions mean either "it is not looking" or "the clips really
  // are alike", and text alone cannot tell those apart. A detector tuned to
  // catch the bad run also threw out the beat that worked.
  //
  // So it is not here. What IS here is informative(), which is sound because it
  // judges a description on its own terms rather than against its neighbours,
  // and the fallback below: a describe pass that yields nothing legible reports
  // NOT_EVALUATED and the metadata order stands. Cross-checking each
  // description against the library's own words is the promising next signal -
  // "cityscape, aerial, drone" against "a man in a turtleneck" disagree
  // completely, while "students in the classroom" against "a woman at a desk
  // writing" agree - but it needs measuring against real pairs before it can be
  // trusted, and an unmeasured guard is what this comment exists to prevent.

  // ── Stage two: does what is in the picture tell the beat? ─────────────────

  function judgePrompt(narration, intent, described, specificity) {
    const list = described.map((d, i) => [
      (i + 1) + '. visible: ' + (d.sees || '(no picture available)'),
      '   the library calls it: ' + candidateText(d.asset)
    ].join(NL)).join(NL);

    return [
      'You are the editor of a documentary, choosing which clip to cut in.',
      '',
      'THE NARRATOR SAYS: "' + String(narration || '').trim() + '"',
      '',
      'THE SHOT THIS BEAT NEEDS:',
      briefOf(intent),
      '',
      'HOW SPECIFIC THE CLAIM IS: ' + (specificity || 'general_event'),
      '',
      'CANDIDATES - someone else looked at each clip and wrote down what is',
      'visible, without knowing the narration. Judge them on that description,',
      'not on what the library calls them; libraries mislabel.',
      '',
      list,
      '',
      'For each, ask: if this were on screen while the narrator said that',
      'sentence, would the audience feel it illustrates what they are hearing?',
      '',
      'Classify each honestly:',
      '  direct_illustration  it shows the thing being described',
      '  strong_contextual    not the thing, but real evidence of it',
      '  weak_contextual      same broad world, tells the audience little',
      '  generic_filler       could sit under any sentence; says nothing',
      '  contradictory        fights the narration - a peaceful tourist beach',
      '                       under "soldiers stormed the beach"',
      '',
      'Do not assume one of them must be good enough. If none of them show the',
      'beat, say so in every score. Nothing usable is a valid answer.',
      '',
      'Reply with ONLY a JSON array, one object per candidate, like this:',
      '[{"i":1,"subject":0.9,"action":0.8,"environment":0.7,"fit":0.85,'
        + '"contradiction":0.0,"class":"direct_illustration"},',
      ' {"i":2,"subject":0.1,"action":0.0,"environment":0.3,"fit":0.05,'
        + '"contradiction":0.0,"class":"generic_filler"}]'
    ].join(NL);
  }

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  };

  /** Pull the array out of whatever the model wrapped it in. */
  function parseScores(text) {
    const raw = String(text || '');
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return null;
    let arr = null;
    try { arr = JSON.parse(m[0]); } catch (e) { return null; }
    if (!Array.isArray(arr)) return null;
    const out = new Map();
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue;
      const i = Number(row.i);
      if (!Number.isFinite(i)) continue;
      const klass = String(row.class || '').trim();
      out.set(i, {
        subject: num(row.subject),
        action: num(row.action),
        environment: num(row.environment),
        fit: num(row.fit),
        contradiction: num(row.contradiction),
        classification: Object.prototype.hasOwnProperty.call(CLASS_RANK, klass)
          ? klass : 'weak_contextual'
      });
    }
    return out.size ? out : null;
  }

  // ── The score acquire() consumes ──────────────────────────────────────────
  //
  // Narrative fit dominates by construction. The metadata signal stays as a
  // small corroborating term rather than being dropped: it is cheap, it was
  // computed already, and two independent signals agreeing is worth more than
  // either alone. Picture quality is deliberately absent — stock-media.js has
  // already ordered on it, and re-applying it here would let a sharp irrelevant
  // clip climb back up, which is the whole bug this layer exists to prevent.
  function combine(j, asset) {
    const meta = (asset && asset.relevance && asset.relevance.known) ? asset.relevance.score : 0.5;
    const narrative = (j.fit * 0.55) + (j.subject * 0.18) + (j.action * 0.15) + (j.environment * 0.12);
    const classBonus = (CLASS_RANK[j.classification] - 2) * 0.06;
    const filler = j.classification === 'generic_filler' ? 0.15 : 0;
    return Math.max(0, Math.min(1,
      (narrative * 0.82) + (meta * 0.18) + classBonus - (j.contradiction * 0.9) - filler));
  }

  function available() {
    return !!(window.LLMAdapters && window.LLMAdapters.nvidiaNimChat
              && window.ProviderManager && window.ProviderManager.getActiveKey('nim'));
  }

  /**
   * Judge a candidate pool against the beat.
   *
   * Never throws. An evaluator that is down must not stop a storyboard: every
   * outcome that is not a confident judgement reports itself as such, and
   * acquire() falls back to the metadata order it already had.
   */
  async function evaluate({ narration, intent, candidates, specificity } = {}) {
    const pool = (candidates || []).slice(0, MAX_JUDGED);
    if (!pool.length) return { ran: false, why: 'no candidates', scored: [], verdict: 'NO_CANDIDATES' };
    if (!available()) return { ran: false, why: 'no evaluator configured', scored: [], verdict: 'NOT_EVALUATED' };

    const t0 = Date.now();
    const described = await pooled(pool, CONCURRENCY, (asset) => describe(asset));
    // Only frames that actually showed something get judged. A title card
    // taught us nothing about the clip behind it, so that candidate stays
    // unproven and keeps the place metadata gave it.
    const seen   = described.filter((d) => d.sees && informative(d.sees));
    const unseen = described.filter((d) => !(d.sees && informative(d.sees)));
    if (!seen.length) {
      return { ran: false, verdict: 'NOT_EVALUATED', scored: [], tookMs: Date.now() - t0,
               why: described.map((d) => d.error).filter(Boolean)[0] || 'no thumbnails could be read' };
    }

    let scoreMap = null;
    try {
      const answer = await withDeadline(window.LLMAdapters.nvidiaNimChat({
        model: JUDGE_MODEL,
        messages: [{ role: 'user', content: judgePrompt(narration, intent, seen, specificity) }],
        temperature: 0.1,
        max_tokens: 700
      }), JUDGE_TIMEOUT_MS, 'the judge');
      scoreMap = parseScores(answer);
    } catch (err) {
      return { ran: false, verdict: 'NOT_EVALUATED', scored: [], tookMs: Date.now() - t0,
               why: err.message };
    }
    if (!scoreMap) {
      return { ran: false, verdict: 'NOT_EVALUATED', scored: [], tookMs: Date.now() - t0,
               why: 'the judge did not answer in the shape asked for' };
    }

    const scored = seen.map((d, i) => {
      const j = scoreMap.get(i + 1);
      if (!j) return null;
      return {
        asset: d.asset,
        judgement: Object.assign({ sees: d.sees, sawPicture: d.sawPicture }, j),
        score: combine(j, d.asset)
      };
    }).filter(Boolean).sort((a, b) => b.score - a.score);

    if (!scored.length) {
      return { ran: false, verdict: 'NOT_EVALUATED', scored: [], tookMs: Date.now() - t0,
               why: 'the judge scored none of the candidates it was given' };
    }

    const floor = floorFor(specificity);
    const best = scored[0];
    // A highly specific claim cannot be carried by footage that merely shares a
    // world with it, however well it scores.
    const needsClass = floor >= 0.66 ? 3 : 2;
    const usable = (x) => x.score >= floor
                       && x.judgement.classification !== 'contradictory'
                       && CLASS_RANK[x.judgement.classification] >= needsClass;
    const passes = usable(best);

    return {
      ran: true,
      tookMs: Date.now() - t0,
      floor,
      scored,
      // The order acquire() should try, best first, rejects removed.
      // Judged and accepted first, then everything the look could not read.
      // Those are unproven rather than rejected, so they stay available below
      // the ones that were actually seen instead of being discarded on a
      // frame that happened to be a logo.
      accepted: scored.filter(usable).concat(unseen.map((d) => ({
        asset: d.asset, score: null,
        judgement: { sees: d.sees || '', sawPicture: !!d.sawPicture,
                     classification: 'unseen', unreadableFrame: !!d.sees }
      }))),
      selected: passes ? best : null,
      confidence: !passes ? 'NO_SUITABLE_ASSET'
                : best.score >= floor + 0.2 ? 'HIGH'
                : best.score >= floor + 0.08 ? 'MEDIUM' : 'LOW',
      verdict: passes ? 'SELECTED' : 'NO_SUITABLE_ASSET'
    };
  }

  window.BlvckVisualEvaluator = {
    evaluate,
    available,
    floorFor,
    // Exported so the reasoning can be tested without a provider, and so a
    // frame-level signal richer than a thumbnail — a decoded mid-clip frame,
    // say — can be swapped into describe() later without touching acquire().
    _describe: describe,
    _judgePrompt: judgePrompt,
    _parseScores: parseScores,
    _combine: combine,
    _informative: informative,
    _briefOf: briefOf,
    _classRank: CLASS_RANK,
    VISION_MODEL,
    JUDGE_MODEL
  };
})();

// Making a scene out of nothing but code, in two separate decisions.
//
// WHAT SHOULD THE VIEWER UNDERSTAND, and HOW SHOULD IT LOOK, are different
// questions and different people answer them. Collapsing them into one call is
// how you get an animation that is technically impressive and says nothing.
//
//   Visual Director  → the idea. A concept, the phrase it belongs to, what has
//                      to be conveyed, and what assets it would want. No HTML,
//                      no components, no coordinates.
//   Composer         → the scene. Which components carry that idea and what
//                      goes in them, from the approved manifest only.
//
// NEITHER WRITES HTML. The Composer returns a list of components and their
// content; hyperframe-components.js turns that into source. So a model can
// never name a pixel, never reach for a URL, and never produce markup nobody
// validated — and the composition still comes out as real HyperFrame source
// that Studio can edit.
//
// TIMING IS NOT DISCUSSED. Neither call is told the scene's start or end, and
// neither is asked for a duration. The scene window comes from
// Timing.anchorOverlay via the storyboard, and internal animation timing is
// written by the components. There is nothing to strip because there is nothing
// to volunteer.
(() => {
  'use strict';

  // 60s, matching the Renderer Director. Measured across this session, NIM
  // under load routinely takes past 45s and answers fine at 55 - a tighter
  // bound just converts provider slowness into a failed beat.
  const DIRECTOR_TIMEOUT_MS = 60000;
  const COMPOSER_TIMEOUT_MS = 60000;
  const MAX_ELEMENTS = 4;

  const str = (v) => String(v == null ? '' : v).trim();

  function available() {
    return !!(window.LLMAdapters && window.LLMAdapters.nvidiaNimChat
              && window.ProviderManager && window.ProviderManager.getActiveKey('nim'));
  }

  async function ask(prompt, { maxTokens = 500, timeoutMs = 45000 } = {}) {
    const call = window.LLMAdapters.nvidiaNimChat({
      model: (window.AIManager && window.AIManager.nim && window.AIManager.nim.model)
             || 'meta/llama-3.3-70b-instruct',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.25, max_tokens: maxTokens
    });
    let timer;
    const bell = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('no answer within ' + timeoutMs + 'ms')), timeoutMs);
    });
    return Promise.race([call, bell]).finally(() => clearTimeout(timer));
  }

  const firstJson = (text) => {
    const m = str(text).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (e) { return null; }
  };

  // ── The Visual Director ──────────────────────────────────────────────────

  function intentPrompt({ narration, sceneSummary, before, after }) {
    const NL = String.fromCharCode(10);
    const lines = [
      'A beat of a documentary has no footage and will be built as motion',
      'graphics. Decide WHAT THE VIEWER SHOULD UNDERSTAND from looking at it.',
      '',
      'THE NARRATOR SAYS: "' + str(narration) + '"'
    ];
    if (str(sceneSummary)) lines.push('THE BEAT IS ABOUT: ' + str(sceneSummary));
    if (str(before)) lines.push('THE LINE BEFORE: "' + str(before) + '"');
    if (str(after)) lines.push('THE LINE AFTER: "' + str(after) + '"');

    return lines.concat([
      '',
      'You are not designing anything. No layout, no colours, no animation, no',
      'positions — other people do that, and doing it here would overrule them.',
      'Say what the picture has to GET ACROSS, and what real material would',
      'help it.',
      '',
      'The anchor is the exact phrase from the narration this beat turns on,',
      'copied verbatim. It is matched against the measured recording later, so',
      'it must be words that were actually spoken.',
      '',
      'Reply with ONLY this JSON:',
      '{"concept":"<what the viewer takes away, one line>",',
      ' "anchorPhrase":"<two to five words from the narration>",',
      ' "conveys":["<the things that must come across>"],',
      ' "assetNeeds":["<real material that would help, or an empty list>"]}'
    ]).join(NL);
  }

  function parseIntent(text) {
    const obj = firstJson(text);
    if (!obj) return null;
    const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, 6) : []);
    const concept = str(obj.concept);
    if (!concept) return null;
    return {
      concept,
      anchorPhrase: str(obj.anchorPhrase),
      conveys: list(obj.conveys),
      assetNeeds: list(obj.assetNeeds)
    };
  }

  /** What should this beat get across? Never throws. */
  async function direct({ narration, sceneSummary, before, after } = {}) {
    if (!str(narration)) return { ok: false, why: 'there is no narration for this beat' };
    if (!available()) return { ok: false, why: 'the visual director is not reachable' };
    let raw;
    try {
      raw = await ask(intentPrompt({ narration, sceneSummary, before, after }),
                      { maxTokens: 420, timeoutMs: DIRECTOR_TIMEOUT_MS });
    } catch (err) {
      return { ok: false, why: 'the visual director failed: ' + err.message };
    }
    const intent = parseIntent(raw);
    if (!intent) return { ok: false, why: 'the visual director did not answer in JSON', raw };
    return { ok: true, intent };
  }

  // ── The Composer ─────────────────────────────────────────────────────────

  /** The house style, or a plain default if the style module is not loaded. */
  function styleOf(project) {
    const S = window.BlvckHouseStyle;
    return S ? S.current(project)
             : { name: 'broadcast-brief', maxElements: MAX_ELEMENTS, prefers: [], guidance: [] };
  }

  function composePrompt({ narration, intent, assetLines, unmet, hasFootage, revision, project }) {
    const NL = String.fromCharCode(10);
    const C = window.BlvckHyperFrameComponents;
    const S = window.BlvckHouseStyle;
    const lines = [
      'Build one beat of a documentary out of the components below. There is no',
      'footage; this is the whole picture the viewer sees.',
      '',
      'THE NARRATOR SAYS: "' + str(narration) + '"',
      'THE VIEWER SHOULD UNDERSTAND: ' + str(intent.concept)
    ];
    if (intent.conveys.length) lines.push('IT MUST GET ACROSS: ' + intent.conveys.join('; '));

    // A film has one way of doing this, and the beat is an instance of it. The
    // colours and the motion are settled elsewhere and are not the model's to
    // touch; what belongs here is what the house REACHES FOR — a brief built
    // around pictures asks a different question of a sentence than one built
    // around figures.
    if (S) lines.push('', S.guidanceFor(project));

    if (hasFootage) {
      lines.push('', 'THIS BEAT ALREADY HAS FOOTAGE, and it will fill the frame behind',
                 'whatever you add. Do not ask for it — it is placed for you. Build only',
                 'what the shot cannot say by itself, and keep it sparse: everything you',
                 'add costs the viewer some of the picture.');
    }
    lines.push('', 'COMPONENTS YOU MAY USE — there are no others:', C.vocabulary(), '');

    if (assetLines) {
      lines.push('APPROVED ASSETS. Reference one by its id in an image component.',
                 'These are the only pictures that exist; there is no other source',
                 'and a file name you invent will not be there:', assetLines, '');
    } else {
      lines.push('NO ASSETS ARE APPROVED FOR THIS BEAT. Build it from type alone —',
                 'do not use an image component.', '');
    }
    if (unmet && unmet.length) {
      lines.push('ASKED FOR AND NOT AVAILABLE: ' + unmet.join(', ')
                 + '. Design around the absence rather than pretending it is there.', '');
    }

    if (revision) lines.push(revision, '');

    return lines.concat([
      'Say nothing about position, size, colour, font or animation. Those are',
      'already decided and are not yours to set — supply only the words and the',
      'asset ids.',
      '',
      'Between one and ' + limitFor(project) + ' components, in the order they should',
      'be layered. Keep text short: this is read in seconds, on a screen, once.',
      '',
      'Reply with ONLY this JSON:',
      '{"elements":[{"kind":"…", …}], "reason":"<one sentence>"}'
    ]).join(NL);
  }

  /**
   * Read a scene plan, keeping only what can actually be built.
   *
   * The same discipline as the Renderer Director's parser: a component nobody
   * has, an asset nobody approved, or content a component cannot draw is
   * refused loudly rather than dropped, because a silently missing element is
   * how a capability gets promised and never delivered.
   */
  /** How much this film puts on screen at once. Never above the hard ceiling. */
  function limitFor(project) {
    const n = Number(styleOf(project).maxElements);
    return Math.max(1, Math.min(MAX_ELEMENTS, Number.isFinite(n) ? n : MAX_ELEMENTS));
  }

  function parseScene(text, manifest, project) {
    const obj = firstJson(text);
    if (!obj) return { ok: false, why: 'the composer did not answer in JSON', elements: [], rejected: [] };

    const C = window.BlvckHyperFrameComponents;
    const byId = new Map((manifest && manifest.assets || []).map((a) => [a.assetId, a]));
    const limit = limitFor(project);
    const rejected = [];
    const elements = [];

    for (const row of (Array.isArray(obj.elements) ? obj.elements : [])) {
      if (elements.length >= limit) {
        rejected.push({ why: `beyond what this film puts on screen at once (${limit})`, row });
        continue;
      }
      const kind = str(row && row.kind).toLowerCase();

      const spec = { kind };
      if (kind === 'title') { spec.text = str(row.text); spec.kicker = str(row.kicker); }
      else if (kind === 'stat') { spec.value = str(row.value); spec.label = str(row.label); }
      else if (kind === 'progression') {
        spec.items = Array.isArray(row.items) ? row.items.map(str).filter(Boolean).slice(0, 5) : [];
      } else if (kind === 'image') {
        const id = str(row.assetId);
        const asset = byId.get(id);
        if (!asset) {
          // The gate. An id that did not come from the registry is refused
          // here, and the file is not on disk to reference even if it were not.
          rejected.push({ why: `"${id || '(none)'}" is not an approved asset for this scene`, row });
          continue;
        }
        spec.file = asset.fileName;
        spec.assetId = id;
        spec.caption = str(row.caption);
      }

      const verdict = C.canDraw(spec);
      if (!verdict.ok) { rejected.push({ why: verdict.why, row }); continue; }
      elements.push(spec);
    }

    if (!elements.length) {
      return { ok: false, why: 'nothing the composer asked for could be built',
               elements: [], rejected };
    }
    return { ok: true, elements, rejected, reason: str(obj.reason) };
  }

  /** Turn an intent into a buildable scene plan. Never throws. */
  async function composeScene({ narration, intent, manifest, hasFootage, revision, project } = {}) {
    if (!available()) return { ok: false, why: 'the composer is not reachable' };
    const R = window.BlvckAssetRegistry;
    const assetLines = manifest && manifest.assets && manifest.assets.length
      ? R.describeForPrompt(manifest) : '';
    let raw;
    try {
      raw = await ask(composePrompt({ narration, intent, assetLines, hasFootage, revision, project,
                                      unmet: (manifest && manifest.unmet) || [] }),
                      { maxTokens: 700, timeoutMs: COMPOSER_TIMEOUT_MS });
    } catch (err) {
      return { ok: false, why: 'the composer failed: ' + err.message };
    }
    const plan = parseScene(raw, manifest, project);
    plan.raw = raw;
    return plan;
  }

  // ── The route ────────────────────────────────────────────────────────────

  /**
   * A HYPERFRAME beat, from narration to a clip on the timeline.
   *
   * No acquisition, no footage, no vision-on-footage. Every failure returns a
   * reason and leaves the scene usable — the pipeline continues with a beat
   * that has no visual rather than stopping.
   */
  async function runRoute(scene, { project, onProgress, force = false, mode } = {}) {
    // FULL_FRAME  the composition is the whole picture; no footage anywhere
    // HYBRID      the shot becomes an element INSIDE the composition and the
    //             graphics are built around it; one clip comes out
    // OVERLAY     the composition renders transparent and AETHER's compositor
    //             draws it over the footage clip
    const HF_MODE = ['FULL_FRAME', 'HYBRID', 'OVERLAY'].indexOf(String(mode || '').toUpperCase()) >= 0
      ? String(mode).toUpperCase()
      : ((scene.hyperFrame && scene.hyperFrame.mode) || 'FULL_FRAME');
    const say = (s) => { if (onProgress) onProgress(s); };
    const fail = (stage, why) => {
      scene.hyperFrame = Object.assign({}, scene.hyperFrame,
        { mode: HF_MODE, status: 'failed', failure: { stage, why }, at: Date.now() });
      return { ok: false, stage, why };
    };

    if (!force && scene.hyperFrame && scene.hyperFrame.status === 'ready') {
      return { ok: true, skipped: 'already built' };
    }

    // 1. What should this beat get across?
    say('deciding what the beat should convey');
    const d = await direct({ narration: scene.subtitle, sceneSummary: scene.sceneSummary });
    if (!d.ok) return fail('director', d.why);
    scene.visualIntent = d.intent;

    // 2. What may it be built from?
    say('gathering approved assets');
    let manifest = { assets: [], missing: [], unmet: d.intent.assetNeeds };
    try {
      manifest = await window.BlvckAssetRegistry.manifestFor({ wanted: d.intent.assetNeeds });
    } catch (err) {
      // An empty manifest is a workable answer: the beat is built from type.
      console.warn('[HyperFrame] the asset registry failed: ' + err.message);
    }
    scene.assetManifest = manifest.assets.map((a) => ({
      assetId: a.assetId, type: a.type, source: a.source,
      rightsStatus: a.rights.status, rightsBasis: a.rights.basis,
      description: a.description, fileName: a.fileName
    }));

    // 2b. The shot itself, for the modes that use one.
    let shot = null;
    if (HF_MODE === 'HYBRID') {
      say('reading the selected footage');
      try { shot = await window.BlvckAssetRegistry.footageFor(scene); }
      catch (err) { return fail('footage', 'the footage could not be read: ' + err.message); }
      if (!shot) return fail('footage', 'HYBRID needs footage this scene does not have');
    }

    // 3. Which components carry it?
    say('composing the scene');
    let plan = await composeScene({ narration: scene.subtitle, intent: d.intent, manifest,
                                    hasFootage: !!shot, project });
    if (!plan.ok) return fail('composer', plan.why);

    // The shot is not the Composer's to request or to leave out: if this beat
    // is HYBRID the footage IS the background, so it is placed here rather than
    // being hoped for in the model's answer.
    if (shot) {
      plan.elements = plan.elements.filter((e) => e.kind !== 'footage');
      plan.elements.unshift({ kind: 'footage', file: shot.fileName, mediaStart: shot.mediaStart });
    }

    // 4. Source, from vetted templates rather than from the model.
    const C = window.BlvckHyperFrameComponents;
    const win = window.BlvckRenderer._shotWindowOf(scene);
    if (!win) return fail('timing', 'this scene has no place on the timeline yet');
    const seconds = Math.round((win.timelineEnd - win.timelineStart) * 100) / 100;

    const build = (els) => C.compose({ elements: els, seconds, project,
                                       transparent: HF_MODE === 'OVERLAY' });
    let source;
    try { source = build(plan.elements); }
    catch (err) { return fail('compose', err.message); }

    // 4b. Look at the layout BEFORE spending thirty seconds rendering it.
    //
    // ONE revision, and only for problems a different set of components could
    // fix. A pipeline that regenerates until it approves of its own work will
    // regenerate forever on the beat it cannot do, so the second answer is
    // taken whether or not it is better, and what is still wrong is recorded
    // rather than hidden.
    const EV = window.BlvckHyperFrameEvaluator;
    let layout = EV ? await EV.inspectLayout(source) : { ok: true, problems: [] };

    if (EV && !layout.ok && layout.problems.some((x) => x.fixable)) {
      say('the layout has problems — composing once more');
      const note = EV.revisionNote({ fixable: layout.problems.filter((x) => x.fixable) });
      const second = await composeScene({ narration: scene.subtitle, intent: d.intent, manifest,
                                          hasFootage: !!shot, project, revision: note });
      if (second.ok) {
        if (shot) {
          second.elements = second.elements.filter((e) => e.kind !== 'footage');
          second.elements.unshift({ kind: 'footage', file: shot.fileName, mediaStart: shot.mediaStart });
        }
        try {
          const retrySource = build(second.elements);
          const retryLayout = await EV.inspectLayout(retrySource);
          // Kept only if it is actually better. A revision that trades one
          // problem for two is not a revision.
          if (retryLayout.problems.length < layout.problems.length) {
            plan = second; source = retrySource; layout = retryLayout;
          }
        } catch (err) { /* keep the first attempt */ }
      }
      scene.hyperFrameRevised = true;
    }
    scene.hyperFrameLayout = { ok: layout.ok, density: layout.density,
                               problems: layout.problems.map((x) => x.why) };
    scene.hyperFrameSource = source;

    // 5. Render, and become this scene's clip.
    say('rendering');
    try {
      const assets = await window.BlvckAssetRegistry.toRenderAssets(manifest);
      if (shot) assets.push(...await window.BlvckAssetRegistry.toRenderAssets({ assets: [shot] }));
      const gsapText = await window.BlvckHyperFrame.gsap();
      const out = HF_MODE === 'OVERLAY'
        ? await window.BlvckHyperFrame.renderOverlay(scene, {
            source, assets, vendor: [{ name: 'gsap.min.js', text: gsapText }] })
        : await window.BlvckHyperFrame.renderScene(scene, {
            source, assets, vendor: [{ name: 'gsap.min.js', text: gsapText }] });
      // 6. Does the picture say what the beat needed it to say? Recorded, not
      // enforced: a describer using different words is not a reason to rebuild
      // a scene that is structurally sound.
      let reading = { ran: false, why: 'not evaluated' };
      if (EV) {
        say('reading the rendered frame');
        try { reading = await EV.readsAsIntended(out.blob, d.intent); }
        catch (err) { reading = { ran: false, why: 'the read failed: ' + err.message }; }
      }
      scene.hyperFrameEvaluation = {
        layout: scene.hyperFrameLayout,
        reading: { ran: reading.ran, sees: reading.sees || '', overlap: reading.overlap ?? null,
                   why: reading.why || '' },
        revised: !!scene.hyperFrameRevised,
        at: Date.now()
      };

      scene.hyperFrame = Object.assign({}, scene.hyperFrame, {
        mode: HF_MODE,
        style: styleOf(project).name,
        elements: plan.elements.map((e) => e.kind),
        rejected: (plan.rejected || []).map((r) => r.why),
        reason: plan.reason || d.intent.concept,
        anchorPhrase: d.intent.anchorPhrase
      });
      return { ok: true, seconds: out.seconds, renderMs: out.renderMs,
               evaluation: scene.hyperFrameEvaluation,
               elements: plan.elements, rejected: plan.rejected,
               intent: d.intent, manifest: scene.assetManifest };
    } catch (err) {
      return fail('render', err.message);
    }
  }

  window.BlvckHyperFrameComposer = {
    direct, composeScene, runRoute, available,
    _parseIntent: parseIntent,
    _parseScene: parseScene,
    _limitFor: limitFor,
    _styleOf: styleOf,
    _intentPrompt: intentPrompt,
    _composePrompt: composePrompt,
    MAX_ELEMENTS
  };
})();

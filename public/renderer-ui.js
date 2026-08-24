// The Renderer workspace: run the stage, and show what it decided and why.
//
// The interesting thing to show here is not the cards. It is the reasoning. A
// beat with no card has two very different explanations - the Director looked
// and judged the footage sufficient, or the Director never answered - and a
// producer who cannot tell them apart has no way to know whether to re-run.
// So every beat reports which it was.
//
// This module owns no timing, no drawing and no decision logic. It calls
// BlvckRenderer.runStage and paints the result.
(() => {
  'use strict';

  const card = document.getElementById('renderer-card');
  if (!card) return;

  const runBtn    = document.getElementById('renderer-run');
  const stopBtn   = document.getElementById('renderer-stop');
  const clearBtn  = document.getElementById('renderer-clear');
  const scopeEl   = document.getElementById('renderer-scope');
  const statusEl  = document.getElementById('renderer-status');
  const summaryEl = document.getElementById('renderer-summary');
  const beatsEl   = document.getElementById('renderer-beats');
  const provEl    = document.getElementById('renderer-provider');

  const SB_LS = 'blvck-tts:storyboard';
  let running = null;   // an AbortController while the stage is walking

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function say(msg, kind) {
    if (!statusEl) return;
    statusEl.hidden = !msg;
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function scenes() {
    const SBM = window.BlvckStoryboard;
    const live = SBM && SBM.scenes ? SBM.scenes() : null;
    if (live && live.length) return live;
    try { return (JSON.parse(localStorage.getItem(SB_LS) || 'null') || {}).scenes || []; }
    catch (e) { return []; }
  }

  // ── Is the Director reachable at all? ───────────────────────────────────
  function paintProvider() {
    if (!provEl) return;
    const up = !!(window.BlvckRenderer && window.BlvckRenderer.available());
    provEl.textContent = up ? '✓ Director ready' : '⚠ Director unreachable';
    provEl.className = 'badge ' + (up ? 'elite' : 'standard');
    provEl.title = up
      ? 'NVIDIA NIM has a key and an adapter. Each beat takes roughly 12–30s.'
      : 'No NIM key, or the adapter has not loaded. The stage will report every '
        + 'beat as undecided rather than inventing cards.';
    if (runBtn) runBtn.disabled = !!running;
  }

  // ── One beat ────────────────────────────────────────────────────────────
  function beatRow(scene) {
    const row = document.createElement('div');
    row.className = 'card';
    row.style.cssText = 'padding:.6rem .8rem;background:var(--panel,rgba(255,255,255,.03))';

    const d  = scene.rendererDecision || null;
    const els = Array.isArray(scene.rendererElements) ? scene.rendererElements : [];

    // The distinction that matters: a judgement, an outage, or never asked.
    let mark = '·', tone = 'var(--muted)', verdict = 'not decided yet';
    if (d && d.ran && els.length)      { mark = '✦'; tone = 'var(--accent,#7cd)';  verdict = `${els.length} element${els.length > 1 ? 's' : ''}`; }
    else if (d && d.ran)               { mark = '—'; tone = 'var(--muted)';        verdict = 'nothing needed'; }
    else if (d && !d.ran)              { mark = '!'; tone = 'var(--warn,#e0a030)'; verdict = 'the Director did not answer'; }

    // A HYPERFRAME beat has no footage AND THAT IS THE POINT. Left to the
    // footage vocabulary it would read as a scene that failed to find a clip,
    // which is exactly backwards: it is a scene that was never going to look
    // for one. So it says its own state in its own words.
    const hf = scene.hyperFrame || null;
    if (hf) {
      if (hf.status === 'ready')       { mark = '▣'; tone = 'var(--accent,#7cd)';  verdict = `${hf.mode || 'FULL_FRAME'} · built`; }
      else if (hf.status === 'failed') { mark = '!'; tone = 'var(--warn,#e0a030)'; verdict = 'could not be built'; }
      else if (hf.status)              { mark = '▢'; tone = 'var(--muted)'; verdict = String(hf.status); }
    }

    // Which medium the beat is made of. FOOTAGE is the default and the quiet
    // case, so only a decided non-default strategy earns a chip - a row full of
    // "FOOTAGE" badges would be noise on a project nobody has planned yet.
    const P = window.BlvckVisualPlanner;
    const mode = P ? P.strategyOf(scene) : 'FOOTAGE';
    const decided = P ? P.planned(scene) : false;
    const chip = (decided && mode !== 'FOOTAGE')
      ? `<span class="badge standard" title="${esc((scene.visualStrategy || {}).reason || '')}"
              style="font-size:.68rem">${esc(mode)}</span>` : '';

    row.innerHTML =
      `<div style="display:flex;gap:.6rem;align-items:baseline">
         <span style="color:${tone};font-weight:700;min-width:1.2em">${mark}</span>
         <span style="font-weight:600">Scene ${esc(scene.index)}</span>
         ${chip}
         <span style="color:${tone};font-size:.8rem">${esc(verdict)}</span>
       </div>
       <div style="color:var(--muted);font-size:.8rem;margin:.25rem 0 0 1.8em">
         ${esc(String(scene.subtitle || '').slice(0, 130))}
       </div>` +
      (d && d.reason
        ? `<div style="font-size:.78rem;margin:.3rem 0 0 1.8em;opacity:.85">
             <em>${esc(d.reason)}</em></div>`
        : '') +
      els.map((e) => `
        <div style="font-size:.78rem;margin:.3rem 0 0 1.8em;display:flex;gap:.5rem;flex-wrap:wrap">
          <span class="badge standard">${esc(e.kind)}</span>
          <span>${esc(e.content || e.label || (e.items || []).join(' · '))}</span>
          <span style="color:var(--muted)">
            ${e.anchoredTo
               ? `on “${esc(e.anchoredTo)}” · ${Number(e.start).toFixed(2)}–${Number(e.end).toFixed(2)}s`
               : `${Number(e.start).toFixed(2)}–${Number(e.end).toFixed(2)}s · the phrase was not found, so it holds the shot`}
          </span>
        </div>`).join('') +
      ((d && d.rejected && d.rejected.length)
        ? `<div style="font-size:.75rem;margin:.3rem 0 0 1.8em;color:var(--warn,#e0a030)">
             refused: ${esc(d.rejected.join('; '))}</div>`
        : '')
      + hyperFrameDetail(scene);

    if (hf) row.appendChild(hyperFrameActions(scene));
    return row;
  }

  const line = (label, value, colour) =>
    `<div style="font-size:.76rem;margin:.25rem 0 0 1.8em;display:flex;gap:.5rem">
       <span style="color:var(--faint,#8b98a5);min-width:6.4em">${esc(label)}</span>
       <span style="${colour ? `color:${colour};` : ''}flex:1;min-width:0">${value}</span>
     </div>`;

  /** Everything about a code-built scene a producer has to be able to see. */
  function hyperFrameDetail(scene) {
    const hf = scene.hyperFrame;
    if (!hf) return '';
    const out = [];

    if (scene.visualIntent && scene.visualIntent.concept) {
      out.push(line('conveys', esc(scene.visualIntent.concept)));
    }
    if (hf.anchorPhrase) out.push(line('anchored to', `“${esc(hf.anchorPhrase)}”`));
    if (Array.isArray(hf.elements) && hf.elements.length) {
      out.push(line('built from', hf.elements.map((k) =>
        `<span class="badge standard" style="font-size:.66rem">${esc(k)}</span>`).join(' ')));
    }

    // No footage is a STATE, not an absence. Saying so is the difference
    // between a producer trusting the scene and going looking for the bug.
    const P = window.BlvckVisualPlanner;
    if (P && P.strategyOf(scene) === 'HYPERFRAME') {
      out.push(line('footage', 'none — this beat is built, not filmed', 'var(--muted)'));
    } else if (scene.stockAsset) {
      out.push(line('footage', esc(`${scene.stockAsset.provider}:${scene.stockAsset.id}`)));
    }

    const manifest = scene.assetManifest || [];
    out.push(line('assets', manifest.length
      ? manifest.map((a) => `${esc(a.assetId)} <span style="opacity:.6">(${esc(a.rightsBasis || a.rightsStatus)})</span>`).join(', ')
      : '<span style="opacity:.6">none approved for this beat</span>'));

    // What the evaluator found. Problems first: that is what someone scanning
    // a list of scenes is looking for.
    const ev = scene.hyperFrameEvaluation;
    if (ev) {
      const probs = (ev.layout && ev.layout.problems) || [];
      out.push(line('layout', probs.length
        ? esc(probs.join('; '))
        : `no problems found${ev.layout && ev.layout.density != null
            ? ` · ${Math.round(ev.layout.density * 100)}% of the frame used` : ''}`,
        probs.length ? 'var(--warn,#e0a030)' : 'var(--ok,#34d399)'));
      if (ev.revised) out.push(line('', 'composed twice — the first layout had problems', 'var(--muted)'));
      if (ev.reading && ev.reading.ran) {
        out.push(line('a viewer sees', `“${esc(ev.reading.sees)}”`
          + (ev.reading.overlap != null
             ? ` <span style="opacity:.6">(${Math.round(ev.reading.overlap * 100)}% of the idea)</span>` : '')));
      } else if (ev.reading && ev.reading.why) {
        out.push(line('a viewer sees', esc(ev.reading.why), 'var(--muted)'));
      }
    }

    if (hf.status === 'failed' && hf.failure) {
      out.push(line('failed at', esc(`${hf.failure.stage}: ${hf.failure.why}`), 'var(--warn,#e0a030)'));
    }
    if (hf.renderMs) {
      out.push(line('rendered', `${(hf.renderMs / 1000).toFixed(1)}s`
        + (hf.durationSec ? ` for ${hf.durationSec}s of film` : '')
        + (hf.bytes ? ` · ${(hf.bytes / 1024).toFixed(0)}KB` : '')));
    }
    return out.join('');
  }

  /** What can be done about it. */
  function hyperFrameActions(scene) {
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:.4rem;flex-wrap:wrap;margin:.5rem 0 0 1.8em';
    const hf = scene.hyperFrame || {};

    const add = (label, title, fn, enabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ghost small';
      b.style.fontSize = '.7rem';
      b.textContent = label;
      b.title = title;
      b.disabled = enabled === false;
      b.addEventListener('click', fn);
      bar.appendChild(b);
    };

    add(hf.status === 'ready' ? 'Rebuild' : 'Build',
        'Ask the Visual Director and Composer again, and re-render.',
        () => buildScene(scene), true);
    add('Preview', 'Play what was rendered for this scene.',
        () => previewScene(scene), hf.status === 'ready');
    add('Source', 'Read the composition this scene was rendered from.',
        () => showSource(scene), !!scene.hyperFrameSource);
    add('Reset', 'Forget the build. The narration and the timing are untouched.',
        () => resetScene(scene), !!hf.status);
    return bar;
  }

  function resetScene(scene) {
    for (const k of ['hyperFrame', 'hyperFrameSource', 'hyperFrameEvaluation',
                     'hyperFrameLayout', 'hyperFrameRevised', 'visualIntent', 'assetManifest']) {
      delete scene[k];
    }
    const SBM = window.BlvckStoryboard;
    if (SBM && SBM.save) SBM.save();
    say(`Scene ${scene.index}: build cleared. The narration and timing are untouched.`, 'info');
    paint();
  }

  async function buildScene(scene) {
    const C = window.BlvckHyperFrameComposer;
    if (!C) { say('The HyperFrame composer is not loaded.', 'error'); return; }
    say(`Scene ${scene.index}: building…`, 'info');
    try {
      const res = await C.runRoute(scene, {
        force: true,
        mode: (scene.hyperFrame && scene.hyperFrame.mode) || undefined,
        onProgress: (step) => say(`Scene ${scene.index}: ${step}…`, 'info')
      });
      const SBM = window.BlvckStoryboard;
      if (SBM && SBM.save) SBM.save();
      say(res.ok
        ? `Scene ${scene.index} built in ${(res.renderMs / 1000).toFixed(1)}s.`
        : `Scene ${scene.index} could not be built — ${res.stage}: ${res.why}`,
        res.ok ? 'success' : 'error');
    } catch (err) {
      say(`Scene ${scene.index}: ${err.message}`, 'error');
    }
    paint();
  }

  function storedBlob(key) {
    return new Promise((res, rej) => {
      const rq = indexedDB.open('blvck-storyboard', 1);
      rq.onsuccess = () => {
        try {
          const tx = rq.result.transaction('images', 'readonly');
          const g = tx.objectStore('images').get(key);
          g.onsuccess = () => res(g.result || null);
          g.onerror = () => rej(g.error);
        } catch (e) { rej(e); }
      };
      rq.onerror = () => rej(rq.error);
    });
  }

  async function previewScene(scene) {
    const hf = scene.hyperFrame || {};
    const key = hf.overlayKey || `clip:${scene.index}`;
    try {
      const blob = await storedBlob(key);
      if (!blob) { say('Nothing has been rendered for this scene yet.', 'error'); return; }
      openSheet(`Scene ${scene.index} — ${key}`, (body) => {
        const v = document.createElement('video');
        v.src = URL.createObjectURL(blob);
        v.controls = true; v.autoplay = true; v.loop = true; v.muted = true;
        v.style.cssText = 'width:100%;max-height:70vh;background:#111;border-radius:6px';
        body.appendChild(v);
        if (hf.overlayKey) {
          const note = document.createElement('p');
          note.className = 'field-note';
          note.textContent = 'This is the overlay on its own. In the video it is drawn '
            + 'over the footage, and everything dark here is transparent.';
          body.appendChild(note);
        }
      });
    } catch (err) {
      say('Could not open the render: ' + err.message, 'error');
    }
  }

  function showSource(scene) {
    openSheet(`Scene ${scene.index} — composition source`, (body) => {
      const pre = document.createElement('pre');
      pre.textContent = scene.hyperFrameSource || '';
      pre.style.cssText = 'max-height:70vh;overflow:auto;font-size:.72rem;line-height:1.5;'
        + 'background:rgba(0,0,0,.3);padding:1rem;border-radius:6px;white-space:pre-wrap';
      body.appendChild(pre);
    });
  }

  /** A plain sheet, so a preview or a source dump has somewhere to live. */
  function openSheet(title, fill) {
    const back = document.createElement('div');
    back.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.82);'
      + 'display:flex;align-items:center;justify-content:center;padding:24px';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--panel,#151b21);border-radius:10px;padding:1.1rem 1.25rem;'
      + 'max-width:min(1100px,94vw);width:100%;box-shadow:0 24px 60px rgba(0,0,0,.6)';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem';
    head.innerHTML = `<strong style="font-size:.9rem">${esc(title)}</strong>`;
    const close = document.createElement('button');
    close.className = 'btn ghost small';
    close.textContent = 'Close';
    close.addEventListener('click', () => back.remove());
    head.appendChild(close);
    const body = document.createElement('div');
    box.append(head, body);
    back.appendChild(box);
    back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
    document.body.appendChild(back);
    fill(body);
  }

  function paint() {
    if (!beatsEl) return;
    const list = scenes();
    beatsEl.innerHTML = '';
    if (!list.length) {
      summaryEl.textContent = 'No scenes yet. Build a storyboard and choose footage first — '
        + 'the Renderer decides what goes on a picture that already exists.';
      return;
    }
    for (const s of list) beatsEl.appendChild(beatRow(s));

    const decided = list.filter((s) => s.rendererDecision && s.rendererDecision.ran);
    const carded  = list.filter((s) => (s.rendererElements || []).length);
    const failed  = list.filter((s) => s.rendererDecision && !s.rendererDecision.ran);
    summaryEl.textContent =
      `${list.length} beat(s) · ${decided.length} decided · ${carded.length} carrying a card`
      + (failed.length ? ` · ${failed.length} the Director could not answer` : '');
  }

  // ── Running the stage ───────────────────────────────────────────────────
  async function run() {
    if (running) return;
    if (!scenes().length) { say('There are no scenes to decide over yet.', 'warn'); return; }

    running = new AbortController();
    runBtn.disabled = true;
    if (stopBtn) stopBtn.hidden = false;
    if (clearBtn) clearBtn.disabled = true;

    const force = scopeEl && scopeEl.value === 'all';
    let done = 0;
    say('Asking the Director about each beat… roughly 12–30s per beat.', 'info');

    let summary = null;
    try {
      summary = await window.BlvckRenderer.runStage({
        force,
        signal: running.signal,
        onProgress: (p) => {
          if (p.working) {
            say(`Scene ${p.scene.index}: deciding… (${done} done)`, 'info');
          } else {
            done++;
            paint();
          }
        }
      });
    } catch (err) {
      // runStage is written not to throw; this is the belt.
      say('The Renderer stage stopped: ' + err.message, 'error');
    } finally {
      running = null;
      if (stopBtn) stopBtn.hidden = true;
      if (clearBtn) clearBtn.disabled = false;
      paintProvider();
      paint();
    }

    if (!summary) return;
    const bits = [];
    if (summary.added)   bits.push(`${summary.added} element(s) across ${summary.decided - summary.nothing} beat(s)`);
    if (summary.nothing) bits.push(`${summary.nothing} beat(s) judged to need nothing`);
    if (summary.skipped) bits.push(`${summary.skipped} skipped`);
    if (summary.failed)  bits.push(`${summary.failed} the Director could not answer`);
    say((summary.stopped ? 'Stopped. ' : 'Done. ') + (bits.join(' · ') || 'nothing to do.'),
        summary.failed ? 'warn' : 'success');
  }

  function clearAll() {
    const list = scenes();
    if (!list.length) return;
    for (const s of list) { s.rendererElements = null; s.rendererDecision = null; }
    const SBM = window.BlvckStoryboard;
    if (SBM && SBM.scenes && SBM.scenes().length && SBM.save) {
      SBM.save();
    } else {
      try {
        const sb = JSON.parse(localStorage.getItem(SB_LS) || 'null');
        if (sb) { sb.scenes = list; localStorage.setItem(SB_LS, JSON.stringify(sb)); }
      } catch (e) { /* quota — non-fatal */ }
    }
    say('Cleared every decision. The footage and its timing are untouched.', 'info');
    paint();
  }

  if (runBtn)   runBtn.addEventListener('click', run);
  if (stopBtn)  stopBtn.addEventListener('click', () => {
    if (running) { running.abort(); say('Stopping after this beat…', 'info'); }
  });
  if (clearBtn) clearBtn.addEventListener('click', clearAll);

  window.addEventListener('blvck-storyboard-updated', paint);
  window.addEventListener('aether:workspace-changed', (e) => {
    if (e.detail && e.detail.workspace === 'renderer') { paintProvider(); paint(); }
  });

  paintProvider();
  paint();
  // The key can be entered after load, so the badge is not a one-shot.
  setInterval(paintProvider, 3000);

  window.BlvckRendererUI = { _paint: paint, _beatRow: beatRow, _run: run, _clear: clearAll };
})();

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
        : '');
    return row;
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

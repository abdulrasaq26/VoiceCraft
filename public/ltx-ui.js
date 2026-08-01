// LTX video panel wiring — lives in the Video stage, drives BlvckLTX.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const el = {
    panel: null, endpoint: null, online: null, res: null, aspect: null, msr: null,
    plan: null, generate: null, cancel: null, summary: null, status: null
  };

  // True once the user has been shown the cost of a long run and the button is
  // waiting for a second, deliberate click.
  let armed = false;

  function disarm() {
    armed = false;
    const b = $('ltx-generate');
    if (b) {
      b.textContent = 'Generate all scene clips';
      b.classList.remove('danger');
    }
  }

  function status(msg, kind) {
    if (!el.status) return;
    el.status.hidden = !msg;
    el.status.textContent = msg || '';
    el.status.className = `status${kind ? ` ${kind}` : ''}`;
  }

  function setBadge(text, ok) {
    if (!el.online) return;
    el.online.textContent = text;
    el.online.className = `badge${ok ? ' premium' : ''}`;
  }

  async function probe() {
    if (!window.LTXAdapter) return;
    if (!window.LTXAdapter.endpoint()) return setBadge('no endpoint', false);
    setBadge('checking…', false);
    const r = await window.LTXAdapter.checkOnline();
    if (r.online) {
      const c = r.caps || {};
      setBadge(`online · ${c.model ? String(c.model).replace(/^LTX-/, '') : 'ready'}`, true);
      status('');
    } else {
      setBadge('offline', false);
      // Surface the real reason rather than a generic "offline".
      status(`LTX backend unreachable: ${r.error || 'no response'}`, '');
    }
  }

  function sceneCount() {
    try {
      const sb = JSON.parse(localStorage.getItem('blvck-tts:storyboard') || 'null');
      return ((sb && sb.scenes) || []).filter((s) => s.status === 'done').length;
    } catch {
      return 0;
    }
  }

  function refreshSummary() {
    if (!el.summary || !window.BlvckLTX) return;
    const est = window.BlvckLTX.estimateRun(el.res ? el.res.value : '480p');
    if (!est.total) {
      el.summary.textContent = 'No scenes to render yet — plan the storyboard first.';
      return;
    }
    const done = window.BlvckLTX.doneCount();
    const cost = est.minutes >= 90 ? `${est.hours} hours` : `${est.minutes} min`;
    el.summary.textContent =
      `${done}/${est.total} rendered · ${est.gpuBeats} beat(s) need the GPU` +
      `${est.canvasBeats ? `, ${est.canvasBeats} drawn instantly` : ''}` +
      ` · about ${cost} at ${est.resolution}`;
  }

  function opts() {
    return {
      resolution: el.res ? el.res.value : '720p',
      aspect: el.aspect ? el.aspect.value : '16:9 Landscape',
      msrScale: el.msr ? Number(el.msr.value) || 1 : 1,
      // 1080p renders 1088 tall because the backend floors to /32; crop back.
      outputHeight: el.res && el.res.value === '1080p' ? 1080 : null
    };
  }

  async function onPlan() {
    if (!window.BlvckLTX) return;
    el.plan.disabled = true;
    status('Planning shots — reading the whole storyboard for camera moves and continuity…', 'info');
    try {
      const r = await window.BlvckLTX.planWithDirector();
      const warn = r.warnings && r.warnings.length
        ? ` ⚠ ${r.warnings.length} continuity warning(s): ${r.warnings.join('; ')}`
        : '';
      const mix = Object.entries(r.mix || {})
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${n}× ${k}`)
        .join(', ');
      const drift = r.mixDrift && r.mixDrift.length
        ? ` ⚠ Off-mode: ${r.mixDrift.join('; ')}.`
        : '';
      // Retention notes come last but matter most — they are the difference
      // between a correct video and a watchable one.
      const ret = r.retention && r.retention.issues && r.retention.issues.length
        ? ' 📉 ' + r.retention.issues
          .slice(0, 3)
          .map((i) => `[${i.where}] ${i.message}`)
          .join(' ')
        : ' ✓ No retention problems found.';
      status(
        `Planned ${r.applied} scene(s) as ${r.mode || 'default'} — ${mix || 'no mix reported'}; ` +
        `host on screen in ${r.hostShots}. ${r.strategy || ''}${warn}${drift}${ret}`,
        'info'
      );
    } catch (err) {
      status(`Shot planning failed: ${err.message}`);
    } finally {
      el.plan.disabled = false;
    }
  }

  async function onGenerate() {
    if (!window.BlvckLTX) return;
    const est = window.BlvckLTX.estimateRun(el.res ? el.res.value : '480p');
    if (!est.todo) return status('Nothing left to render — every scene already has a clip.');

    // Two-step confirm, deliberately NOT window.confirm().
    //
    // A native dialog is suppressed outright in some embedded browsers: it
    // returns false without ever appearing, so a long run could never be
    // started and the panel just kept reporting "Cancelled". Arming the button
    // in-page always works and shows the cost in the same place as the result.
    if (est.minutes >= 45 && !armed) {
      armed = true;
      el.generate.textContent = `Confirm — start ~${est.hours}h run`;
      el.generate.classList.add('danger');
      status(
        `This run is about ${est.hours} hours: ${est.gpuBeats} beat(s) at ${est.resolution}` +
        `${est.canvasBeats ? `, plus ${est.canvasBeats} drawn instantly` : ''}. ` +
        'Renders continue on the backend and resume if interrupted, but the Kaggle session must stay alive. ' +
        'Click again to start, or lower the resolution first.',
        'info'
      );
      return;
    }
    disarm();

    el.generate.disabled = true;
    el.plan.disabled = true;
    if (el.cancel) el.cancel.hidden = false;

    try {
      const res = await window.BlvckLTX.generateAll(Object.assign(opts(), {
        onProgress: (p) => {
          if (p.phase === 'start') {
            status(`Rendering scene ${p.index} (${p.i + 1} of ${p.total})… this takes minutes per clip.`, 'info');
          } else if (p.phase === 'error') {
            status(`Scene ${p.index} failed: ${p.error}`);
          }
          refreshSummary();
        }
      }));

      const bits = [`${res.done} rendered`];
      if (res.skipped) bits.push(`${res.skipped} already done`);
      if (res.failed) bits.push(`${res.failed} failed`);
      if (res.cancelled) bits.push('stopped early');

      // Beats longer than LTX's 30s ceiling hold their last frame for the
      // remainder. Say so plainly — it is visible in the finished video.
      const long = Object.entries(window.BlvckLTX.allStatus())
        .filter(([, r]) => r && r.truncated)
        .map(([i, r]) => `#${i} (+${r.shortBy}s)`);
      const longNote = long.length
        ? ` ${long.length} scene(s) exceed LTX's 30s limit and will freeze on their last frame: ${long.join(', ')}. Consider splitting those narration beats.`
        : '';

      status(
        `${bits.join(' · ')}. Now click “Auto-assemble from project” to cut them against the narration.${longNote}`,
        res.failed || long.length ? '' : 'info'
      );
    } catch (err) {
      status(`Video generation failed: ${err.message}`);
    } finally {
      el.generate.disabled = false;
      el.plan.disabled = false;
      if (el.cancel) el.cancel.hidden = true;
      disarm();
      refreshSummary();
    }
  }

  function describeMode() {
    const note = $('ltx-mode-note');
    if (!note || !window.BlvckModes) return;
    const m = window.BlvckModes.current();
    const mix = Object.entries(m.mix)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
      .join(' · ');
    const host = m.host.share <= 0
      ? 'no host on screen'
      : `host ${Math.round(m.host.share * 100)}% of beats, ${m.host.size} ${m.host.layout}`;
    note.textContent = `${m.inspiration ? `Like ${m.inspiration}. ` : ''}Target mix: ${mix}. ${host}.`;
  }

  async function onSelfTest() {
    const b = $('ltx-selftest');
    if (!b || !window.LTXAdapter) return;
    b.disabled = true;
    status('Rendering a 2s test clip from text alone — this takes a minute or two on a T4…', 'info');
    try {
      const r = await window.LTXAdapter.selfTestTextToVideo();
      if (r.supports_text_only === true) {
        status('Text-to-video works on this backend. Content scenes will render straight from the script.', 'info');
      } else {
        status(
          `This backend cannot do text-to-video: ${r.error || 'unknown reason'}. ` +
          'Content scenes will need storyboard stills, or the notebook has to load a non-MSR model.'
        );
      }
    } catch (err) {
      status(`Self-test failed: ${err.message}`);
    } finally {
      b.disabled = false;
      probe();
    }
  }

  function init() {
    el.panel = $('ltx-panel');
    if (!el.panel) return;

    const modeSel = $('ltx-mode');
    if (modeSel && window.BlvckModes) {
      modeSel.innerHTML = window.BlvckModes.MODES
        .map((m) => `<option value="${m.id}">${m.label}</option>`)
        .join('');
      modeSel.value = window.BlvckModes.current().id;
      modeSel.addEventListener('change', () => {
        window.BlvckModes.setCurrent(modeSel.value);
        describeMode();
      });
      describeMode();
    }
    const st = $('ltx-selftest');
    if (st) st.addEventListener('click', onSelfTest);

    // Changing resolution changes the cost, so re-price the run and cancel any
    // armed confirmation — otherwise a second click could start a run the user
    // was never shown the price of.
    if (el.res) {
      el.res.addEventListener('change', () => {
        disarm();
        refreshSummary();
      });
    }
    el.endpoint = $('ltx-endpoint');
    el.online = $('ltx-online');
    el.res = $('ltx-res');
    el.aspect = $('ltx-aspect');
    el.msr = $('ltx-msr');
    el.plan = $('ltx-plan');
    el.generate = $('ltx-generate');
    el.cancel = $('ltx-cancel');
    el.summary = $('ltx-summary');
    el.status = $('ltx-status');

    if (el.endpoint && window.LTXAdapter) {
      el.endpoint.value = window.LTXAdapter.endpoint();
      el.endpoint.addEventListener('change', () => {
        window.LTXAdapter.setEndpoint(el.endpoint.value);
        probe();
      });
    }
    if (el.plan) el.plan.addEventListener('click', onPlan);
    if (el.generate) el.generate.addEventListener('click', onGenerate);
    if (el.cancel) {
      el.cancel.addEventListener('click', () => {
        window.BlvckLTX.cancel();
        status('Stopping after the current scene finishes…', 'info');
      });
    }

    window.addEventListener('blvck:ltx-changed', refreshSummary);
    refreshSummary();
    probe();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

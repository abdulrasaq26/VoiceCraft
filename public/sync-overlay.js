// Synchronization debug overlay.
//
// Built before finishing the migration, deliberately. Sync bugs are close to
// undiagnosable without it: everything looks plausible in isolation, and the
// symptom ("the mouth is slightly off") gives no clue which subsystem is on a
// different clock. This makes the clock visible.
//
// It also answers the question that matters most during the migration — WHO IS
// STILL RUNNING THEIR OWN LOOP — by counting live rAF callbacks and comparing
// them against the controller's single one.
//
// Toggle with Ctrl+Shift+S, or BlvckSyncOverlay.toggle().
(() => {
  'use strict';

  let el = null;
  let visible = false;
  let unsub = [];
  let frames = 0;
  let lastFpsAt = 0;
  let fps = 0;
  let worstFrame = 0;
  let lastFrameAt = 0;

  // Count how many rAF callbacks the page schedules per frame. The controller
  // owns one; anything above that is a subsystem still driving itself, which is
  // exactly what the migration is meant to eliminate.
  let rafCount = 0;
  let rafPerFrame = 0;
  const nativeRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    rafCount++;
    return nativeRaf(cb);
  };

  const css = `
    position:fixed; right:12px; top:12px; z-index:2147483000;
    width:330px; max-height:88vh; overflow:auto;
    background:rgba(10,12,16,.94); color:#e8ecf2;
    font:12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    border:1px solid #2a3140; border-radius:10px; padding:10px 12px;
    box-shadow:0 18px 50px rgba(0,0,0,.55); backdrop-filter:blur(6px);
  `;

  function row(k, v, tone) {
    const colour = tone === 'good' ? '#4ade80' : tone === 'warn' ? '#fbbf24' : tone === 'bad' ? '#f87171' : '#9aa4b2';
    return `<div style="display:flex;gap:8px;justify-content:space-between">
      <span style="color:#7c8persist899">${k}</span>
      <span style="color:${colour};text-align:right;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v}</span>
    </div>`.replace('#7c8persist899', '#7c8899');
  }

  function bar(label, value, max, tone) {
    const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
    const colour = tone === 'bad' ? '#f87171' : tone === 'warn' ? '#fbbf24' : '#4ade80';
    return `<div style="margin:2px 0 6px">
      <div style="display:flex;justify-content:space-between;color:#7c8899"><span>${label}</span><span>${value}</span></div>
      <div style="height:4px;background:#1c222c;border-radius:2px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${colour}"></div>
      </div></div>`;
  }

  function sourceTone(src) {
    if (src === 'native' || src === 'phoneme') return 'good';
    if (src === 'aligned') return 'good';
    if (src === 'measured') return 'warn';
    return 'bad';
  }

  function render() {
    if (!el || !visible) return;
    const P = window.BlvckPlayback;
    const S = window.BlvckSync;
    if (!P) { el.innerHTML = '<b>BlvckPlayback not loaded</b>'; return; }

    const st = P.state();
    const tl = P.timeline();
    const events = P.events();
    const now = performance.now();

    // Frame timing.
    if (lastFrameAt) {
      const dt = now - lastFrameAt;
      if (dt > worstFrame) worstFrame = dt;
    }
    lastFrameAt = now;
    frames++;
    if (now - lastFpsAt >= 1000) {
      fps = frames;
      rafPerFrame = frames ? +(rafCount / frames).toFixed(2) : 0;
      frames = 0;
      rafCount = 0;
      worstFrame = 0;
      lastFpsAt = now;
    }

    const next = events.find((e) => e.time > st.time);
    const past = events.filter((e) => e.time <= st.time).length;

    // More than ~1 rAF per frame means a subsystem is still self-driving.
    const loopTone = rafPerFrame <= 1.2 ? 'good' : rafPerFrame <= 2.5 ? 'warn' : 'bad';

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b style="color:#f5b301">SYNC</b>
        <span style="color:#7c8899">Ctrl+Shift+S</span>
      </div>

      <div style="color:#7c8899;margin:6px 0 2px">CLOCK</div>
      ${row('time', st.time.toFixed(3) + 's')}
      ${row('duration', (P.duration() || 0).toFixed(3) + 's')}
      ${row('state', st.playing ? 'playing' : 'paused', st.playing ? 'good' : null)}
      ${row('rate', P.rate() + '×')}
      ${row('clock source', tl ? 'timeline' : 'none', tl ? 'good' : 'bad')}

      <div style="color:#7c8899;margin:8px 0 2px">TIMELINE</div>
      ${row('source', tl ? tl.source : '—', tl ? sourceTone(tl.source) : 'bad')}
      ${row('confidence', tl ? tl.confidence : '—', tl && tl.confidence >= 0.9 ? 'good' : tl ? 'warn' : 'bad')}
      ${row('provider', (tl && tl.provider) || '—')}
      ${row('words', tl ? tl.words.length : 0)}
      ${row('sentences', tl ? tl.sentences.length : 0)}
      ${row('pauses', tl ? tl.pauses.length : 0)}

      <div style="color:#7c8899;margin:8px 0 2px">NOW</div>
      ${row('word', st.word ? st.word.text : '—', st.speaking ? 'good' : null)}
      ${row('sentence', st.sentence ? '#' + st.sentence.index : '—')}
      ${row('speaking', st.speaking ? 'yes' : 'no', st.speaking ? 'good' : null)}
      ${row('in pause', st.pause ? 'yes' : 'no', st.pause ? 'warn' : null)}
      ${row('mouth', (st.mouth || 0).toFixed(3))}

      <div style="color:#7c8899;margin:8px 0 2px">EVENTS</div>
      ${row('scheduled', events.length)}
      ${row('fired', past)}
      ${row('next', next ? `${next.type}:${next.action || next.target} @${next.time}s` : '—')}

      <div style="color:#7c8899;margin:8px 0 2px">PERFORMANCE</div>
      ${bar('fps', fps, 60, fps >= 50 ? null : fps >= 30 ? 'warn' : 'bad')}
      ${row('rAF/frame', rafPerFrame, loopTone)}
      ${row('subscribers', window.__syncSubs || '—')}
      ${rafPerFrame > 1.2
        ? '<div style="color:#f87171;margin-top:6px">⚠ more than one loop running — a subsystem still drives itself</div>'
        : '<div style="color:#4ade80;margin-top:6px">✓ single loop</div>'}
    `;
  }

  function mount() {
    if (el) return;
    el = document.createElement('div');
    el.id = '__syncOverlay';
    el.style.cssText = css;
    document.body.appendChild(el);
    // Redraw on the controller's own frame signal, so the overlay itself never
    // becomes another independent loop — it would be reporting on a problem it
    // was contributing to.
    unsub.push(window.BlvckPlayback.on('frame', render));
    unsub.push(window.BlvckPlayback.on('seek', render));
    unsub.push(window.BlvckPlayback.on('timelineChanged', render));
    // A paused overlay must still tick, or it looks frozen rather than idle.
    const idle = setInterval(() => { if (!window.BlvckPlayback.isPlaying()) render(); }, 250);
    unsub.push(() => clearInterval(idle));
    render();
  }

  function unmount() {
    unsub.forEach((f) => { try { f(); } catch { /* ignore */ } });
    unsub = [];
    if (el) el.remove();
    el = null;
  }

  function toggle(force) {
    visible = force == null ? !visible : !!force;
    if (visible) mount();
    else unmount();
    return visible;
  }

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
      e.preventDefault();
      toggle();
    }
  });

  window.BlvckSyncOverlay = { toggle, isVisible: () => visible, render };
})();

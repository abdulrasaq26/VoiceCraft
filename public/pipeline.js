// Pipeline progress tracker — a sticky stepper showing where the user is in
// the production workflow (Script → Voice → Storyboard → Images → Video →
// YouTube), with completion state pulled from BlvckAssets. Clicking a step
// scrolls to that section.
(() => {
  'use strict';

  const bar = document.getElementById('pipeline');
  if (!bar || !window.BlvckAssets) return;

  const STEPS = [
    { key: 'research', label: 'Research', icon: '🔎', target: 'research-card' },
    { key: 'script', label: 'Script', icon: '📝', target: 'script-card' },
    { key: 'voice', label: 'Voice', icon: '🎙️', target: null }, // main voice studio (no id)
    { key: 'storyboard', label: 'Storyboard', icon: '🎬', target: 'storyboard-card' },
    { key: 'images', label: 'Stock Footage', icon: '🎥', target: 'image-card' },
    { key: 'video', label: 'Video', icon: '🎞️', target: 'editor-card' },
    { key: 'youtube', label: 'YouTube', icon: '🎯', target: 'youtube-card' }
  ];

  function scrollToStep(step) {
    if (window.AetherRouter) {
      window.AetherRouter.switchWorkspace(step.key);
    } else {
      const node = step.target ? document.getElementById(step.target) : document.querySelector('main.card');
      if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  let els = [];
  function build() {
    bar.innerHTML = '';
    const inner = document.createElement('div');
    inner.className = 'pipeline-inner';
    els = STEPS.map((step, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pipeline-step';
      b.innerHTML = `<span class="pipeline-num">${step.icon}</span><span class="pipeline-label">${step.label}</span><span class="pipeline-tick" hidden>✓</span>`;
      b.addEventListener('click', () => scrollToStep(step));
      inner.appendChild(b);
      if (i < STEPS.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'pipeline-sep';
        inner.appendChild(sep);
      }
      return b;
    });
    bar.appendChild(inner);
  }

  let lastSig = '';
  function refresh() {
    const st = window.BlvckAssets.status();
    const sig = STEPS.map((s) => (st[s.key] ? 1 : 0)).join('');
    if (sig === lastSig) return;
    lastSig = sig;
    let firstIncomplete = -1;
    STEPS.forEach((step, i) => {
      const done = !!st[step.key];
      const btn = els[i];
      btn.classList.toggle('done', done);
      btn.querySelector('.pipeline-tick').hidden = !done;
      if (!done && firstIncomplete === -1) firstIncomplete = i;
    });
    // Mark the current step (first incomplete) as active.
    els.forEach((btn, i) => btn.classList.toggle('active', i === firstIncomplete));
    bar.hidden = false;
  }

  build();
  refresh();
  window.BlvckAssets.on(refresh);
  // Poll as a fallback (modules write localStorage without always emitting).
  setInterval(refresh, 1500);
})();

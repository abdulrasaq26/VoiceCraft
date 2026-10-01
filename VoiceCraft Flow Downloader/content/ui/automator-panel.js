// content/ui/automator-panel.js
// VoiceCraft Automator panel: paste prompts, queue them, generate them in
// Flow, watch progress. Logic lives in content/automation/automator-engine.js.

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const STATUS = {
    waiting: ['Waiting', 'wait'], submitting: ['Starting…', 'busy'], generating: ['Generating…', 'busy'],
    downloading: ['Downloading…', 'busy'], completed: ['Done', 'ok'], error: ['Failed', 'bad'],
  };

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.panel {
  position: fixed; top: 16px; right: 16px; z-index: 2147483646; width: 392px;
  max-height: calc(100vh - 32px); display: flex; flex-direction: column;
  font: 13px/1.45 "Segoe UI", system-ui, sans-serif; color: var(--vc-text);
  background: var(--vc-surface); border: 1px solid var(--vc-border); border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0,0,0,.55); overflow: hidden;
}
.head { display: flex; align-items: center; gap: 10px; padding: 12px 12px 12px 14px; border-bottom: 1px solid var(--vc-border-soft); cursor: default; }
.logo { width: 24px; height: 24px; border-radius: 6px; display: block; flex: none; }
.title { font-weight: 700; font-size: 14px; flex: 1; }
.pill { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: var(--vc-border-soft); color: var(--vc-text-muted); }
.pill.running { background: rgba(99,102,241,.2); color: var(--vc-primary-text); }
.pill.paused, .pill.pausing { background: rgba(232,182,76,.16); color: var(--vc-accent); }
.ib { width: 28px; height: 28px; border-radius: 7px; border: 0; background: transparent; color: var(--vc-text-muted); cursor: pointer; font-size: 15px; display: grid; place-items: center; }
.ib:hover { background: var(--vc-border-soft); color: #fff; }
.tabs { display: flex; gap: 2px; padding: 8px 10px 0; border-bottom: 1px solid var(--vc-border-soft); }
.tab { border: 0; background: transparent; color: var(--vc-text-muted); padding: 7px 12px; font: inherit; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; }
.tab.on { color: #fff; border-bottom-color: var(--vc-primary); }
.body { overflow-y: auto; padding: 12px 14px 14px; flex: 1; min-height: 0; }
.sec { display: none; } .sec.on { display: block; }
textarea {
  width: 100%; min-height: 108px; resize: vertical; padding: 9px 10px; border-radius: 9px;
  border: 1px solid var(--vc-border); background: var(--vc-background); color: var(--vc-text); font: 12.5px/1.45 "Segoe UI", system-ui, sans-serif; outline: 0;
}
textarea:focus, input:focus, select:focus { border-color: var(--vc-primary); }
.hint { color: var(--vc-text-faint); font-size: 11.5px; margin: 6px 0 0; }
.row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.btn { height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--vc-border); background: var(--vc-surface-elevated); color: var(--vc-text); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.btn:hover:not(:disabled) { border-color: var(--vc-text-faint); }
.btn:disabled { opacity: .45; cursor: default; }
.btn.pri { background: var(--vc-primary); border-color: var(--vc-primary); color: #fff; }
.btn.pri:hover:not(:disabled) { background: var(--vc-primary-hover); }
.btn.bad { color: var(--vc-danger); border-color: rgba(224,108,108,.4); background: transparent; }
.btn.sm { height: 26px; padding: 0 9px; font-size: 11.5px; }
.grow { flex: 1; }
.prog { margin: 14px 0 8px; }
.prog__txt { display: flex; justify-content: space-between; font-size: 12px; color: var(--vc-text-muted); margin-bottom: 5px; }
.bar { height: 6px; border-radius: 3px; background: var(--vc-border-soft); overflow: hidden; display: flex; }
.bar i { display: block; height: 100%; }
.bar .d { background: var(--vc-success); } .bar .f { background: var(--vc-danger); } .bar .a { background: var(--vc-primary); }
.ctl { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 12px; }
.ctl .btn { height: 34px; }
.list { border: 1px solid var(--vc-border-soft); border-radius: 10px; max-height: 330px; overflow-y: auto; }
.empty { padding: 26px 14px; text-align: center; color: var(--vc-text-faint); font-size: 12px; }
.job { display: grid; grid-template-columns: 10px 1fr auto; gap: 9px; padding: 8px 10px; border-bottom: 1px solid var(--vc-border-soft); align-items: start; }
.job:last-child { border-bottom: 0; }
.job.cur { background: rgba(99,102,241,.08); }
.dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; background: #4a4a54; }
.dot.busy { background: var(--vc-primary); box-shadow: 0 0 0 3px rgba(99,102,241,.25); animation: p 1.2s infinite; }
.dot.ok { background: var(--vc-success); } .dot.bad { background: var(--vc-danger); }
@keyframes p { 50% { box-shadow: 0 0 0 6px rgba(99,102,241,0); } }
.jt { min-width: 0; }
.jt__top { display: flex; gap: 6px; align-items: center; font-size: 11.5px; color: var(--vc-text-muted); }
.jt__id { font-family: Consolas, monospace; color: #c7c9ff; }
.tag { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: var(--vc-border-soft); color: var(--vc-text-muted); }
.tag.video { color: var(--vc-accent); }
.jt__p { font-size: 12.5px; color: #e4e4ea; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 2px; }
.jt__err { font-size: 11.5px; color: var(--vc-danger); margin-top: 3px; }
.jt__st { font-size: 11px; color: var(--vc-text-faint); }
.ja { display: flex; gap: 2px; }
.ja .ib { width: 24px; height: 24px; font-size: 13px; }
.foot { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.f { display: grid; grid-template-columns: 1fr 140px; gap: 10px; align-items: center; padding: 9px 0; border-bottom: 1px solid var(--vc-border-soft); }
.f:last-child { border-bottom: 0; }
.f__l { font-weight: 600; font-size: 12.5px; }
.f__d { color: var(--vc-text-faint); font-size: 11.5px; font-weight: 400; margin-top: 1px; }
.f input, .f select { width: 100%; height: 30px; padding: 0 8px; border-radius: 7px; border: 1px solid var(--vc-border); background: var(--vc-background); color: var(--vc-text); font: inherit; font-size: 12.5px; outline: 0; }
.seg { display: grid; grid-auto-flow: column; gap: 0; border: 1px solid var(--vc-border); border-radius: 7px; overflow: hidden; }
.seg button { border: 0; background: var(--vc-background); color: var(--vc-text-muted); height: 28px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.seg button.on { background: var(--vc-primary); color: #fff; }
.grp { margin: 14px 0 2px; font-size: 10.5px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--vc-text-faint); }
.note { margin-top: 12px; padding: 10px 11px; border-radius: 9px; background: rgba(99,102,241,.08); border: 1px solid rgba(99,102,241,.25); color: #c7c9ff; font-size: 12px; }
.path { font-family: Consolas, monospace; font-size: 11px; color: var(--vc-text-muted); word-break: break-all; margin-top: 6px; }
.log { font-size: 12px; }
.log div { padding: 6px 0; border-bottom: 1px solid var(--vc-border-soft); color: #c4c4cc; }
.log time { font-family: Consolas, monospace; font-size: 11px; color: var(--vc-text-faint); margin-right: 8px; }
.min .tabs, .min .body { display: none; }
.proj { margin-bottom: 10px; padding: 8px 10px; border-radius: 8px; font-size: 12px; background: rgba(99,102,241,.1); border: 1px solid rgba(99,102,241,.3); color: #c7c9ff; }
.proj b { color: #fff; }
.proj.none { background: rgba(232,182,76,.08); border-color: rgba(232,182,76,.35); color: var(--vc-accent); }
.thumbs { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 6px; }
.th { width: 64px; height: 64px; border-radius: 7px; overflow: hidden; background: var(--vc-background); border: 1px solid var(--vc-border); cursor: zoom-in; position: relative; padding: 0; }
.th img { width: 100%; height: 100%; object-fit: cover; display: block; }
.th.pending { cursor: default; display: grid; place-items: center; }
.th .vid { position: absolute; right: 3px; bottom: 3px; font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 3px; background: rgba(0,0,0,.7); color: #fff; }
.spin { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--vc-border); border-top-color: #8b8ef8; animation: sp .8s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
.refs { margin-top: 12px; border: 1px solid var(--vc-border-soft); border-radius: 10px; }
.refs > summary { list-style: none; cursor: pointer; padding: 9px 11px; display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 12.5px; }
.refs > summary::-webkit-details-marker { display: none; }
.refs > summary::before { content: "▸"; color: var(--vc-text-faint); transition: transform .12s; }
.refs[open] > summary::before { transform: rotate(90deg); }
.refs__n { font-size: 11px; color: var(--vc-text-muted); font-weight: 400; }
.refs__body { padding: 0 11px 11px; }
.refgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; max-height: 236px; overflow-y: auto; margin-top: 8px; }
.ref { position: relative; aspect-ratio: 1; border-radius: 7px; overflow: hidden; border: 2px solid transparent; background: var(--vc-background); cursor: pointer; padding: 0; }
.ref img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ref.on { border-color: var(--vc-primary); }
.ref.on::after { content: "✓"; position: absolute; top: 3px; right: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--vc-primary); color: #fff; font-size: 10px; display: grid; place-items: center; font-weight: 700; }
.ref__h { position: absolute; left: 0; right: 0; bottom: 0; font-size: 9.5px; padding: 2px 4px; background: rgba(0,0,0,.72); color: #e4e4ea; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; }
.lb { position: absolute; inset: 0; z-index: 5; background: var(--vc-background); display: none; flex-direction: column; }
.lb.on { display: flex; }
.lb__bar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--vc-border-soft); }
.lb__t { flex: 1; font-weight: 700; font-family: Consolas, monospace; color: #c7c9ff; }
.lb__view { flex: 1; min-height: 0; display: grid; place-items: center; padding: 12px; }
.lb__view img, .lb__view video { max-width: 100%; max-height: 100%; border-radius: 8px; }
.lb__nav { display: flex; justify-content: space-between; padding: 0 12px 12px; }
.panel { position: fixed; }
`;

  class AutomatorPanel {
    constructor(engine) {
      this.engine = engine;
      this.isVisible = false;
      this.tab = 'queue';
      this.container = document.createElement('div');
      this.container.id = 'fmd-automator-host';
      this.container.style.display = 'none';
      this.shadow = this.container.attachShadow({ mode: 'open' });
      this.shadow.innerHTML = `<style>${window.VC_THEME_CSS || ''}${CSS}</style>
<div class="panel" id="panel">
  <div class="head">
    <img class="logo" src="${chrome.runtime.getURL('icons/frameloom-mark.svg')}" alt="">
    <span class="title">Flow Automator</span>
    <span class="pill" id="state">Idle</span>
    <button class="ib" id="min" title="Minimize">–</button>
    <button class="ib" id="close" title="Close">✕</button>
  </div>
  <div class="tabs">
    <button class="tab on" data-tab="queue">Queue</button>
    <button class="tab" data-tab="settings">Settings</button>
    <button class="tab" data-tab="log">Activity</button>
  </div>
  <div class="body">
    <div class="sec on" data-sec="queue">
      <div class="proj" id="proj" hidden></div>
      <textarea id="input" spellcheck="false" placeholder="Paste prompts — one per line, or separate multi-line prompts with a blank line.&#10;&#10;#00-00 names a prompt (files save as 00-00). [VIDEO] makes it a video. @name uses a picture from the project as a reference."></textarea>
      <div class="row" style="margin-top:8px">
        <button class="btn sm" id="import">Import .txt</button>
        <input type="file" id="file" accept=".txt,text/plain" hidden>
        <span class="hint grow" id="detected" style="margin:0"></span>
        <button class="btn sm pri" id="add">Add to queue</button>
      </div>
      <details class="refs" id="refs">
        <summary>References <span class="refs__n" id="refsN"></span></summary>
        <div class="refs__body">
          <div class="hint" style="margin:0">Pictures from this Flow project. Write <b>@name</b> in a prompt to use a specific one; ticked pictures are used for prompts without an @.</div>
          <div class="row" style="margin-top:8px">
            <button class="btn sm" id="refUpload">Upload…</button>
            <input type="file" id="refFile" accept="image/*" multiple hidden>
            <button class="btn sm" id="refReload">Refresh</button>
            <span class="grow"></span>
            <button class="btn sm" id="refClear">Untick all</button>
          </div>
          <div class="refgrid" id="refGrid"></div>
          <div class="hint" id="refMsg"></div>
        </div>
      </details>
      <div class="prog">
        <div class="prog__txt"><span id="progtxt">Queue is empty</span><span id="progpct"></span></div>
        <div class="bar" id="bar"></div>
      </div>
      <div class="ctl">
        <button class="btn pri" id="start">Start</button>
        <button class="btn" id="pause">Pause</button>
        <button class="btn bad" id="stop">Stop</button>
      </div>
      <div class="list" id="list"></div>
      <div class="foot">
        <button class="btn sm" id="retryFailed">Retry failed</button>
        <button class="btn sm" id="copyFailed">Copy failed prompts</button>
        <button class="btn sm" id="clearDone">Clear done</button>
        <button class="btn sm pri" id="sendAll" hidden>Send all to AutoEditor</button>
        <span class="grow"></span>
        <button class="btn sm bad" id="clearAll">Clear all</button>
      </div>
    </div>
    <div class="sec" data-sec="settings">
      <div class="f"><div><div class="f__l">Default type</div><div class="f__d">For prompts without [IMAGE] / [VIDEO]</div></div>
        <div class="seg" id="mode"><button data-v="image">Image</button><button data-v="video">Video</button></div></div>
      <div class="f"><div><div class="f__l">Outputs per prompt</div><div class="f__d">Each output uses your Flow credits</div></div>
        <select data-k="expected"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></div>
      <div class="grp">Images</div>
      <div class="f"><div><div class="f__l">Model</div></div>
        <select data-k="model"><option value="nano-banana-2">Nano Banana 2</option><option value="nano-banana-pro">Nano Banana Pro</option><option value="nano-banana-lite">Nano Banana Lite</option></select></div>
      <div class="f"><div><div class="f__l">Aspect ratio</div></div>
        <select data-k="aspect"><option value="16:9">16:9 landscape</option><option value="4:3">4:3</option><option value="1:1">1:1 square</option><option value="3:4">3:4</option><option value="9:16">9:16 portrait</option></select></div>
      <div class="grp">Videos (Veo 3.1, 8s)</div>
      <div class="f"><div><div class="f__l">Quality</div></div>
        <select data-k="videoQuality"><option value="lite">Lite</option><option value="fast">Fast</option><option value="quality">Quality</option></select></div>
      <div class="f"><div><div class="f__l">Aspect ratio</div></div>
        <select data-k="videoRatio"><option value="16:9">16:9 landscape</option><option value="9:16">9:16 portrait</option></select></div>
      <div class="f"><div><div class="f__l">@pictures in video prompts</div><div class="f__d">New Flow only — "@00-01 the pear rolls off the table" animates picture 00-01</div></div>
        <select data-k="videoRefs"><option value="start">Start frame (first @)</option><option value="startEnd">Start + end frame (first two @)</option><option value="ingredients">Ingredients (all @)</option></select></div>
      <div class="f"><div><div class="f__l">Video time limit</div><div class="f__d">Seconds to wait for each video</div></div><input type="number" min="60" max="3600" step="30" data-k="videoTimeout"></div>
      <div class="grp">Run</div>
      <div class="f"><div><div class="f__l">Pause between prompts</div><div class="f__d">Seconds — raise it if Google rate-limits you</div></div><input type="number" min="0" max="600" step="1" data-k="delay"></div>
      <div class="f"><div><div class="f__l">Retries</div><div class="f__d">Extra attempts for a prompt that fails</div></div>
        <select data-k="retries"><option value="0">None</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></div>
      <div class="f"><div><div class="f__l">Download results</div><div class="f__d">Save each prompt's results automatically</div></div>
        <select data-k="autoDownload"><option value="true">On</option><option value="false">Off</option></select></div>
      <div class="f"><div><div class="f__l">Name pictures in Flow</div><div class="f__d">#00-00 prompts are named 00-00 in Flow, so later prompts can use @00-00</div></div>
        <select data-k="renameInFlow"><option value="true">On</option><option value="false">Off</option></select></div>
      <div class="f"><div><div class="f__l">Project folder</div></div><input type="text" data-k="project" maxlength="80"></div>
      <div class="f"><div><div class="f__l">Batch folder</div></div><input type="text" data-k="batch" maxlength="80"></div>
      <div class="path" id="path"></div>
      <div class="note">Open a Flow project and stay signed in. Results are added to the project on screen and use your Flow credits, like pressing Generate yourself. Daily limits and blocks from Google pause the queue.</div>
    </div>
    <div class="sec" data-sec="log"><div class="log" id="log"></div></div>
  </div>
  <div class="lb" id="lb">
    <div class="lb__bar"><span class="lb__t" id="lbT"></span><a class="btn sm" id="lbOpen" target="_blank" rel="noopener">Open full size</a><button class="ib" id="lbClose" title="Close">✕</button></div>
    <div class="lb__view" id="lbView"></div>
    <div class="lb__nav"><button class="btn sm" id="lbPrev">‹ Previous</button><button class="btn sm" id="lbNext">Next ›</button></div>
  </div>
</div>`;

      this.$ = (id) => this.shadow.getElementById(id);
      this.bind();
      document.body.appendChild(this.container);
      if (window.FloatingPanelManager) {
        window.FloatingPanelManager.register('automator', {
          el: this.$('panel'),
          handle: this.shadow.querySelector('.head'),
          isOpen: () => this.isVisible,
        });
      }
      engine.onChange(() => { this.syncSettings(); this.render(); });
      engine.loaded.then(() => { this.syncSettings(); this.render(); });
    }

    bind() {
      const e = this.engine;
      this.$('close').addEventListener('click', () => this.hide());
      this.$('min').addEventListener('click', () => this.$('panel').classList.toggle('min'));
      this.shadow.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
        this.tab = t.dataset.tab;
        this.shadow.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
        this.shadow.querySelectorAll('.sec').forEach((s) => s.classList.toggle('on', s.dataset.sec === this.tab));
      }));
      const input = this.$('input');
      // Keep Flow's own keyboard shortcuts from firing while typing here.
      for (const ev of ['keydown', 'keyup', 'keypress']) this.container.addEventListener(ev, (x) => x.stopPropagation());
      const countDetected = () => {
        const n = window.VCParsePrompts(input.value, e.settings.mode, 1).length;
        this.$('detected').textContent = input.value.trim() ? `${n} prompt${n === 1 ? '' : 's'} detected` : '';
        this.$('add').disabled = !n;
      };
      input.addEventListener('input', countDetected);
      countDetected();
      this.$('add').addEventListener('click', () => {
        const n = e.addPrompts(input.value);
        if (n) { input.value = ''; countDetected(); }
      });
      this.$('import').addEventListener('click', () => this.$('file').click());
      this.$('file').addEventListener('change', async (x) => {
        const f = x.target.files && x.target.files[0];
        x.target.value = '';
        if (!f) return;
        input.value = (input.value.trim() ? input.value.trim() + '\n\n' : '') + (await f.text());
        countDetected();
      });
      this.$('start').addEventListener('click', () => e.start());
      this.$('pause').addEventListener('click', () => e.pause());
      this.$('stop').addEventListener('click', () => e.stop());
      this.$('retryFailed').addEventListener('click', () => e.retryFailed());
      this.$('clearDone').addEventListener('click', () => e.clearDone());
      this.$('sendAll').addEventListener('click', () => { if (e.sendToEditor(null)) this.flash('sendAll', 'Sent ✓'); });
      this.$('clearAll').addEventListener('click', () => { if (confirm('Remove every prompt from the queue?')) e.clearAll(); });
      this.$('copyFailed').addEventListener('click', async () => {
        const t = e.failedPromptsText();
        if (!t) return;
        try { await navigator.clipboard.writeText(t); this.flash('copyFailed', 'Copied'); } catch (_) { input.value = t; countDetected(); }
      });
      this.$('refs').addEventListener('toggle', () => { if (this.$('refs').open && !e.libraryInfo) this.reloadRefs(); });
      this.$('refReload').addEventListener('click', () => this.reloadRefs());
      this.$('refUpload').addEventListener('click', () => this.$('refFile').click());
      this.$('refFile').addEventListener('change', async (x) => {
        const files = [...(x.target.files || [])];
        x.target.value = '';
        if (!files.length) return;
        this.$('refMsg').textContent = `Uploading ${files.length} picture${files.length === 1 ? '' : 's'}…`;
        const n = await e.uploadRefs(files);
        this.$('refMsg').textContent = n === files.length ? '' : `${files.length - n} upload${files.length - n === 1 ? '' : 's'} failed — see Activity.`;
      });
      this.$('refClear').addEventListener('click', () => e.setSettings({ refs: [] }));
      this.$('refGrid').addEventListener('click', (x) => {
        const b = x.target.closest('[data-mid]');
        if (b) e.toggleRef(b.dataset.mid, b.dataset.h || null);
      });
      this.$('lbClose').addEventListener('click', () => this.$('lb').classList.remove('on'));
      this.$('lbPrev').addEventListener('click', () => this.openPreview(this.lbJob, this.lbIndex - 1));
      this.$('lbNext').addEventListener('click', () => this.openPreview(this.lbJob, this.lbIndex + 1));
      this.$('list').addEventListener('click', (x) => {
        const th = x.target.closest('[data-prev]');
        if (th) { const [jid, i] = th.dataset.prev.split('|'); this.openPreview(jid, +i); return; }
        const b = x.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'retry') e.retry(b.dataset.id);
        if (b.dataset.act === 'remove') e.remove(b.dataset.id);
        if (b.dataset.act === 'send') { e.sendToEditor([b.dataset.id]); this.flashEl(b, '✓'); }
      });
      this.$('mode').addEventListener('click', (x) => {
        const b = x.target.closest('button[data-v]');
        if (b) { e.setSettings({ mode: b.dataset.v }); this.syncSettings(); countDetected(); }
      });
      this.shadow.querySelectorAll('[data-k]').forEach((el) => el.addEventListener('change', () => {
        const k = el.dataset.k;
        let v = el.value;
        if (k === 'autoDownload' || k === 'renameInFlow') v = v === 'true';
        else if (['expected', 'delay', 'videoTimeout', 'retries'].includes(k)) v = Math.max(0, +v || 0);
        else if (k === 'project' || k === 'batch') v = v.trim() || (k === 'project' ? 'Flow Automator' : 'Batch 01');
        e.setSettings({ [k]: v });
        this.syncSettings();
      }));
    }

    thumbsHtml(j, isCur) {
      const outs = j.outputs || [];
      const want = Math.max(1, +this.engine.settings.expected || 1);
      const pending = isCur && ['submitting', 'generating'].includes(j.status) ? Math.max(0, want - outs.length) : 0;
      if (!outs.length && !pending) return '';
      const items = outs.map((o, i) => `<button class="th" data-prev="${esc(j.id)}|${i}" title="Preview">
          <img src="${esc(o.thumb || o.url)}" alt="" loading="lazy" onerror="this.style.opacity=0">${o.type === 'video' ? '<span class="vid">VIDEO</span>' : ''}</button>`);
      for (let i = 0; i < pending; i++) items.push('<span class="th pending"><span class="spin"></span></span>');
      return `<div class="thumbs">${items.join('')}</div>`;
    }

    openPreview(jobId, index) {
      const j = this.engine.jobs.find((x) => x.id === jobId);
      const outs = (j && j.outputs) || [];
      if (!outs.length) return;
      const i = (index + outs.length) % outs.length;
      const o = outs[i];
      this.lbJob = jobId; this.lbIndex = i;
      this.$('lbT').textContent = `${j.id}${outs.length > 1 ? `  (${i + 1}/${outs.length})` : ''}`;
      this.$('lbOpen').href = o.url;
      this.$('lbView').innerHTML = o.type === 'video'
        ? `<video src="${esc(o.url)}" controls autoplay loop playsinline></video>`
        : `<img src="${esc(o.url)}" alt="">`;
      this.$('lbPrev').disabled = this.$('lbNext').disabled = outs.length < 2;
      this.$('lb').classList.add('on');
    }

    async reloadRefs() {
      this.$('refMsg').textContent = 'Loading pictures from this Flow project…';
      try {
        await this.engine.loadLibrary();
        this.$('refMsg').textContent = '';
      } catch (err) {
        this.$('refMsg').textContent = err.message;
      }
      this.renderRefs();
    }

    renderRefs() {
      const e = this.engine;
      const sel = new Set((e.settings.refs || []).map((r) => r.mediaId));
      this.$('refsN').textContent = sel.size ? `${sel.size} ticked` : '';
      const lib = e.libraryInfo;
      if (!lib) { if (!this.$('refGrid').children.length) this.$('refGrid').innerHTML = ''; return; }
      const pics = lib.pictures.slice(0, 120);
      this.$('refGrid').innerHTML = pics.length
        ? pics.map((pic) => `<button class="ref${sel.has(pic.mediaId) ? ' on' : ''}" data-mid="${esc(pic.mediaId)}" data-h="${esc(pic.handle || '')}" title="${esc(pic.handle ? '@' + pic.handle : (pic.uploaded ? 'Uploaded picture' : 'Generated picture'))}">
            <img src="${esc(e.api.thumbUrl(pic.mediaId))}" alt="" loading="lazy">${pic.handle ? `<span class="ref__h">@${esc(pic.handle)}</span>` : ''}</button>`).join('')
        : '<div class="hint" style="grid-column:1/-1">No pictures in this project yet — upload some.</div>';
    }

    flashEl(el, text) {
      const old = el.textContent; el.textContent = text; setTimeout(() => { el.textContent = old; }, 1200);
    }

    flash(id, text) {
      const b = this.$(id); const old = b.textContent;
      b.textContent = text; setTimeout(() => { b.textContent = old; }, 1200);
    }

    syncSettings() {
      const s = this.engine.settings;
      this.shadow.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.mode));
      this.shadow.querySelectorAll('[data-k]').forEach((el) => {
        if (this.shadow.activeElement === el) return;
        el.value = String(s[el.dataset.k]);
      });
      this.$('path').textContent = `Saves to: Downloads/Flow Media Downloader/${s.project}/${s.batch}/#001${s.expected > 1 ? '_1' : ''}.png`;
    }

    render() {
      const e = this.engine;
      const st = e.state;
      const pill = this.$('state');
      pill.className = 'pill ' + st;
      pill.textContent = { idle: 'Idle', running: 'Running', pausing: 'Pausing…', paused: 'Paused' }[st];

      const c = e.counts();
      const pct = c.total ? Math.round(((c.done + c.failed) / c.total) * 100) : 0;
      this.$('progtxt').textContent = c.total
        ? `${c.done} of ${c.total} done${c.failed ? ` · ${c.failed} failed` : ''}${c.waiting ? ` · ${c.waiting} waiting` : ''}`
        : 'Queue is empty';
      this.$('progpct').textContent = c.total ? `${pct}%` : '';
      const w = (n) => (c.total ? (n / c.total) * 100 : 0);
      this.$('bar').innerHTML = `<i class="d" style="width:${w(c.done)}%"></i><i class="f" style="width:${w(c.failed)}%"></i><i class="a" style="width:${w(c.active)}%"></i>`;

      const running = st === 'running' || st === 'pausing';
      this.$('start').textContent = st === 'paused' ? 'Resume' : 'Start';
      this.$('start').disabled = st === 'running' || !c.waiting;
      this.$('pause').disabled = st !== 'running';
      this.$('stop').disabled = st === 'idle';
      this.$('retryFailed').disabled = !c.failed;
      this.$('copyFailed').disabled = !c.failed;
      this.$('clearDone').disabled = !c.done;
      this.$('clearAll').disabled = !c.total;

      const list = this.$('list');
      if (!e.jobs.length) {
        list.innerHTML = '<div class="empty">Add prompts above, then press Start.</div>';
      } else {
        list.innerHTML = e.jobs.map((j) => {
          const [label, cls] = STATUS[j.status] || STATUS.waiting;
          const isCur = e.current === j;
          const extra = j.detail && (j.status === 'generating' || j.status === 'submitting') ? ` · ${j.detail}` : '';
          return `<div class="job${isCur ? ' cur' : ''}">
            <span class="dot ${cls}"></span>
            <div class="jt">
              <div class="jt__top"><span class="jt__id">${esc(j.id)}</span><span class="tag ${j.type}">${j.type.toUpperCase()}</span><span class="jt__st">${esc(label + extra)}</span></div>
              <div class="jt__p" title="${esc(j.prompt)}">${esc(j.prompt)}</div>
              ${j.error ? `<div class="jt__err">${esc(j.error)}</div>` : ''}
              ${this.thumbsHtml(j, isCur)}
            </div>
            <div class="ja">
              ${j.status === 'error' ? `<button class="ib" data-act="retry" data-id="${esc(j.id)}" title="Retry">↻</button>` : ''}
              ${e.inStudio && e.studioProject && (j.outputs || []).some((o) => o.name) && j.status === 'completed' ? `<button class="ib" data-act="send" data-id="${esc(j.id)}" title="Send to AutoEditor">⇥</button>` : ''}
              ${!isCur ? `<button class="ib" data-act="remove" data-id="${esc(j.id)}" title="Remove">✕</button>` : ''}
            </div>
          </div>`;
        }).join('');
        const cur = list.querySelector('.job.cur');
        if (cur && running) cur.scrollIntoView({ block: 'nearest' });
      }

      this.renderRefs();
      const proj = this.$('proj');
      proj.hidden = !e.inStudio;
      if (e.inStudio) {
        proj.className = 'proj' + (e.studioProject ? '' : ' none');
        proj.innerHTML = e.studioProject
          ? `Results are added to project <b>${esc(e.studioProject.name)}</b>`
          : 'No project selected — pick one in the studio bar to collect results for the AutoEditor.';
      }
      this.$('sendAll').hidden = !(e.inStudio && e.studioProject && e.jobs.some((j) => (j.outputs || []).length));
      this.$('log').innerHTML = e.log.length
        ? e.log.map((l) => `<div><time>${new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>${esc(l.msg)}</div>`).join('')
        : '<div class="empty">Nothing yet.</div>';
    }

    show() {
      this.isVisible = true;
      this.container.style.display = 'flex';
      this.render();
      if (window.FloatingPanelManager) window.FloatingPanelManager.restorePosition('automator');
    }
    hide() { this.isVisible = false; this.container.style.display = 'none'; }
    toggle() { if (this.isVisible) this.hide(); else this.show(); }
  }

  window.AutomatorPanel = AutomatorPanel;
})();

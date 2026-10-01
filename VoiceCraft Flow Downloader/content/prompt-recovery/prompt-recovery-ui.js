// content/prompt-recovery/prompt-recovery-ui.js
//
// Prompt Recovery: paste the original prompt list, scan the Flow project,
// see which prompts never produced a result, and copy those back out.
// A second tab builds reference-ready prompts (@name) for Flow.
// Lives in a shadow root so Flow's page styles can't reach it.

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CSS = `
:host {
  all: initial;
  --vc-background: #0d0d0f; --vc-surface: #161619; --vc-surface-elevated: #202026;
  --vc-border: #2c2c33; --vc-border-soft: #232329;
  --vc-primary: #6366f1; --vc-primary-hover: #5558e8; --vc-primary-text: #c7c9ff;
  --vc-accent: #e8b64c; --vc-text: #f2f2f4; --vc-text-muted: #9b9ba3; --vc-text-faint: #62626c;
  --vc-success: #6cc98f; --vc-danger: #e06c6c;
  --vc-font: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
  --vc-mono: ui-monospace, "Cascadia Mono", Consolas, monospace;
}
* { box-sizing: border-box; }
.panel {
  position: fixed; top: 5vh; left: 50%; transform: translateX(-50%);
  width: 480px; max-width: calc(100vw - 24px); max-height: 90vh;
  display: none; flex-direction: column;
  background: var(--vc-surface); color: var(--vc-text);
  border: 1px solid var(--vc-border); border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0,0,0,.55);
  font: 13px/1.45 var(--vc-font);
  z-index: 2147483645; overflow: hidden;
}
.head { display: flex; align-items: center; gap: 10px; padding: 11px 10px 11px 14px; border-bottom: 1px solid var(--vc-border-soft); }
.logo { width: 24px; height: 24px; flex: none; border-radius: 7px; display: grid; place-items: center; font-weight: 800; font-size: 12px; color: #fff; background: linear-gradient(135deg,#6366f1,#8b5cf6); }
.title { flex: 1; font-weight: 700; font-size: 14px; }
.title small { display: block; font-weight: 500; font-size: 11px; color: var(--vc-text-faint); }
.ib { width: 28px; height: 28px; border: 0; border-radius: 7px; background: transparent; color: var(--vc-text-muted); cursor: pointer; font-size: 15px; display: grid; place-items: center; }
.ib:hover { background: var(--vc-surface-elevated); color: #fff; }
.tabs { display: flex; gap: 2px; padding: 8px 10px 0; border-bottom: 1px solid var(--vc-border-soft); }
.tab { border: 0; background: transparent; color: var(--vc-text-muted); padding: 7px 12px; font: inherit; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; }
.tab:hover { color: var(--vc-text); }
.tab.on { color: #fff; border-bottom-color: var(--vc-primary); }
.view { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; flex: 1; min-height: 0; }
.view::-webkit-scrollbar, .list::-webkit-scrollbar { width: 6px; }
.view::-webkit-scrollbar-thumb, .list::-webkit-scrollbar-thumb { background: var(--vc-border); border-radius: 4px; }
.card { background: var(--vc-background); border: 1px solid var(--vc-border-soft); border-radius: 10px; padding: 12px; }
.step { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.step__n { width: 18px; height: 18px; flex: none; border-radius: 50%; display: grid; place-items: center; font-size: 10px; font-weight: 800; background: var(--vc-surface-elevated); color: var(--vc-text-muted); }
.step__l { flex: 1; font-size: 12px; font-weight: 700; }
.hint { font-size: 11.5px; color: var(--vc-text-faint); margin: 0 0 8px; }
textarea {
  width: 100%; min-height: 84px; resize: vertical; padding: 9px 10px; border-radius: 8px;
  border: 1px solid var(--vc-border); background: var(--vc-surface); color: var(--vc-text);
  font: 12px/1.45 var(--vc-mono); outline: 0;
}
textarea:focus { border-color: var(--vc-primary); }
.row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.grow { flex: 1; }
.btn { height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--vc-border); background: var(--vc-surface-elevated); color: var(--vc-text); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.btn:hover:not(:disabled) { border-color: var(--vc-text-faint); }
.btn:disabled { opacity: .45; cursor: default; }
.btn.pri { background: var(--vc-primary); border-color: var(--vc-primary); color: #fff; }
.btn.pri:hover:not(:disabled) { background: var(--vc-primary-hover); }
.btn.bad { color: var(--vc-danger); border-color: rgba(224,108,108,.4); background: transparent; }
.btn.sm { height: 26px; padding: 0 9px; font-size: 11.5px; }
.btn.block { width: 100%; height: 34px; margin-top: 8px; }
.link { border: 0; background: none; padding: 0; color: var(--vc-text-muted); font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; }
.link:hover { color: var(--vc-text); }
.ok { color: var(--vc-success); font-size: 11.5px; font-weight: 600; }
.warn { color: var(--vc-danger); font-size: 11.5px; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 10px; }
.stat { background: var(--vc-surface); border: 1px solid var(--vc-border-soft); border-radius: 8px; padding: 8px; text-align: center; }
.stat b { display: block; font-size: 19px; line-height: 1.2; }
.stat span { font-size: 10.5px; color: var(--vc-text-faint); font-weight: 600; text-transform: uppercase; letter-spacing: .4px; }
.stat.gen b { color: var(--vc-success); } .stat.mis b { color: var(--vc-danger); }
.bar { height: 5px; border-radius: 3px; background: var(--vc-surface-elevated); overflow: hidden; margin-bottom: 10px; }
.bar i { display: block; height: 100%; width: 0; background: var(--vc-success); transition: width .3s; }
.crawl { font-size: 11.5px; color: var(--vc-primary-text); margin-bottom: 8px; }
.list { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto; }
.miss { display: grid; grid-template-columns: auto auto 1fr auto; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 7px; background: var(--vc-surface); border: 1px solid var(--vc-border-soft); border-left: 3px solid var(--vc-danger); }
.miss input { accent-color: var(--vc-primary); margin: 0; }
.miss__id { font: 700 12px var(--vc-mono); }
.miss__p { font-size: 11.5px; color: var(--vc-text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; max-height: 110px; overflow-y: auto; }
.chip { font: 600 11px var(--vc-mono); padding: 2px 7px; border-radius: 5px; background: rgba(108,201,143,.1); border: 1px solid rgba(108,201,143,.3); color: var(--vc-success); }
.sec-h { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 12px; font-weight: 700; }
.sec-h .n { font-weight: 600; color: var(--vc-text-faint); }
.result { border: 1px solid rgba(108,201,143,.4); background: rgba(108,201,143,.05); }
.result__top { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.k { font-size: 10.5px; color: var(--vc-text-faint); font-weight: 600; text-transform: uppercase; letter-spacing: .4px; }
.v { font-size: 15px; font-weight: 700; color: var(--vc-success); }
.v.conf { color: var(--vc-accent); text-align: right; }
.body { background: var(--vc-surface); border: 1px solid var(--vc-border-soft); border-radius: 7px; padding: 9px 10px; font: 12px/1.45 var(--vc-mono); color: var(--vc-text-muted); max-height: 140px; overflow-y: auto; white-space: pre-wrap; margin: 4px 0 8px; }
.mono { font: 11.5px/1.6 var(--vc-mono); color: var(--vc-text-muted); }
.batch { background: var(--vc-background); border: 1px solid var(--vc-border-soft); border-radius: 8px; padding: 9px 10px; }
.batch__top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.batch__id { font: 700 12px var(--vc-mono); color: var(--vc-success); }
.batch__id.refs { color: var(--vc-primary-text); }
.batch__refs { flex: 1; font-size: 11px; color: var(--vc-text-faint); }
.batch .row .btn { flex: 1; }
[hidden] { display: none !important; }
`;

  class PromptRecoveryUI {
    constructor() {
      this.reconciler = new window.GenerationReconciler();
      this.selectedMissing = new Set();
      this.createDOM();
      this.attachEvents();
    }

    $(id) { return this.container.querySelector('#' + id); }

    createDOM() {
      this.host = document.createElement('div');
      this.host.id = 'fmd-prompt-recovery-host';
      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.shadow.innerHTML = `<style>${CSS}</style>
<div class="panel" id="fmd-prompt-recovery">
  <div class="head" id="fpr-header">
    <span class="logo">V</span>
    <div class="title">Prompt Recovery<small>Find prompts that never made it into the project</small></div>
    <button class="btn sm bad" id="fpr-clear-all" title="Clear everything in this panel">Clear all</button>
    <button class="ib" id="fpr-close" title="Close">✕</button>
  </div>
  <div class="tabs">
    <button class="tab on" id="fpr-tab-recovery">Missing prompts</button>
    <button class="tab" id="fpr-tab-builder">Reference builder</button>
  </div>

  <div class="view" id="fpr-view-recovery">
    <div class="card">
      <div class="step"><span class="step__n">1</span><span class="step__l">Paste your original prompts</span><button class="link" id="fpr-clear-lib">Clear</button></div>
      <textarea id="fpr-library" spellcheck="false" placeholder="All the prompts you sent to Flow, each named:&#10;&#10;#0-21 A medieval scribe…&#10;#0-22 Nero holding an emerald…"></textarea>
      <div class="row" style="margin-top:8px">
        <span class="ok grow" id="fpr-library-status" hidden></span>
        <button class="btn pri" id="fpr-analyze-btn" hidden>Compare with Flow</button>
      </div>
    </div>

    <div class="card" id="fpr-dashboard" hidden>
      <div class="step"><span class="step__n">2</span><span class="step__l">Scan the Flow project</span></div>
      <div class="stats">
        <div class="stat"><b id="fpr-stat-exp">0</b><span>Expected</span></div>
        <div class="stat gen"><b id="fpr-stat-gen">0</b><span>Generated</span></div>
        <div class="stat mis"><b id="fpr-stat-mis">0</b><span>Missing</span></div>
      </div>
      <div class="bar"><i id="fpr-stat-bar"></i></div>
      <div class="crawl" id="fpr-crawler-status" hidden><span id="fpr-crawler-state-text">Crawler idle</span> · <span id="fpr-crawler-stats-text">Waiting…</span></div>
      <div class="row">
        <button class="btn grow" id="fpr-scan-flow" title="Scroll through the whole project so every result is counted">Scan whole project</button>
        <button class="btn bad" id="fpr-stop-crawl" hidden>Stop</button>
      </div>
    </div>

    <div class="card" id="fpr-missing-section" hidden>
      <div class="sec-h">
        <span class="step__n">3</span><span>Missing</span><span class="n" id="fpr-missing-n"></span>
        <span class="grow"></span>
        <button class="link" id="fpr-select-missing">Select all</button>
      </div>
      <div class="list" id="fpr-missing-list"></div>
      <div class="row" style="margin-top:8px">
        <button class="btn pri grow" id="fpr-recover-selected" disabled>Recover selected</button>
        <button class="btn" id="fpr-recover-all-missing">Recover all</button>
      </div>
    </div>

    <div class="card result" id="fpr-results" hidden>
      <div class="result__top">
        <div><div class="k">Original ID</div><div class="v" id="fpr-res-id">…</div></div>
        <div id="fpr-res-conf-box"><div class="k">Confidence</div><div class="v conf" id="fpr-res-conf">…</div></div>
      </div>
      <div class="k">Original prompt</div>
      <div class="body" id="fpr-res-body">…</div>
      <div class="warn" id="fpr-res-warnings" hidden></div>
      <div class="row">
        <button class="btn pri grow" id="fpr-copy-clean">Copy recovered prompts</button>
        <button class="btn" id="fpr-close-recovery">Close</button>
      </div>
    </div>

    <div class="card" id="fpr-generated-section" hidden>
      <div class="sec-h"><span>Generated</span><span class="n" id="fpr-generated-n"></span></div>
      <div class="chips" id="fpr-generated-list"></div>
    </div>

    <div class="card">
      <div class="step"><span class="step__l">Identify a failed prompt</span><button class="link" id="fpr-clear-failed">Clear</button></div>
      <p class="hint">Paste the text of prompts Flow rejected (one per line) to find their names in your list.</p>
      <textarea id="fpr-failed" spellcheck="false" placeholder="Paste failed prompt text…" style="min-height:60px"></textarea>
      <button class="btn block" id="fpr-find">Find in my prompts</button>
    </div>
  </div>

  <div class="view" id="fpr-view-builder" hidden>
    <div class="card">
      <div class="step"><span class="step__n">1</span><span class="step__l">Reference library</span></div>
      <p class="hint">The prompts that made your reference pictures, each named with #name.</p>
      <textarea id="fpr-ref-input" spellcheck="false" placeholder="#james&#10;A consistent character reference of…&#10;&#10;#sarah&#10;…"></textarea>
      <button class="btn block" id="fpr-ref-analyze">Read references</button>
      <div id="fpr-ref-results" hidden style="margin-top:10px">
        <div class="ok" id="fpr-ref-count"></div>
        <div class="mono" id="fpr-ref-list"></div>
      </div>
    </div>
    <div class="card">
      <div class="step"><span class="step__n">2</span><span class="step__l">Image prompts</span></div>
      <p class="hint">Prompts that use @references, e.g. “#0-01 A cinematic shot of @james…”.</p>
      <textarea id="fpr-img-input" spellcheck="false" placeholder="#0-01 A cinematic shot of @james…"></textarea>
      <button class="btn block" id="fpr-img-analyze">Read image prompts</button>
      <div id="fpr-img-results" hidden style="margin-top:10px">
        <div class="mono" id="fpr-img-summary"></div>
        <div class="warn" id="fpr-img-warnings" hidden></div>
        <button class="btn pri block" id="fpr-img-build-all">Build prompts</button>
      </div>
    </div>
    <div id="fpr-batch-viewer" hidden>
      <div class="sec-h"><span>Reference-ready prompts</span><span class="grow"></span><button class="btn sm pri" id="fpr-copy-all-batch">Copy all</button></div>
      <div class="list" id="fpr-batch-list" style="max-height:none;gap:6px"></div>
    </div>
  </div>
</div>`;
      this.container = this.shadow.getElementById('fmd-prompt-recovery');
      document.body.appendChild(this.host);
      if (window.FloatingPanelManager) {
        window.FloatingPanelManager.register('prompt-recovery', {
          el: this.container,
          handle: this.$('fpr-header'),
          isOpen: () => this.container.style.display === 'flex',
        });
      }
    }

    flash(btn, text) {
      const old = btn.dataset.label || btn.textContent;
      btn.dataset.label = old;
      btn.textContent = text;
      clearTimeout(btn._t);
      btn._t = setTimeout(() => { btn.textContent = old; }, 1800);
    }

    showTab(which) {
      const rec = which === 'recovery';
      this.$('fpr-tab-recovery').classList.toggle('on', rec);
      this.$('fpr-tab-builder').classList.toggle('on', !rec);
      this.$('fpr-view-recovery').hidden = !rec;
      this.$('fpr-view-builder').hidden = rec;
    }

    attachEvents() {
      this.$('fpr-tab-recovery').addEventListener('click', () => this.showTab('recovery'));
      this.$('fpr-tab-builder').addEventListener('click', () => this.showTab('builder'));
      this.$('fpr-close').addEventListener('click', () => this.hide());

      // ---- reference builder ----
      if (!window.ReferenceStoreInstance) {
        window.ReferenceStoreInstance = new window.ReferenceStore();
        window.FlowPromptBuilderInstance = new window.FlowPromptBuilder(window.ReferenceStoreInstance);
      }
      this.builderData = { prompts: [] };

      this.$('fpr-ref-analyze').addEventListener('click', () => {
        const count = window.ReferenceStoreInstance.parseAndStore(this.$('fpr-ref-input').value);
        this.$('fpr-ref-results').hidden = false;
        this.$('fpr-ref-count').textContent = `✓ ${count} reference${count === 1 ? '' : 's'} found`;
        this.$('fpr-ref-list').innerHTML = window.ReferenceStoreInstance.getAll().map((r) => esc(r.identifier)).join('<br>');
      });

      this.$('fpr-img-analyze').addEventListener('click', () => {
        const results = window.FlowPromptBuilderInstance.buildBatch(this.$('fpr-img-input').value);
        this.builderData.prompts = results;
        this.$('fpr-img-results').hidden = false;
        const withRefs = results.filter((r) => r.hasReferences).length;
        const unknown = new Set();
        results.forEach((r) => r.unknownReferences.forEach((u) => unknown.add('@' + u)));
        this.$('fpr-img-summary').innerHTML = `✓ ${results.length} prompts · ${withRefs} use references · ${results.length - withRefs} don't`;
        const warn = this.$('fpr-img-warnings');
        warn.hidden = unknown.size === 0;
        if (unknown.size) warn.textContent = `Unknown references: ${[...unknown].join(', ')}. Add them to the reference library first.`;
        this.$('fpr-batch-viewer').hidden = true;
      });

      this.$('fpr-img-build-all').addEventListener('click', () => {
        this.$('fpr-batch-viewer').hidden = false;
        const list = this.$('fpr-batch-list');
        list.innerHTML = this.builderData.prompts.map((p, idx) => {
          p.deleted = false;
          const refs = p.hasReferences ? `Uses ${p.knownReferences.map((r) => r.trigger).join(', ')}` : 'No references';
          return `<div class="batch" data-idx="${idx}">
            <div class="batch__top">
              <span class="batch__id${p.hasReferences ? ' refs' : ''}">${esc(p.originalParsed.identifier)}</span>
              <span class="batch__refs">${esc(refs)}</span>
              <button class="ib" data-act="del" title="Leave this prompt out">✕</button>
            </div>
            <div class="row">
              <button class="btn sm" data-act="normal">Copy plain</button>
              <button class="btn sm pri" data-act="ref">Copy reference-ready</button>
            </div>
          </div>`;
        }).join('');
      });
      this.$('fpr-batch-list').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const item = b.closest('.batch');
        const p = this.builderData.prompts[+item.dataset.idx];
        if (!p) return;
        if (b.dataset.act === 'del') { p.deleted = true; item.hidden = true; return; }
        navigator.clipboard.writeText(b.dataset.act === 'ref' ? p.refReadyPrompt : p.normalPrompt);
        this.flash(b, 'Copied ✓');
      });
      this.$('fpr-copy-all-batch').addEventListener('click', (e) => {
        const active = this.builderData.prompts.filter((p) => !p.deleted);
        let text = active.map((p) => p.refReadyPrompt).join('\n\n');
        if (active.length > 20) text += `\n\n"divide all the prompt into ${Math.ceil(active.length / 20)} batch and generate them"`;
        navigator.clipboard.writeText(text);
        this.flash(e.currentTarget, `Copied ${active.length} ✓`);
      });

      // ---- missing prompts ----
      const libraryInput = this.$('fpr-library');
      const failedInput = this.$('fpr-failed');
      const statusEl = this.$('fpr-library-status');
      const analyzeBtn = this.$('fpr-analyze-btn');

      const onLibrary = () => {
        const n = window.PromptParser.parse(libraryInput.value).length;
        statusEl.hidden = analyzeBtn.hidden = n === 0;
        statusEl.textContent = `✓ ${n} prompt${n === 1 ? '' : 's'} found`;
      };
      libraryInput.addEventListener('input', onLibrary);

      analyzeBtn.addEventListener('click', () => {
        if (!libraryInput.value.trim()) return;
        if (window.FlowDetector) window.FlowDetector.scan(); // count what's on screen right away
        this.reconciler.initialize(libraryInput.value);
        this.runReconciliation();
      });

      const btnCrawl = this.$('fpr-scan-flow');
      const btnStop = this.$('fpr-stop-crawl');
      btnCrawl.addEventListener('click', () => {
        if (!window.FlowCrawlerInstance) {
          if (window.FlowDetector) window.FlowDetector.scan();
          setTimeout(() => this.runReconciliation(), 100);
          return;
        }
        btnCrawl.hidden = true;
        btnStop.hidden = false;
        this.$('fpr-crawler-status').hidden = false;
        const updateUI = (stats) => {
          this.$('fpr-crawler-state-text').textContent = stats.state === 'COMPLETE' ? 'Scan complete' : stats.state === 'STOPPED' ? 'Scan stopped' : 'Scanning…';
          this.$('fpr-crawler-stats-text').textContent = `${stats.discovered} found`;
          this.runReconciliation(); // live
          if (stats.state === 'COMPLETE' || stats.state === 'STOPPED') {
            btnStop.hidden = true;
            btnCrawl.hidden = false;
            window.FlowCrawlerInstance.unsubscribe(updateUI);
          }
        };
        window.FlowCrawlerInstance.subscribe(updateUI);
        window.FlowCrawlerInstance.start();
      });
      btnStop.addEventListener('click', () => { if (window.FlowCrawlerInstance) window.FlowCrawlerInstance.stop(); });

      this.$('fpr-missing-list').addEventListener('change', (e) => {
        const cb = e.target.closest('input[type=checkbox]');
        if (!cb) return;
        if (cb.checked) this.selectedMissing.add(cb.value); else this.selectedMissing.delete(cb.value);
        this.updateMissingControls();
      });
      this.$('fpr-missing-list').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (!b) return;
        const rec = this.reconciler.getMissingPrompts().find((r) => r.identifier === b.dataset.id);
        if (rec) this.showRecovered([rec]);
      });
      this.$('fpr-select-missing').addEventListener('click', () => {
        const missing = this.reconciler.getMissingPrompts();
        const all = missing.length && missing.every((r) => this.selectedMissing.has(r.identifier));
        this.selectedMissing = all ? new Set() : new Set(missing.map((r) => r.identifier));
        this.renderMissingList();
      });
      this.$('fpr-recover-selected').addEventListener('click', () => {
        const recs = this.reconciler.getMissingPrompts().filter((r) => this.selectedMissing.has(r.identifier));
        if (recs.length) this.showRecovered(recs);
      });
      this.$('fpr-recover-all-missing').addEventListener('click', () => {
        const recs = this.reconciler.getMissingPrompts();
        if (recs.length) this.showRecovered(recs);
      });

      this.$('fpr-clear-lib').addEventListener('click', () => { libraryInput.value = ''; onLibrary(); });
      this.$('fpr-clear-failed').addEventListener('click', () => { failedInput.value = ''; });
      this.$('fpr-find').addEventListener('click', () => this.findMatch());
      this.$('fpr-close-recovery').addEventListener('click', () => { this.$('fpr-results').hidden = true; });
      this.$('fpr-copy-clean').addEventListener('click', (e) => {
        const recs = this.lastMatchedRecords || [];
        if (!recs.length) return;
        navigator.clipboard.writeText(recs.map((r) => window.PromptCleaner.clean(r)).join('\n\n'));
        this.flash(e.currentTarget, `Copied ${recs.length} prompt${recs.length === 1 ? '' : 's'} ✓`);
      });

      this.$('fpr-clear-all').addEventListener('click', () => {
        for (const id of ['fpr-library', 'fpr-failed', 'fpr-ref-input', 'fpr-img-input']) this.$(id).value = '';
        onLibrary();
        for (const id of ['fpr-dashboard', 'fpr-missing-section', 'fpr-generated-section', 'fpr-results',
          'fpr-ref-results', 'fpr-img-results', 'fpr-batch-viewer']) this.$(id).hidden = true;
        this.selectedMissing = new Set();
        this.lastMatchedRecords = [];
      });
    }

    runReconciliation() {
      this.reconciler.reconcile();
      const stats = this.reconciler.getStats();
      this.$('fpr-dashboard').hidden = false;
      this.$('fpr-stat-exp').textContent = stats.expected;
      this.$('fpr-stat-gen').textContent = stats.generated;
      this.$('fpr-stat-mis').textContent = stats.missing;
      const pct = stats.expected > 0 ? Math.round((stats.generated / stats.expected) * 100) : 0;
      this.$('fpr-stat-bar').style.width = `${pct}%`;
      this.renderMissingList();
      this.renderGeneratedList();
    }

    updateMissingControls() {
      const missing = this.reconciler.getMissingPrompts();
      const n = missing.filter((r) => this.selectedMissing.has(r.identifier)).length;
      const btn = this.$('fpr-recover-selected');
      btn.disabled = n === 0;
      btn.textContent = n ? `Recover selected (${n})` : 'Recover selected';
      this.$('fpr-select-missing').textContent = missing.length && n === missing.length ? 'Select none' : 'Select all';
    }

    renderMissingList() {
      const missing = this.reconciler.getMissingPrompts();
      const ids = new Set(missing.map((r) => r.identifier));
      for (const id of [...this.selectedMissing]) if (!ids.has(id)) this.selectedMissing.delete(id); // generated since
      this.$('fpr-missing-section').hidden = missing.length === 0;
      this.$('fpr-missing-n').textContent = missing.length ? String(missing.length) : '';
      this.$('fpr-missing-list').innerHTML = missing.map((r) => `
        <label class="miss" title="${esc(r.promptBody)}">
          <input type="checkbox" value="${esc(r.identifier)}"${this.selectedMissing.has(r.identifier) ? ' checked' : ''}>
          <span class="miss__id">${esc(r.identifier)}</span>
          <span class="miss__p">${esc(r.promptBody)}</span>
          <button class="btn sm" data-id="${esc(r.identifier)}">Recover</button>
        </label>`).join('');
      this.updateMissingControls();
    }

    renderGeneratedList() {
      const generated = this.reconciler.getGeneratedPrompts();
      this.$('fpr-generated-section').hidden = generated.length === 0;
      this.$('fpr-generated-n').textContent = generated.length ? String(generated.length) : '';
      this.$('fpr-generated-list').innerHTML = generated.map((r) => `<span class="chip">✓ ${esc(r.identifier)}</span>`).join('');
    }

    // Show recovered prompts (exact, from the library) ready to copy.
    showRecovered(records) {
      this.lastMatchedRecords = records;
      this.$('fpr-results').hidden = false;
      this.$('fpr-res-conf-box').hidden = true;
      this.$('fpr-res-warnings').hidden = true;
      this.$('fpr-res-id').textContent = records.length === 1 ? records[0].identifier : `${records.length} prompts`;
      this.$('fpr-res-body').textContent = records.length === 1
        ? records[0].promptBody
        : records.map((r) => r.identifier).join(', ');
      setTimeout(() => this.$('fpr-results').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }

    findMatch() {
      const rawLibrary = this.$('fpr-library').value;
      const res = this.$('fpr-results');
      if (!rawLibrary.trim()) {
        res.hidden = false;
        this.lastMatchedRecords = [];
        this.$('fpr-res-conf-box').hidden = true;
        this.$('fpr-res-id').textContent = '—';
        this.$('fpr-res-body').textContent = 'Paste your original prompts in step 1 first.';
        this.$('fpr-res-warnings').hidden = true;
        return;
      }
      const failedText = this.$('fpr-failed').value;
      if (!failedText.trim()) return;

      const matcher = new window.PromptMatcher(window.PromptParser.parse(rawLibrary));
      const chunks = failedText.split('\n').filter((t) => t.trim().length > 10);
      const found = new Map();
      let minConfidence = 1;
      for (const text of chunks.length ? chunks : [failedText]) {
        const r = matcher.match(text);
        if (r.match) {
          found.set(r.identifier, r.matchedPrompt);
          if (r.confidence < minConfidence) minConfidence = r.confidence;
        }
      }

      res.hidden = false;
      this.$('fpr-res-conf-box').hidden = false;
      this.lastMatchedRecords = [...found.values()];
      const warn = this.$('fpr-res-warnings');
      if (this.lastMatchedRecords.length) {
        const ids = this.lastMatchedRecords.map((r) => r.identifier).join(', ');
        this.$('fpr-res-id').textContent = this.lastMatchedRecords.length > 1 ? `${this.lastMatchedRecords.length} matches` : ids;
        this.$('fpr-res-conf').textContent = `${Math.round(minConfidence * 100)}%${this.lastMatchedRecords.length > 1 ? ' min' : ''}`;
        this.$('fpr-res-body').textContent = this.lastMatchedRecords.length === 1 ? this.lastMatchedRecords[0].promptBody : ids;
        warn.hidden = true;
      } else {
        this.$('fpr-res-id').textContent = 'No match';
        this.$('fpr-res-conf').textContent = '0%';
        this.$('fpr-res-body').textContent = 'Nothing in your prompt list matches this text closely enough.';
        warn.hidden = true;
      }
      setTimeout(() => res.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }

    show() {
      this.container.style.display = 'flex';
      if (window.FloatingPanelManager) window.FloatingPanelManager.restorePosition('prompt-recovery');
    }

    hide() {
      this.container.style.display = 'none';
    }
  }

  window.PromptRecoveryUI = PromptRecoveryUI;
})();

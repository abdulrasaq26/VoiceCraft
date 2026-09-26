class PromptRecoveryUI {
  constructor() {
    this.reconciler = new window.GenerationReconciler();
    this.createDOM();
    this.attachEvents();
  }

  createDOM() {
    this.container = document.createElement('div');
    this.container.id = 'fmd-prompt-recovery';
    this.container.style.cssText = `
      position: fixed;
      top: 5vh;
      left: 50%;
      transform: translateX(-50%);
      width: 480px;
      background: #1e1e2e;
      color: #cdd6f4;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.8);
      z-index: 10002;
      font-family: system-ui, -apple-system, sans-serif;
      display: none;
      flex-direction: column;
      border: 1px solid #313244;
      max-height: 90vh;
    `;

    this.container.innerHTML = `
      <div id="fpr-header" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; border-bottom: 1px solid #313244; background: #181825; border-radius: 12px 12px 0 0; cursor: move; user-select: none;">
        <div style="font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; pointer-events: none;">
          <span style="color: #89b4fa;">⟲</span> PROMPT RECOVERY
        </div>
        <div style="display: flex; gap: 10px;">
          <button id="fpr-clear-all" style="background: none; border: 1px solid #f38ba8; color: #f38ba8; cursor: pointer; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold;">CLEAR ALL</button>
          <button id="fpr-close" style="background: none; border: none; color: #a6adc8; cursor: pointer; padding: 4px;">✕</button>
        </div>
      </div>
      
      <!-- TABS -->
      <div id="fpr-tabs" style="display: flex; background: #181825; border-bottom: 1px solid #313244;">
        <button id="fpr-tab-recovery" style="flex: 1; padding: 10px; background: #313244; color: #cdd6f4; border: none; font-weight: bold; cursor: pointer; font-size: 11px;">Missing Recovery</button>
        <button id="fpr-tab-builder" style="flex: 1; padding: 10px; background: transparent; color: #a6adc8; border: none; font-weight: bold; cursor: pointer; font-size: 11px;">Reference Builder</button>
      </div>

      
      <div id="fpr-view-recovery" style="padding: 15px; display: flex; flex-direction: column; gap: 15px; overflow-y: auto; max-height: calc(90vh - 95px);">
        
        <!-- LIBRARY -->
        <div style="background: #181825; padding: 12px; border-radius: 8px; border: 1px solid #313244;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <label style="font-size: 11px; font-weight: 600; color: #a6adc8; letter-spacing: 0.5px;">ORIGINAL PROMPT LIBRARY</label>
            <button id="fpr-clear-lib" style="background: none; border: none; color: #f38ba8; font-size: 10px; cursor: pointer; text-decoration: underline;">Clear</button>
          </div>
          <textarea id="fpr-library" placeholder="Paste all 30+ original prompts here...\\n\\n#0-21 ...\\n#0-22 ..." style="width: 100%; height: 80px; background: #11111b; border: 1px solid #313244; border-radius: 6px; color: #cdd6f4; padding: 10px; font-family: monospace; font-size: 12px; resize: vertical; box-sizing: border-box;"></textarea>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
              <div id="fpr-library-status" style="font-size: 11px; color: #a6e3a1; display: none;">0 prompts detected ✓</div>
              <button id="fpr-analyze-btn" style="display: none; padding: 4px 12px; background: #cba6f7; color: #11111b; border: none; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer;">Analyze & Reconcile</button>
          </div>
        </div>

        <!-- DASHBOARD -->
        <div id="fpr-dashboard" style="display: none; background: #181825; padding: 12px; border-radius: 8px; border: 1px solid #313244;">
          <div style="font-size: 11px; font-weight: 600; color: #a6adc8; margin-bottom: 10px; text-align: center; letter-spacing: 1px;">GENERATION STATUS</div>
          <div style="display: flex; justify-content: space-around; margin-bottom: 12px;">
              <div style="text-align: center;"><div style="font-size: 10px; color:#a6adc8; margin-bottom: 2px;">Expected</div><div id="fpr-stat-exp" style="font-size: 18px; font-weight:bold; color:#bac2de">0</div></div>
              <div style="text-align: center;"><div style="font-size: 10px; color:#a6e3a1; margin-bottom: 2px;">Generated</div><div id="fpr-stat-gen" style="font-size: 18px; font-weight:bold; color:#a6e3a1">0</div></div>
              <div style="text-align: center;"><div style="font-size: 10px; color:#f38ba8; margin-bottom: 2px;">Missing</div><div id="fpr-stat-mis" style="font-size: 18px; font-weight:bold; color:#f38ba8">0</div></div>
          </div>
          <div style="width: 100%; height: 4px; background: #313244; border-radius: 2px; margin-bottom: 12px; overflow: hidden;">
             <div id="fpr-stat-bar" style="height: 100%; width: 0%; background: #a6e3a1; transition: 0.3s;"></div>
          </div>
          <div id="fpr-crawler-status" style="display: none; background: #1e1e2e; padding: 10px; border-radius: 6px; margin-bottom: 10px; border: 1px solid #45475a; text-align: center;">
                <div id="fpr-crawler-state-text" style="color: #89b4fa; font-weight: bold; font-size: 11px; margin-bottom: 4px;">🔄 CRAWLER IDLE</div>
                <div id="fpr-crawler-stats-text" style="color: #a6adc8; font-size: 10px;">Waiting...</div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button id="fpr-scan-flow" style="flex: 1; padding: 8px; background: #89b4fa; color: #11111b; border: none; border-radius: 6px; font-weight: bold; font-size: 12px; cursor: pointer; transition: 0.2s;">Auto-Crawl Flow</button>
                <button id="fpr-stop-crawl" style="display: none; padding: 8px; background: #f38ba8; color: #11111b; border: none; border-radius: 6px; font-weight: bold; font-size: 12px; cursor: pointer; transition: 0.2s;">Stop</button>
            </div>
        </div>

        <!-- MISSING LIST -->
        <div id="fpr-missing-section" style="display: none;">
          <div style="font-size: 11px; font-weight: 600; color: #f38ba8; margin-bottom: 8px; border-bottom: 1px solid #313244; padding-bottom: 4px; letter-spacing: 0.5px; display: flex; justify-content: space-between; align-items: center;">
             <span>MISSING / OMITTED</span>
             <button id="fpr-recover-all-missing" style="background: none; border: none; color: #a6adc8; font-size: 10px; cursor: pointer; text-decoration: underline;">Recover All</button>
          </div>
          <div id="fpr-missing-list" style="display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow-y: auto; padding-right: 4px;"></div>
        </div>

        <!-- UNMATCHED ASSETS -->
        <div id="fpr-unmatched-section" style="display: none; margin-top: 10px;">
          <div style="font-size: 11px; font-weight: 600; color: #f9e2af; margin-bottom: 8px; border-bottom: 1px solid #313244; padding-bottom: 4px; letter-spacing: 0.5px;">UNMATCHED ASSETS</div>
          <div id="fpr-unmatched-list" style="display: flex; flex-flow: row wrap; gap: 6px; max-height: 100px; overflow-y: auto; padding-right: 4px;"></div>
        </div>

        <!-- GENERATED LIST -->
        <div id="fpr-generated-section" style="display: none;">
          <div style="font-size: 11px; font-weight: 600; color: #a6e3a1; margin-bottom: 8px; border-bottom: 1px solid #313244; padding-bottom: 4px; letter-spacing: 0.5px;">GENERATED</div>
          <div id="fpr-generated-list" style="display: flex; flex-flow: row wrap; gap: 6px; max-height: 100px; overflow-y: auto; padding-right: 4px;"></div>
        </div>

      </div>

      </div> <!-- End of fpr-view-recovery -->

      <!-- REFERENCE BUILDER VIEW -->
      <div id="fpr-view-builder" style="display: none; padding: 15px; flex-direction: column; gap: 15px; overflow-y: auto; max-height: calc(90vh - 95px);">
        
        <!-- REFERENCE LIBRARY INPUT -->
        <div style="background: #181825; padding: 12px; border-radius: 8px; border: 1px solid #313244;">
          <div style="font-size: 11px; font-weight: 600; color: #a6adc8; letter-spacing: 0.5px; margin-bottom: 6px;">REFERENCE LIBRARY</div>
          <div style="font-size: 10px; color: #7f849c; margin-bottom: 8px;">Paste your reference-generation prompts:</div>
          <textarea id="fpr-ref-input" placeholder="#james
Create a consistent character reference...

#sarah
..." style="width: 100%; height: 80px; background: #11111b; border: 1px solid #313244; border-radius: 6px; color: #cdd6f4; padding: 10px; font-family: monospace; font-size: 12px; resize: vertical; box-sizing: border-box;"></textarea>
          <button id="fpr-ref-analyze" style="width: 100%; margin-top: 8px; padding: 8px; background: #89b4fa; color: #11111b; border: none; border-radius: 6px; font-weight: bold; font-size: 12px; cursor: pointer;">Analyze References</button>
          
          <div id="fpr-ref-results" style="display: none; margin-top: 10px; padding-top: 10px; border-top: 1px solid #313244;">
             <div id="fpr-ref-count" style="color: #a6e3a1; font-size: 11px; font-weight: bold; margin-bottom: 8px;">✓ 0 references detected</div>
             <div id="fpr-ref-list" style="color: #bac2de; font-size: 11px; font-family: monospace;"></div>
          </div>
        </div>

        <!-- IMAGE PROMPTS INPUT -->
        <div style="background: #181825; padding: 12px; border-radius: 8px; border: 1px solid #313244;">
          <div style="font-size: 11px; font-weight: 600; color: #a6adc8; letter-spacing: 0.5px; margin-bottom: 6px;">IMAGE PROMPTS</div>
          <div style="font-size: 10px; color: #7f849c; margin-bottom: 8px;">Paste your image-generation prompts containing @references:</div>
          <textarea id="fpr-img-input" placeholder="#0-01 A cinematic shot of @james..." style="width: 100%; height: 80px; background: #11111b; border: 1px solid #313244; border-radius: 6px; color: #cdd6f4; padding: 10px; font-family: monospace; font-size: 12px; resize: vertical; box-sizing: border-box;"></textarea>
          <button id="fpr-img-analyze" style="width: 100%; margin-top: 8px; padding: 8px; background: #cba6f7; color: #11111b; border: none; border-radius: 6px; font-weight: bold; font-size: 12px; cursor: pointer;">Analyze Image Prompts</button>
          
          <div id="fpr-img-results" style="display: none; margin-top: 10px; padding-top: 10px; border-top: 1px solid #313244;">
             <div id="fpr-img-summary" style="font-size: 11px; color: #bac2de; margin-bottom: 8px;"></div>
             <div id="fpr-img-warnings" style="color: #f38ba8; font-size: 11px; margin-bottom: 8px; display: none;"></div>
             <button id="fpr-img-build-all" style="width: 100%; padding: 8px; background: #a6e3a1; color: #11111b; border: none; border-radius: 6px; font-weight: bold; font-size: 12px; cursor: pointer;">Build & View Prompts</button>
          </div>
        </div>
        
        <!-- BATCH RESULTS VIEWER -->
        <div id="fpr-batch-viewer" style="display: none; flex-direction: column; gap: 10px;">
           <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="font-size: 11px; font-weight: 600; color: #a6adc8;">REFERENCE-READY PROMPTS</div>
              <button id="fpr-copy-all-batch" style="padding: 4px 10px; background: #a6e3a1; color: #11111b; border: none; border-radius: 4px; font-size: 10px; font-weight: bold; cursor: pointer;">Copy All</button>
           </div>
           <div id="fpr-batch-list" style="display: flex; flex-direction: column; gap: 10px;"></div>
        </div>

      </div>
    `;

    document.body.appendChild(this.container);
    this.makeDraggable();
  }

  makeDraggable() {
    const header = this.container.querySelector('#fpr-header');
    let isDragging = false;
    let currentX = 0, currentY = 0, initialX = 0, initialY = 0;

    header.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        const rect = this.container.getBoundingClientRect();
        this.container.style.top = rect.top + 'px';
        this.container.style.left = rect.left + 'px';
        this.container.style.transform = 'none';
        initialX = e.clientX - rect.left;
        initialY = e.clientY - rect.top;
        isDragging = true;
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            if (currentY < 0) currentY = 0;
            this.container.style.left = currentX + 'px';
            this.container.style.top = currentY + 'px';
        }
    });

    document.addEventListener('mouseup', () => { isDragging = false; });
    
    this.resetDrag = () => {
        this.container.style.top = '5vh';
        this.container.style.left = '50%';
        this.container.style.transform = 'translateX(-50%)';
    };
  }

  attachEvents() {
      if (window.AutomatorEvents) {
          window.AutomatorEvents.on('ASSET_DETECTED', () => {
              if (this.reconciler && this.reconciler.expectedPrompts && this.reconciler.expectedPrompts.size > 0) {
                  this.runReconciliation();
              }
          });
      }

      // TABS
    const tabRec = this.container.querySelector('#fpr-tab-recovery');
    const tabBuild = this.container.querySelector('#fpr-tab-builder');
    const viewRec = this.container.querySelector('#fpr-view-recovery');
    const viewBuild = this.container.querySelector('#fpr-view-builder');

    tabRec.addEventListener('click', () => {
        tabRec.style.background = '#313244';
        tabRec.style.color = '#cdd6f4';
        tabBuild.style.background = 'transparent';
        tabBuild.style.color = '#a6adc8';
        viewRec.style.display = 'flex';
        viewBuild.style.display = 'none';
    });

    tabBuild.addEventListener('click', () => {
        tabBuild.style.background = '#313244';
        tabBuild.style.color = '#cdd6f4';
        tabRec.style.background = 'transparent';
        tabRec.style.color = '#a6adc8';
        viewBuild.style.display = 'flex';
        viewRec.style.display = 'none';
    });

    // BUILDER LOGIC
    if (!window.ReferenceStoreInstance) {
        window.ReferenceStoreInstance = new window.ReferenceStore();
        window.FlowPromptBuilderInstance = new window.FlowPromptBuilder(window.ReferenceStoreInstance);
    }
    this.builderData = { prompts: [] };

    this.container.querySelector('#fpr-ref-analyze').addEventListener('click', () => {
        const text = this.container.querySelector('#fpr-ref-input').value;
        const count = window.ReferenceStoreInstance.parseAndStore(text);
        const resDiv = this.container.querySelector('#fpr-ref-results');
        resDiv.style.display = 'block';
        
        this.container.querySelector('#fpr-ref-count').textContent = `✓ ${count} references detected`;
        const listDiv = this.container.querySelector('#fpr-ref-list');
        listDiv.innerHTML = window.ReferenceStoreInstance.getAll().map(r => r.identifier).join('<br>');
    });

    this.container.querySelector('#fpr-img-analyze').addEventListener('click', () => {
        const text = this.container.querySelector('#fpr-img-input').value;
        const results = window.FlowPromptBuilderInstance.buildBatch(text);
        this.builderData.prompts = results;
        
        const resDiv = this.container.querySelector('#fpr-img-results');
        resDiv.style.display = 'block';
        
        const total = results.length;
        const withRefs = results.filter(r => r.hasReferences).length;
        const withoutRefs = total - withRefs;
        
        let unknownCount = 0;
        let unknownList = new Set();
        results.forEach(r => {
            r.unknownReferences.forEach(u => unknownList.add('@' + u));
        });
        
        this.container.querySelector('#fpr-img-summary').innerHTML = `
            ✓ ${total} prompts detected<br>
            • ${withRefs} use references<br>
            • ${withoutRefs} do not use references
        `;
        
        const warnDiv = this.container.querySelector('#fpr-img-warnings');
        if (unknownList.size > 0) {
            warnDiv.style.display = 'block';
            warnDiv.innerHTML = `⚠ Unknown references detected: ${Array.from(unknownList).join(', ')}<br>Define them in the Reference Library first.`;
        } else {
            warnDiv.style.display = 'none';
        }
        
        this.container.querySelector('#fpr-batch-viewer').style.display = 'none';
    });

    this.container.querySelector('#fpr-img-build-all').addEventListener('click', () => {
        const viewer = this.container.querySelector('#fpr-batch-viewer');
        viewer.style.display = 'flex';
        const list = this.container.querySelector('#fpr-batch-list');
        list.innerHTML = '';
        
        this.builderData.prompts.forEach((p, idx) => {
            p.deleted = false; // Initialize deleted state
            
            const item = document.createElement('div');
            item.className = 'fpr-batch-item';
            item.style.cssText = 'background: #11111b; padding: 10px; border-radius: 6px; border: 1px solid #313244;';
            
            const triggers = p.knownReferences.map(r => r.trigger).join(', ');
            const refsText = p.hasReferences ? `References: ${triggers}` : 'References: None';
            const idColor = p.hasReferences ? '#cba6f7' : '#a6e3a1'; // Purple if references exist, Green if not
            
            item.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <div style="font-size: 12px; font-weight: bold; color: ${idColor};">${p.originalParsed.identifier}</div>
                        <div style="font-size: 10px; color: #a6adc8;">${refsText}</div>
                    </div>
                    <button class="btn-delete-ref" data-idx="${idx}" style="background: none; border: none; color: #f38ba8; cursor: pointer; padding: 0; font-size: 14px; line-height: 1; display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%;" title="Remove this prompt">×</button>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn-copy-normal" data-idx="${idx}" style="flex: 1; padding: 6px; background: #313244; color: #cdd6f4; border: none; border-radius: 4px; font-size: 10px; cursor: pointer;">Copy Normal</button>
                    <button class="btn-copy-ref" data-idx="${idx}" style="flex: 1; padding: 6px; background: #a6e3a1; color: #11111b; border: none; border-radius: 4px; font-size: 10px; font-weight: bold; cursor: pointer;">Copy Ref-Ready</button>
                </div>
            `;
            list.appendChild(item);
        });
        
        list.querySelectorAll('.btn-copy-normal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = e.target.getAttribute('data-idx');
                navigator.clipboard.writeText(this.builderData.prompts[idx].normalPrompt);
                e.target.textContent = 'Copied!';
                setTimeout(() => e.target.textContent = 'Copy Normal', 2000);
            });
        });
        
        list.querySelectorAll('.btn-copy-ref').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = e.target.getAttribute('data-idx');
                navigator.clipboard.writeText(this.builderData.prompts[idx].refReadyPrompt);
                e.target.textContent = 'Copied!';
                setTimeout(() => e.target.textContent = 'Copy Ref-Ready', 2000);
            });
        });

        list.querySelectorAll('.btn-delete-ref').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = e.target.getAttribute('data-idx');
                this.builderData.prompts[idx].deleted = true;
                e.target.closest('.fpr-batch-item').style.display = 'none';
            });
        });
    });

    this.container.querySelector('#fpr-copy-all-batch').addEventListener('click', (e) => {
        const activePrompts = this.builderData.prompts.filter(p => !p.deleted);
        let fullText = activePrompts.map(p => p.refReadyPrompt).join('\n\n');
        
        if (activePrompts.length > 20) {
            const batches = Math.ceil(activePrompts.length / 20);
            fullText += `\n\n"divide all the prompt into ${batches} batch and generate them"`;
        }
        
        navigator.clipboard.writeText(fullText);
        e.target.textContent = 'Copied All!';
        setTimeout(() => e.target.textContent = 'Copy All', 2000);
    });


    this.container.querySelector('#fpr-close').addEventListener('click', () => this.hide());
    
    const libraryInput = this.container.querySelector('#fpr-library');
    const failedInput = this.container.querySelector('#fpr-failed');
    const statusDiv = this.container.querySelector('#fpr-library-status');
    const analyzeBtn = this.container.querySelector('#fpr-analyze-btn');
    
    libraryInput.addEventListener('input', () => {
      const parsed = window.PromptParser.parse(libraryInput.value);
      if (parsed.length > 0) {
          statusDiv.style.display = 'block';
          statusDiv.textContent = `${parsed.length} prompts detected ✓`;
          analyzeBtn.style.display = 'block';
      } else {
          statusDiv.style.display = 'none';
          analyzeBtn.style.display = 'none';
      }
    });

    analyzeBtn.addEventListener('click', () => {
        if (!libraryInput.value.trim()) return;
        this.reconciler.initialize(libraryInput.value);
        this.runReconciliation();
    });

    const btnCrawl = this.container.querySelector('#fpr-scan-flow');
    const btnStop = this.container.querySelector('#fpr-stop-crawl');
    const crawlStatusBox = this.container.querySelector('#fpr-crawler-status');
    const crawlStateText = this.container.querySelector('#fpr-crawler-state-text');
    const crawlStatsText = this.container.querySelector('#fpr-crawler-stats-text');

    btnCrawl.addEventListener('click', () => {
        if (window.FlowCrawlerInstance) {
            btnCrawl.style.display = 'none';
            btnStop.style.display = 'block';
            crawlStatusBox.style.display = 'block';
            
            const updateUI = (stats) => {
                crawlStateText.textContent = `🔄 ${stats.state}`;
                crawlStatsText.textContent = `Discovered: ${stats.discovered}`;
                
                // Live update the reconciliation dashboard!
                this.runReconciliation();

                if (stats.state === 'COMPLETE' || stats.state === 'STOPPED') {
                    btnStop.style.display = 'none';
                    btnCrawl.style.display = 'block';
                    window.FlowCrawlerInstance.unsubscribe(updateUI);
                }
            };
            
            window.FlowCrawlerInstance.subscribe(updateUI);
            window.FlowCrawlerInstance.start();
        } else {
            if (window.FlowDetector) window.FlowDetector.scan();
            setTimeout(() => this.runReconciliation(), 100);
        }
    });

    btnStop.addEventListener('click', () => {
        if (window.FlowCrawlerInstance) {
            window.FlowCrawlerInstance.stop();
        }
    });

    btnStop.addEventListener('click', () => {
        if (window.FlowCrawlerInstance) {
            window.FlowCrawlerInstance.stop();
        }
    });

    this.container.querySelector('#fpr-clear-lib').addEventListener('click', () => {
        libraryInput.value = '';
        statusDiv.style.display = 'none';
        analyzeBtn.style.display = 'none';
    });

    this.container.querySelector('#fpr-clear-all').addEventListener('click', () => {
        // Missing Recovery
        if (libraryInput) libraryInput.value = '';
        if (statusDiv) statusDiv.style.display = 'none';
        if (analyzeBtn) analyzeBtn.style.display = 'none';
        
        const dashboard = this.container.querySelector('#fpr-dashboard');
        const missingSec = this.container.querySelector('#fpr-missing-section');
        const genSec = this.container.querySelector('#fpr-generated-section');
        
        if (dashboard) dashboard.style.display = 'none';
        if (missingSec) missingSec.style.display = 'none';
        if (genSec) genSec.style.display = 'none';
        const unmatchSec = this.container.querySelector('#fpr-unmatched-section');
        if (unmatchSec) unmatchSec.style.display = 'none';

        // Reference Builder
        const refInput = this.container.querySelector('#fpr-ref-input');
        const imgInput = this.container.querySelector('#fpr-img-input');
        const refRes = this.container.querySelector('#fpr-ref-results');
        const imgRes = this.container.querySelector('#fpr-img-results');
        const batchView = this.container.querySelector('#fpr-batch-viewer');

        if (refInput) refInput.value = '';
        if (imgInput) imgInput.value = '';
        if (refRes) refRes.style.display = 'none';
        if (imgRes) imgRes.style.display = 'none';
        if (batchView) batchView.style.display = 'none';
        
        if (this.resetDrag) this.resetDrag();
    });

    this.container.querySelector('#fpr-find').addEventListener('click', () => this.findMatch());
    
    this.container.querySelector('#fpr-close-recovery').addEventListener('click', () => {
        this.container.querySelector('#fpr-results').style.display = 'none';
    });

    }

  runReconciliation() {
      this.reconciler.reconcile();
      const stats = this.reconciler.getStats();
      
      this.container.querySelector('#fpr-dashboard').style.display = 'block';
      this.container.querySelector('#fpr-stat-exp').textContent = stats.expected;
      this.container.querySelector('#fpr-stat-gen').textContent = stats.generated;
      this.container.querySelector('#fpr-stat-mis').textContent = stats.missing;
      
      const pct = stats.expected > 0 ? Math.round((stats.generated / stats.expected) * 100) : 0;
      this.container.querySelector('#fpr-stat-bar').style.width = `${pct}%`;
      
      this.renderMissingList();
      this.renderGeneratedList();
  }

  renderMissingList() {
      const missing = this.reconciler.getMissingPrompts();
      const section = this.container.querySelector('#fpr-missing-section');
      const list = this.container.querySelector('#fpr-missing-list');
      
      if (missing.length === 0) {
          section.style.display = 'none';
          return;
      }
      
      section.style.display = 'block';
      list.innerHTML = '';
        const recoverAllBtn = this.container.querySelector('#fpr-recover-all-missing');
        if (recoverAllBtn) {
            recoverAllBtn.onclick = () => {
                this.lastMatchedRecords = missing;
                const resDiv = this.container.querySelector('#fpr-results');
                resDiv.style.display = 'flex';
                this.container.querySelector('#fpr-res-id').textContent = `${missing.length} Prompts`;
                this.container.querySelector('#fpr-res-conf-box').style.display = 'none';
                const ids = missing.map(r => r.identifier).join(', ');
                this.container.querySelector('#fpr-res-body').textContent = `Recovering ${missing.length} missing prompts:\n\n${ids}`;
                this.container.querySelector('#fpr-res-warnings').style.display = 'none';
                setTimeout(() => resDiv.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
            };
        }
      
      missing.forEach(record => {
          const item = document.createElement('div');
          item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; background: #313244; padding: 6px 10px; border-radius: 4px; border-left: 3px solid #f38ba8;';
          
          const idSpan = document.createElement('span');
          idSpan.style.cssText = 'font-weight: bold; font-size: 12px; font-family: monospace; color: #cdd6f4;';
          idSpan.innerHTML = `<span style="color:#f38ba8; margin-right:4px;">⚠</span> ${record.identifier}`;
          
          const recoverBtn = document.createElement('button');
          recoverBtn.textContent = 'Copy Prompt';
          recoverBtn.style.cssText = 'background: #45475a; color: #cdd6f4; border: none; padding: 4px 8px; border-radius: 4px; font-size: 10px; cursor: pointer; font-weight: bold;';
          recoverBtn.addEventListener('click', () => {
              const textToCopy = record.originalPrompt || `${record.identifier}\n${record.promptBody}`;
              navigator.clipboard.writeText(textToCopy).then(() => {
                  const orig = recoverBtn.textContent;
                  recoverBtn.textContent = 'Copied!';
                  setTimeout(() => recoverBtn.textContent = orig, 2000);
              });
          });
          
          item.appendChild(idSpan);
          item.appendChild(recoverBtn);
          list.appendChild(item);
      });
  }

  renderGeneratedList() {
      const generated = this.reconciler.getGeneratedPrompts();
      const section = this.container.querySelector('#fpr-generated-section');
      const list = this.container.querySelector('#fpr-generated-list');
      
      if (generated.length === 0) {
          section.style.display = 'none';
          return;
      }
      
      section.style.display = 'block';
      list.innerHTML = '';
      
      generated.forEach(record => {
          const item = document.createElement('div');
          item.style.cssText = 'background: rgba(166, 227, 161, 0.1); border: 1px solid rgba(166, 227, 161, 0.3); padding: 4px 8px; border-radius: 4px; font-size: 11px; font-family: monospace; color: #a6e3a1;';
          item.textContent = `✓ ${record.identifier}`;
          list.appendChild(item);
      });
  }

  show() {
    this.container.style.display = 'flex';
  }

  hide() {
    this.container.style.display = 'none';
  }
}

window.PromptRecoveryUI = PromptRecoveryUI;

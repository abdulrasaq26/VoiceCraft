// content/ui/automator-panel.js

class AutomatorPanel {
  constructor(queueManager, flowAdapter) {
    this.queueManager = queueManager;
    this.flowAdapter = flowAdapter;
    this.isVisible = false;
    this.initDOM();
    this.bindEvents();
    
    // Listen for queue updates
    window.AutomatorEvents.on('JOB_STARTED', this.renderQueue.bind(this));
    window.AutomatorEvents.on('JOB_SUBMITTED', this.renderQueue.bind(this));
    window.AutomatorEvents.on('GENERATION_STARTED', this.renderQueue.bind(this));
    window.AutomatorEvents.on('JOB_COMPLETED', this.renderQueue.bind(this));
    window.AutomatorEvents.on('JOB_FAILED', this.renderQueue.bind(this));
    window.AutomatorEvents.on('QUEUE_STOPPED', this.renderQueue.bind(this));
  }

  initDOM() {
    this.host = document.createElement('div');
    this.host.id = 'fmd-automator-host';
    this.shadow = this.host.attachShadow({ mode: 'open' });

    // Inject styles
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('content/ui/styles.css');
    this.shadow.appendChild(styleLink);

    this.container = document.createElement('div');
    this.container.className = 'fmd-automator-container';
    this.container.style.display = 'none';
    
    this.container.innerHTML = `
      <div class="fmd-automator-header">
        <div class="fmd-automator-title">
           <img src="${chrome.runtime.getURL('icons/icon16.png')}" alt="icon" style="width:16px; margin-right:8px; vertical-align:middle; border-radius:4px;" />
           TryAIToday Flow Automator ✦
        </div>
        <div class="fmd-automator-actions">
           <button class="fmd-auto-btn-icon" id="fmd-auto-minimize">_</button>
           <button class="fmd-auto-btn-icon" id="fmd-auto-close">×</button>
        </div>
      </div>
      
      <div class="fmd-automator-tabs">
        <button class="fmd-auto-tab active"><span class="icon">🖼️</span> Images</button>
        <button class="fmd-auto-tab"><span class="icon">▶️</span> Videos</button>
      </div>

      <div class="fmd-automator-content">
         
         <div class="fmd-auto-settings-panel">
            <div class="fmd-auto-setting-group">
               <label>Aspect ratio</label>
               <div class="fmd-auto-pill-group">
                  <button class="fmd-auto-pill active">16:9</button>
                  <button class="fmd-auto-pill">4:3</button>
                  <button class="fmd-auto-pill">1:1</button>
                  <button class="fmd-auto-pill">3:4</button>
                  <button class="fmd-auto-pill">9:16</button>
               </div>
            </div>
            <div class="fmd-auto-setting-group">
               <label>Images per prompt</label>
               <div class="fmd-auto-pill-group">
                  <button class="fmd-auto-pill active">x1</button>
                  <button class="fmd-auto-pill">x2</button>
                  <button class="fmd-auto-pill">x3</button>
                  <button class="fmd-auto-pill">x4</button>
               </div>
            </div>
         </div>

         <div class="fmd-auto-queue-section">
            <div class="fmd-auto-queue-header">
               <span>Queue: <strong id="fmd-auto-project-name">Main Batch</strong></span>
               <span class="fmd-auto-queue-count" id="fmd-auto-count">0 / 0</span>
            </div>
            
            <textarea id="fmd-auto-prompt-input" class="fmd-auto-textarea" placeholder="#2-31 [IMAGE] wide cinematic shot of...\n\nSeparate each prompt with a blank line."></textarea>
            
            <div style="display: flex; gap: 8px;">
               <button id="fmd-auto-load-btn" class="fmd-auto-btn-secondary" style="flex: 1;">Load prompts</button>
               <button id="fmd-auto-recovery-btn" class="fmd-auto-btn-secondary" style="flex: 1; background-color: #2a2a2a; color: #a6e3a1; border: 1px solid #225522; font-weight: bold;">Recovery</button>
               <button id="fmd-auto-clear-btn" class="fmd-auto-btn-secondary" style="flex: 1; background-color: #2a2a2a; color: #ff5555; border: 1px solid #552222; font-weight: bold;">Clear Queue</button>
            </div>

            <div id="fmd-auto-job-list" class="fmd-auto-job-list">
               <!-- Jobs render here -->
            </div>
         </div>
      </div>

      <div class="fmd-automator-footer">
         <button id="fmd-auto-start-btn" class="fmd-auto-btn-primary">Start</button>
         <button id="fmd-auto-stop-btn" class="fmd-auto-btn-danger">Stop</button>
      </div>
    `;
    
    this.shadow.appendChild(this.container);
    document.body.appendChild(this.host);
  }

  bindEvents() {
    this.shadow.getElementById('fmd-auto-close').addEventListener('click', () => this.toggle());
    
    // Add minimize listener
    this.shadow.getElementById('fmd-auto-minimize').addEventListener('click', () => {
        const content = this.shadow.querySelector('.fmd-automator-content');
        const footer = this.shadow.querySelector('.fmd-automator-footer');
        const tabs = this.shadow.querySelector('.fmd-automator-tabs');
        if (content.style.display === 'none') {
            content.style.display = 'block';
            footer.style.display = 'flex';
            tabs.style.display = 'flex';
        } else {
            content.style.display = 'none';
            footer.style.display = 'none';
            tabs.style.display = 'none';
        }
    });

    this.shadow.getElementById('fmd-auto-load-btn').addEventListener('click', () => {
       const text = this.shadow.getElementById('fmd-auto-prompt-input').value;
       const count = this.queueManager.addJobs(text);
       if (count > 0) {
           this.shadow.getElementById('fmd-auto-prompt-input').value = '';
           this.renderQueue();
       }
    });

    this.shadow.getElementById('fmd-auto-recovery-btn').addEventListener('click', () => {
        if (!window.promptRecoveryUI) {
            window.promptRecoveryUI = new window.PromptRecoveryUI();
        }
        window.promptRecoveryUI.show();
    });

    this.shadow.getElementById('fmd-auto-clear-btn').addEventListener('click', () => {
       if (confirm("Are you sure you want to clear the entire queue? This will cancel any active jobs.")) {
           this.queueManager.clear();
           this.shadow.getElementById('fmd-auto-prompt-input').value = '';
           this.renderQueue();
       }
    });

    this.shadow.getElementById('fmd-auto-start-btn').addEventListener('click', () => {
       this.queueManager.start();
    });

    this.shadow.getElementById('fmd-auto-stop-btn').addEventListener('click', () => {
       this.queueManager.stop();
    });
  }

  renderQueue() {
    const list = this.shadow.getElementById('fmd-auto-job-list');
    list.innerHTML = '';
    
    this.shadow.getElementById('fmd-auto-count').textContent = `${this.queueManager.currentIndex} / ${this.queueManager.jobs.length}`;

    this.queueManager.jobs.forEach((job, index) => {
        const item = document.createElement('div');
        item.className = 'fmd-auto-job-item';
        
        let statusColor = '#a6adc8';
        let statusText = job.status;
        
        if (job.status === 'completed') statusColor = '#a6e3a1';
        if (job.status === 'generating') statusColor = '#f9e2af';
        if (job.status === 'error' || job.status === 'timeout') statusColor = '#f38ba8';

        let actionsHtml = '';
        if (job.status === 'error' || job.status === 'timeout' || job.status === 'completed') {
            actionsHtml = `<button class="fmd-auto-retry-btn" data-id="${job.id}">Retry</button>`;
        }
        
        let mediaHtml = '';
        if (job.assets && job.assets.length > 0) {
            mediaHtml = '<div class="fmd-auto-job-media">';
            job.assets.forEach(asset => {
                mediaHtml += `<img src="${asset.url}" class="fmd-auto-preview" />`;
            });
            mediaHtml += '</div>';
        }

        let statusHtml = statusText.toUpperCase();
        if (job.status === 'generating') {
            statusHtml = `<span class="fmd-spinner" style="border-top-color: ${statusColor}"></span> GENERATING...`;
        }

        item.innerHTML = `
           <div class="fmd-auto-job-text"><strong>${job.id}</strong> ${job.prompt}</div>
           ${mediaHtml}
           <div class="fmd-auto-job-footer">
               <div class="fmd-auto-job-status" style="color: ${statusColor}; display: flex; align-items: center;">${statusHtml}</div>
               ${actionsHtml}
           </div>
        `;
        
        const retryBtn = item.querySelector('.fmd-auto-retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                job.status = 'waiting';
                job.assets = [];
                this.queueManager.saveToStorage();
                this.renderQueue();
                if (this.queueManager.isRunning) {
                   // Let the loop catch it on next pass, or force it if stalled
                   this.queueManager.processNext();
                }
            });
        }
        
        list.appendChild(item);
    });
  }

  show() {
    this.isVisible = true;
    this.container.style.display = 'flex';
    this.renderQueue();
  }

  toggle() {
    this.isVisible = !this.isVisible;
    this.container.style.display = this.isVisible ? 'flex' : 'none';
    if (this.isVisible) this.renderQueue();
  }
}

window.AutomatorPanel = AutomatorPanel;

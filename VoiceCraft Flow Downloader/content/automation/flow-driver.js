// content/automation/flow-driver.js

class FlowDriver {
  constructor(queueManager, adapter) {
    this.queueManager = queueManager;
    this.adapter = adapter;

    window.AutomatorEvents.on('JOB_STARTED', this.handleJobStart.bind(this));
  }

  async handleJobStart(job) {
    try {
      // Wait up to 10 seconds for the prompt input to appear (in case page is loading or finishing a generation)
      let inputAppeared = false;
      for (let i = 0; i < 40; i++) {
          if (this.adapter.canEnterPrompt()) {
              inputAppeared = true;
              break;
          }
          await new Promise(r => setTimeout(r, 250));
      }

      if (!inputAppeared) {
        throw new Error('Flow capabilities missing. Cannot find prompt box after waiting 10 seconds.');
      }

      job.status = 'submitting';
      window.AutomatorEvents.emit('JOB_SUBMITTED', job);

      await this.adapter.enterPrompt(job.prompt);
      await new Promise(r => setTimeout(r, 1500)); // Wait 1.5s for React to mount the Send button after typing
      // await this.adapter.clickGenerate(); // DISABLED per user request for manual manual bypass

      // VERIFY SUBMISSION: Wait for the input box to clear
      // If the extension's automated click failed (e.g. due to Home Page SPA routing), this acts as a seamless 
      // "Manual Override" window. It gives the user up to 5 minutes to manually click Send. Once clicked, the loop continues!
      let submissionConfirmed = false;
      let seenText = false; // Track if we ever saw the text in the box
      
      for (let i = 0; i < 1200; i++) { // 1200 * 250ms = 5 minutes
          await new Promise(r => setTimeout(r, 250));
          const input = this.adapter.findElement(this.adapter.selectors.promptInput);
          
          if (!input) {
              submissionConfirmed = true;
              break;
          }
          
          // Safely get text depending on if it's a textarea or contenteditable
          const currentText = (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT' ? input.value : input.textContent) || '';
          
          if (currentText.trim().length > 0) {
              seenText = true; // The text was successfully typed and is currently sitting in the box
          } else if (seenText && currentText.trim() === '') {
              // The text WAS in the box, and now it is empty. This means the user clicked Send!
              submissionConfirmed = true;
              break;
          }
      }

      if (!submissionConfirmed) {
          throw new Error('Submission failed: The prompt input did not clear after clicking Generate.');
      }

      job.status = 'generating';
      window.AutomatorEvents.emit('GENERATION_STARTED', job);
      
      // Since Google Flow might use Shadow DOM which blinds MutationObserver,
      // we'll aggressively poll the deep DOM every 1 second while generating.
      const poller = setInterval(() => {
          if (job.status !== 'generating') {
              clearInterval(poller);
              return;
          }
          if (window.FlowDetector) {
              window.FlowDetector.scan();
          }
      }, 1000);

      // Safety timeout (60 seconds)
      this.currentTimeout = setTimeout(() => {
         if (job.status === 'generating') {
             console.log(`[FlowDriver] Job ${job.id} timed out waiting for generation.`);
             job.status = 'timeout';
             window.AutomatorEvents.emit('JOB_FAILED', job);
         }
      }, 60000);

    } catch (err) {
      console.error('[FlowDriver]', err);
      job.status = 'error';
      window.AutomatorEvents.emit('JOB_FAILED', job);
    }
  }
}

window.FlowDriver = FlowDriver;

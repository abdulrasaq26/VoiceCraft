// content/automation/flow-driver.js

class FlowDriver {
  constructor(queueManager, adapter) {
    this.queueManager = queueManager;
    this.adapter = adapter;

    window.AutomatorEvents.on('JOB_STARTED', this.handleJobStart.bind(this));
  }

  async handleJobStart(job) {
    try {
      job.status = 'submitting';
      window.AutomatorEvents.emit('JOB_SUBMITTED', job);

      // 1. Get auth token
      const token = await window.TryAiBridge.callMethod('getToken');
      if (!token) throw new Error("Could not get Google Flow session token. Are you logged in?");

      // 2. Get reCAPTCHA
      const recaptcha = await window.TryAiBridge.callMethod('getRecaptcha', '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV', 'generate');
      
      const projectId = await window.TryAiBridge.callMethod('getProjectId');
      if (!projectId) throw new Error("Could not determine Project ID from URL.");

      const sessionId = ";" + Date.now() + Math.random().toString(36).slice(2);
      const clientCtx = { 
          recaptchaContext: { applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB", token: recaptcha }, 
          projectId: projectId, 
          tool: "PINHOLE", 
          sessionId: sessionId 
      };

      const payload = {
          clientContext: clientCtx,
          mediaGenerationContext: { batchId: String(Date.now()) },
          useNewMedia: true,
          requests: [{
              clientContext: clientCtx,
              imageAspectRatio: "16:9", // Default
              imageInputs: [],
              imageModelName: "imagen-3.0-generate-002",
              seed: 0,
              structuredPrompt: { parts: [{ text: job.prompt }] }
          }]
      };

      job.status = 'generating';
      window.AutomatorEvents.emit('GENERATION_STARTED', job);

      // 3. Trigger Generation via TryAiBridge API (TryAiToday injects "generate")
      const response = await window.TryAiBridge.callMethod('generate', `https://aisandbox-pa.googleapis.com/v1/projects/${projectId}/flowMedia:batchGenerateImages`, JSON.stringify(payload), token);

      if (!response.ok) {
          throw new Error('API Error: ' + (response.error || response.errText || "Unknown"));
      }

      // 4. Extract image URLs from response
      const urls = this.extractUrls(response.data);
      if (urls.length === 0) {
          throw new Error("Generation succeeded but no images were found in the response.");
      }

      // We process only the first generated image for the job, or loop through all.
      // Usually it generates 4 images per batch, but let's just grab the first one or all of them.
      for (const [index, rawUrl] of urls.entries()) {
          // 5. Clean Watermark
          job.status = 'resolving'; // Update status to show we're doing watermark math
          window.AutomatorEvents.emit('JOB_UPDATED', job);
          
          const cleanRes = await window.TryAiBridge.callMethod('cleanImageBlob', rawUrl, 'auto');
          
          if (!cleanRes || cleanRes.error) {
              console.warn("Watermark removal failed:", cleanRes ? cleanRes.error : "Unknown error");
              // Fallback to rawUrl if clean fails
          }
          
          const finalUrl = (cleanRes && cleanRes.blobUrl) ? cleanRes.blobUrl : rawUrl;
          
          // 6. Queue for Download
          const mediaId = Math.random().toString(36).substr(2, 9);
          const mediaItem = {
              id: mediaId,
              url: finalUrl,
              filename: `${job.id}-${index+1}.png`,
              title: `${job.id}-${index+1}`,
              prompt: job.prompt,
              isAutomated: true,
              project: this.queueManager.project,
              batch: this.queueManager.batch
          };
          
          // Add to job assets so index.js can find it
          if (!job.assets) job.assets = [];
          job.assets.push(mediaItem);

          chrome.runtime.sendMessage({
              action: 'download',
              mediaItem: mediaItem
          });
          
          // Wait a moment between downloads
          await new Promise(r => setTimeout(r, 500));
      }

    } catch (err) {
      console.error('[FlowDriver]', err);
      job.status = 'error';
      window.AutomatorEvents.emit('JOB_FAILED', job);
    }
  }

  extractUrls(data) {
      const urls = [];
      const findUrls = (obj) => {
          if (typeof obj === 'string' && obj.startsWith('https://') && obj.includes('googleusercontent.com')) {
              urls.push(obj);
          } else if (Array.isArray(obj)) {
              obj.forEach(findUrls);
          } else if (typeof obj === 'object' && obj !== null) {
              Object.values(obj).forEach(findUrls);
          }
      };
      findUrls(data);
      // Filter out duplicate or non-image URLs if necessary, but typical responses just have the image URLs.
      return [...new Set(urls)];
  }
}

window.FlowDriver = FlowDriver;

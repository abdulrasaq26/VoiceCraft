// content/automation/queue-manager.js

class QueueManager {
  constructor() {
    this.jobs = [];
    this.project = 'Default Project';
    this.batch = 'Batch 01';
    this.isRunning = false;
    this.isPaused = false;
    this.currentIndex = 0;
    this.currentJob = null;
  }

  async loadFromStorage() {
    const state = await window.ProjectStore.loadBatch();
    if (state) {
      this.project = state.project;
      this.batch = state.batch;
      // Rehydrate jobs
      this.jobs = state.jobs.map(j => {
        const job = new window.Job(j.id, j.type, j.prompt, j.settings);
        Object.assign(job, j);
        return job;
      });
      this.currentIndex = this.jobs.findIndex(j => j.status !== 'completed');
      if (this.currentIndex === -1) this.currentIndex = 0;
    }
  }

  async saveToStorage() {
    await window.ProjectStore.saveBatch(this.project, this.batch, this.jobs, {});
  }

  async clear() {
    this.stop();
    this.jobs = [];
    this.currentIndex = 0;
    this.currentJob = null;
    await this.saveToStorage();
    window.AutomatorEvents.emit('QUEUE_UPDATED', this.jobs);
  }

  addJobs(rawText) {
    const lines = rawText.split('\n');
    let added = 0;
    for (const line of lines) {
      const job = window.Job.parse(line);
      if (job) {
        // Avoid duplicate IDs in the same batch
        if (!this.jobs.find(j => j.id === job.id)) {
          this.jobs.push(job);
          added++;
        }
      }
    }
    this.saveToStorage();
    return added;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isPaused = false;
    window.AutomatorEvents.emit('QUEUE_RESUMED');
    this.processNext();
  }

  pause() {
    this.isPaused = true;
    window.AutomatorEvents.emit('QUEUE_PAUSED');
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    
    // If we have an active job, reset it so it doesn't get stuck in UI
    if (this.currentJob && (this.currentJob.status === 'configuring' || this.currentJob.status === 'submitting' || this.currentJob.status === 'generating')) {
        this.currentJob.status = 'waiting';
        this.saveToStorage();
    }
    
    window.AutomatorEvents.emit('QUEUE_STOPPED');
  }

  async processNext() {
    if (!this.isRunning || this.isPaused) return;

    // Find next uncompleted job
    this.currentIndex = this.jobs.findIndex(j => j.status !== 'completed' && j.status !== 'error' && j.status !== 'timeout');
    if (this.currentIndex === -1) {
      this.stop();
      return;
    }

    this.currentJob = this.jobs[this.currentIndex];
    this.currentJob.status = 'configuring';
    window.AutomatorEvents.emit('JOB_STARTED', this.currentJob);
    await this.saveToStorage();

    // FlowDriver integration goes here
  }
}

window.QueueManager = QueueManager;

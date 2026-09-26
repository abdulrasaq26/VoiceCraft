// content/automation/job.js

class Job {
  constructor(id, type, prompt, settings = {}) {
    this.id = id;
    this.type = type || 'image'; // image or video
    this.prompt = prompt;
    this.settings = settings;
    this.status = 'waiting'; // waiting, configuring, submitting, generating, resolving, downloading, completed, error, timeout
    this.attempts = 0;
    this.assets = []; // Downloaded assets for this job
  }

  static parse(text) {
    // Example: #2-33 [IMAGE] prompt text
    // Or: #2-33 prompt text
    text = text.trim();
    if (!text) return null;

    // Match ID which starts with #
    const match = text.match(/^(#[A-Za-z0-9_-]+)\s*(?:\[(IMAGE|VIDEO)\])?\s*(.*)$/is);
    if (!match) return null;

    const id = match[1];
    const type = match[2] ? match[2].toLowerCase() : 'image';
    const prompt = match[3] ? match[3].trim() : '';

    return new Job(id, type, prompt);
  }
}

window.Job = Job;

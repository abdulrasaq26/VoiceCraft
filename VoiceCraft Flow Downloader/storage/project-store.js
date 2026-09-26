// storage/project-store.js

class ProjectStore {
  static async saveBatch(project, batch, jobs, settings) {
    const state = {
      project,
      batch,
      settings,
      jobs: jobs, // array of Job objects
      lastUpdated: Date.now()
    };
    
    return new Promise((resolve) => {
      chrome.storage.local.set({ ['flow_automator_batch']: state }, () => {
        resolve(state);
      });
    });
  }

  static async loadBatch() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['flow_automator_batch'], (result) => {
        resolve(result.flow_automator_batch || null);
      });
    });
  }

  static async clearBatch() {
    return new Promise((resolve) => {
      chrome.storage.local.remove('flow_automator_batch', () => {
        resolve();
      });
    });
  }
}

window.ProjectStore = ProjectStore;

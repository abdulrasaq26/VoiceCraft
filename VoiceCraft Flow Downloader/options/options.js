document.addEventListener('DOMContentLoaded', () => {
  // Load settings
  chrome.storage.local.get({
    autoSelect: true,
    ignoreSmall: true,
    allowImages: true,
    allowVideos: true,
    baseFolder: 'Flow Downloader',
    filenameTemplate: '{title}.{ext}'
  }, (items) => {
    document.getElementById('auto-select').checked = items.autoSelect;
    document.getElementById('ignore-small').checked = items.ignoreSmall;
    document.getElementById('allow-images').checked = items.allowImages;
    document.getElementById('allow-videos').checked = items.allowVideos;
    document.getElementById('base-folder').value = items.baseFolder;
    document.getElementById('filename-template').value = items.filenameTemplate;
  });

  // Save settings
  document.getElementById('save').addEventListener('click', () => {
    const autoSelect = document.getElementById('auto-select').checked;
    const ignoreSmall = document.getElementById('ignore-small').checked;
    const allowImages = document.getElementById('allow-images').checked;
    const allowVideos = document.getElementById('allow-videos').checked;
    const baseFolder = document.getElementById('base-folder').value.trim();
    const filenameTemplate = document.getElementById('filename-template').value.trim();

    chrome.storage.local.set({
      autoSelect,
      ignoreSmall,
      allowImages,
      allowVideos,
      baseFolder,
      filenameTemplate
    }, () => {
      const status = document.getElementById('status');
      status.textContent = 'Settings saved!';
      setTimeout(() => status.textContent = '', 2000);
    });
  });
});

// background/offscreen.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'createBlobUrl') {
    try {
      // request.data is a Data URI like "data:image/png;base64,iVBORw..."
      const parts = request.data.split(',');
      const mime = parts[0].match(/:(.*?);/)[1];
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const blob = new Blob([u8arr], { type: mime });
      const url = URL.createObjectURL(blob);
      
      sendResponse({ url: url });
    } catch (e) {
      console.error(e);
      sendResponse({ error: e.message });
    }
    return true; // Keep response channel open
  }
});

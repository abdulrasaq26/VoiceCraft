document.addEventListener('DOMContentLoaded', () => {
  const btnScan = document.getElementById('btn-scan');

  btnScan.addEventListener('click', async () => {
    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'scan' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Could not send message:", chrome.runtime.lastError);
          if (chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
              if (confirm("The extension was recently updated. The page needs to be refreshed to reconnect to VoiceCraft Flow Downloader.\n\nRefresh page now?")) {
                  chrome.tabs.reload(tab.id);
                  window.close();
              }
          } else {
              alert("Error: " + chrome.runtime.lastError.message);
          }
          return;
        }
        // Close popup after starting scan
        window.close();
      });
    }
  });

  const btnAutomator = document.getElementById('btn-automator');
  if (btnAutomator) {
    btnAutomator.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: 'toggle_automator' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Could not send message:", chrome.runtime.lastError);
            if (chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                if (confirm("The extension was recently updated. The page needs to be refreshed to reconnect to VoiceCraft Flow Downloader.\n\nRefresh page now?")) {
                    chrome.tabs.reload(tab.id);
                    window.close();
                }
            } else {
                alert("Error: " + chrome.runtime.lastError.message);
            }
            return;
          }
          window.close();
        });
      }
    });
  }

  const btnRecovery = document.getElementById('btn-recovery');
  if (btnRecovery) {
    btnRecovery.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: 'toggle_recovery' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Could not send message:", chrome.runtime.lastError);
            if (chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                if (confirm("The extension was recently updated. The page needs to be refreshed to reconnect to VoiceCraft Flow Downloader.\n\nRefresh page now?")) {
                    chrome.tabs.reload(tab.id);
                    window.close();
                }
            } else {
                alert("Error: " + chrome.runtime.lastError.message);
            }
            return;
          }
          window.close();
        });
      }
    });
  }
});

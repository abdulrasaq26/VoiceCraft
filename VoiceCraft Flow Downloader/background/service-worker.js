// background/service-worker.js
importScripts('network-observer.js', 'download-manager.js');

class StorageManager {
  static async save(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    });
  }

  static async get(key, defaultValue = null) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] !== undefined ? result[key] : defaultValue);
      });
    });
  }
}
self.StorageManager = StorageManager;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'downloadSelected') {
    const tabId = sender.tab ? sender.tab.id : null;
    self.downloadManager.enqueue(message.items, tabId);
    sendResponse({ status: 'queued', count: message.items.length });
  }

  // Used by the Automator pipeline
  if (message.action === 'download') {
    const tabId = sender.tab ? sender.tab.id : null;
    self.downloadManager.enqueue([message.mediaItem], tabId);
    sendResponse({ status: 'queued' });
  }

  if (message.action === 'executeMainWorld') {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: 'MAIN',
        func: mainWorldBypass,
        args: [message.payload]
      }).then(() => {
        sendResponse({ status: 'success' });
      }).catch(err => {
        sendResponse({ status: 'error', error: err.toString() });
      });
      return true; // Keep message channel open
    }
  }
});

function mainWorldBypass(payload) {
    const action = payload.action;
    const text = payload.text;
    const inputId = payload.inputId;
    const btnId = payload.btnId;
    
    if (action === 'enterPrompt') {
        const input = document.getElementById(inputId);
        if (!input) return;
        
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', text);
        input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboardData }));

        input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
        
        if (!input.isContentEditable) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
            if (input.tagName === 'TEXTAREA' && nativeTextAreaValueSetter) {
                nativeTextAreaValueSetter.call(input, text);
            } else if (nativeInputValueSetter) {
                nativeInputValueSetter.call(input, text);
            } else {
                input.value = text;
            }
            input.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
        }
    }
    
    if (action === 'clickGenerate') {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        
        const svg = btn.querySelector('svg') || btn.firstElementChild;
        const createClick = (type) => new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 });
        
        const findFiber = (el) => {
            let key = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
            return key ? el[key] : null;
        };
        
        let fiber = findFiber(btn) || (svg && findFiber(svg));
        if (fiber) {
            let maxDepth = 15;
            while (fiber && maxDepth > 0) {
                const props = fiber.pendingProps || fiber.memoizedProps;
                if (props) {
                    if (typeof props.onClick === 'function') props.onClick(createClick('click'));
                    if (typeof props.onSubmit === 'function') props.onSubmit(new Event('submit', { bubbles: true }));
                    if (typeof props.onPointerDown === 'function') props.onPointerDown(createClick('pointerdown'));
                }
                fiber = fiber.return;
                maxDepth--;
            }
        }

        const rect = btn.getBoundingClientRect();
        try {
            const touch = new Touch({ identifier: Date.now(), target: btn, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2, radiusX: 2.5, radiusY: 2.5, rotationAngle: 0, force: 1 });
            btn.dispatchEvent(new TouchEvent('touchstart', { cancelable: true, bubbles: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
            btn.dispatchEvent(new TouchEvent('touchend', { cancelable: true, bubbles: true, touches: [], targetTouches: [], changedTouches: [touch] }));
        } catch(e) {}

        if (inputId) {
            const exactInput = document.getElementById(inputId);
            if (exactInput) {
                const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
                exactInput.dispatchEvent(enter);
            }
        }

        // Prevent the browser from naturally submitting the form if React ignores the untrusted click!
        const originalType = btn.getAttribute('type');
        btn.setAttribute('type', 'button'); // Temporarily neutralize submit buttons
        
        btn.dispatchEvent(createClick('pointerdown'));
        btn.dispatchEvent(createClick('mousedown'));
        btn.dispatchEvent(createClick('click')); // Synthetic click (safe, no native navigation!)
        btn.dispatchEvent(createClick('mouseup'));
        btn.dispatchEvent(createClick('pointerup'));
        
        if (originalType) {
            btn.setAttribute('type', originalType);
        }
    }
}

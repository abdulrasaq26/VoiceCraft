// content/automation/flow-adapter.js

class AutomatorAdapter {
  constructor() {
    this.selectors = window.FlowSelectors;
  }

  findElement(selector) {
    if (typeof selector === 'function') {
      return selector();
    }
    return document.querySelector(selector);
  }

  // --- Capabilities ---
  canEnterPrompt() {
    return !!this.findElement(this.selectors.promptInput);
  }

  canGenerate() {
    // In Agent Mode, if there's no visible send button, we can press Enter.
    return true;
  }

  canSelectModel() {
    return !!this.findElement(this.selectors.modelSelector);
  }

  canSelectAspectRatio() {
    return !!this.findElement(this.selectors.aspectRatioSelector);
  }

  // --- Actions ---
  async enterPrompt(text) {
    let input = this.findElement(this.selectors.promptInput);
    if (!input) {
        alert("FLOW AUTOMATOR ERROR: Could not find the Prompt Input box on the page!");
        throw new Error('Prompt input not found');
    }
    
    // VISUAL DEBUGGING: Outline the element being typed into
    input.style.border = "5px solid #ff00ff";
    input.style.boxShadow = "0 0 20px #ff00ff";
    console.log("[FlowDriver] Found Prompt Input:", input);
    
    // Simulate physical clicks to wake up Lexical editor or dummy placeholders
    input.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    input.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    
    input.focus();
    
    // Wait for React to swap the dummy placeholder for the real contenteditable
    await new Promise(r => setTimeout(r, 200));
    
    // Re-query the input in case the DOM node was completely swapped!
    const realInput = this.findElement(this.selectors.promptInput);
    if (realInput && realInput !== input) {
        console.log("[FlowDriver] Detected React DOM swap! Updating target to new input node.");
        input.style.border = "";
        input.style.boxShadow = "";
        input = realInput;
        input.style.border = "5px solid #00ff00"; // Green for the REAL input
        input.style.boxShadow = "0 0 20px #00ff00";
        input.focus();
    }
    
    // Force DOM selection into the element so Lexical knows where to paste
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    selection.removeAllRanges();
    selection.addRange(range);
    
    // Clear safely
    if (input.isContentEditable) {
      document.execCommand('delete', false, null);
    } else {
      input.value = '';
    }
    
    // Bypass React/Vue with native paste simulation
    const success = document.execCommand('insertText', false, text);
    
    // ULTIMATE FAILSAFE: Copy the prompt to the user's OS clipboard
    // If Lexical aggressively blocks every JS injection, the user can just press Ctrl+V!
    try {
        await navigator.clipboard.writeText(text);
        console.log("[FlowDriver] Copied prompt to OS clipboard as failsafe");
    } catch(e) {}
    
    // Dispatch events in the Isolated world
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboardData }));

    input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Force text if it didn't work natively
    const currentText = input.tagName === 'TEXTAREA' || input.tagName === 'INPUT' ? input.value : input.textContent;
    if (!success || currentText.trim() === '') {
        console.log("[FlowDriver] Native insert failed, forcefully injecting text into DOM");
        if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
            const setter = Object.getOwnPropertyDescriptor(window[input.tagName === 'TEXTAREA' ? 'HTMLTextAreaElement' : 'HTMLInputElement'].prototype, "value")?.set;
            if (setter) setter.call(input, text);
            else input.value = text;
        } else {
            let target = input;
            const p = input.querySelector('p');
            if (p) target = p;
            target.textContent = text;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
    }
  }

  async clickGenerate() {
    const btn = this.findElement(this.selectors.generateButton);
    const input = this.findElement(this.selectors.promptInput);
    
    // ALWAYS try Enter key first (Agent Mode standard)
    if (input) {
        console.log('[FlowDriver] Sending Enter key to prompt input...');
        const enterEventDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
        const enterEventPress = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
        const enterEventUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
        
        input.dispatchEvent(enterEventDown);
        input.dispatchEvent(enterEventPress);
        input.dispatchEvent(enterEventUp);
    }
    
    // Give it a tiny delay to see if Enter worked
    await new Promise(r => setTimeout(r, 150));

    if (btn) {
        console.log("[FlowDriver] Found Submit Button:", btn);
        btn.style.border = "5px solid #00ff00";
        btn.style.boxShadow = "0 0 20px #00ff00";
        
        btn.id = btn.id || 'fmd-target-btn-' + Date.now();
        if (input && !input.id) input.id = 'fmd-prompt-input-' + Date.now();
        
        // Send to Background Worker to execute in the MAIN world safely
        try {
            await new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    action: 'executeMainWorld',
                    payload: { action: 'clickGenerate', btnId: btn.id, inputId: input ? input.id : null }
                }, (response) => resolve(response));
            });
        } catch(e) {
            console.error("[FlowDriver] Background script communication failed", e);
        }

    } else if (!input) {
        alert("FLOW AUTOMATOR ERROR: Could not find Generate button AND could not find Prompt Input!");
        throw new Error('Generate button not found AND prompt input not found.');
    }
  }
}

window.FlowAutomatorAdapter = AutomatorAdapter;

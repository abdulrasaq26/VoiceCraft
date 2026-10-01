// content/automation/automator-adapter.js
//
// Types into Flow's prompt box and presses its Generate control, the way a
// person would. Flow's editor is a React/Lexical contenteditable that ignores
// plain value assignment, so text goes in through the editing commands it
// listens to, with fallbacks for textarea/input variants. Errors are thrown
// for the engine to report — nothing here alerts, styles the page or touches
// the clipboard.

class AutomatorAdapter {
  constructor() {
    this.selectors = window.FlowSelectors;
  }

  findElement(selector) {
    return typeof selector === 'function' ? selector() : document.querySelector(selector);
  }

  canEnterPrompt() {
    return !!this.findElement(this.selectors.promptInput);
  }

  async enterPrompt(text) {
    let input = this.findElement(this.selectors.promptInput);
    if (!input) throw new Error("Couldn't find Flow's prompt box.");

    // Wake the editor: Flow can swap a placeholder for the real editor on focus.
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      input.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    }
    input.focus();
    await new Promise((r) => setTimeout(r, 200));
    const swapped = this.findElement(this.selectors.promptInput);
    if (swapped && swapped !== input) { input = swapped; input.focus(); }

    const isField = input.tagName === 'TEXTAREA' || input.tagName === 'INPUT';
    const current = () => (isField ? input.value : input.textContent) || '';

    // Select everything in the box and replace it.
    if (isField) {
      input.select();
    } else {
      const range = document.createRange();
      range.selectNodeContents(input);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    let ok = document.execCommand('insertText', false, text);

    // Editors that ignore execCommand usually accept a paste.
    if (!ok || !current().includes(text.slice(0, 20))) {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
      await new Promise((r) => setTimeout(r, 50));
    }

    // Last resort: set the value/text directly and announce the change.
    if (!current().includes(text.slice(0, 20))) {
      if (isField) {
        const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value');
        if (setter && setter.set) setter.set.call(input, text); else input.value = text;
      } else {
        (input.querySelector('p') || input).textContent = text;
      }
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  // Submit exactly once. `method`:
  //   'button' — one click on Flow's Generate button (default)
  //   'enter'  — press Enter in the prompt box
  //   'compat' — the older page-world click, for if Flow ignores the others
  //              (it tries several routes, so may submit more than once)
  async clickGenerate(method = 'button') {
    const input = this.findElement(this.selectors.promptInput);
    const btn = this.findElement(this.selectors.generateButton);
    if (method === 'button' && !btn) method = 'enter';
    if (method === 'enter' && !input) throw new Error("Couldn't find Flow's Generate button.");

    if (method === 'button') {
      btn.click();
    } else if (method === 'enter') {
      input.focus();
      for (const type of ['keydown', 'keypress', 'keyup']) {
        input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      }
    } else {
      if (!btn) throw new Error("Couldn't find Flow's Generate button.");
      btn.id = btn.id || 'fmd-target-btn-' + Date.now();
      if (input && !input.id) input.id = 'fmd-prompt-input-' + Date.now();
      await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(
            { action: 'executeMainWorld', payload: { action: 'clickGenerate', btnId: btn.id, inputId: input ? input.id : null } },
            (response) => resolve(response),
          );
        } catch (e) { resolve(null); }
      });
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

window.FlowAutomatorAdapter = AutomatorAdapter;

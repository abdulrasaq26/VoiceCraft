window.FlowSelectors = {
  promptInput: () => {
    const isVisible = (el) => {
      // Ignore extension's own elements!
      if (el.id && el.id.startsWith('fmd-')) return false;
      if (el.closest && el.closest('.fmd-automator-container')) return false;
      if (el.closest && el.closest('#flow-media-downloader-host')) return false;

      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 10 && rect.height > 10 && style.visibility !== 'hidden' && style.opacity !== '0';
    };

    const queryDeep = (selector, root = document) => {
      let results = Array.from(root.querySelectorAll(selector));
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.shadowRoot && node.id !== 'flow-media-downloader-host') {
          results = results.concat(queryDeep(selector, node.shadowRoot));
        }
      }
      return results;
    };

    const isSearch = (el) => {
        const p = (el.getAttribute('placeholder') || '').toLowerCase();
        const a = (el.getAttribute('aria-label') || '').toLowerCase();
        const className = (el.className || '').toString().toLowerCase();
        return p.includes('search') || a.includes('search') || className.includes('search');
    };

    // 1. Visible Textareas (Not Search)
    const textareas = queryDeep('textarea').filter(el => isVisible(el) && !isSearch(el));
    if (textareas.length > 0) {
       return textareas.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
    }
    
    // 2. Visible ContentEditables (Not Search)
    let editables = queryDeep('[contenteditable="true"]').filter(el => isVisible(el) && !isSearch(el));
    if (editables.length > 0) {
       // Sort by top descending (get the lowest one on the page)
       editables = editables.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
       let target = editables[0];
       // If the contenteditable has another contenteditable inside it, get the deepest one
       const inner = target.querySelector('[contenteditable="true"]');
       if (inner) target = inner;
       return target;
    }
    
    // 3. Visible Inputs (Not Search)
    const inputs = queryDeep('input[type="text"]').filter(el => isVisible(el) && !isSearch(el));
    if (inputs.length > 0) return inputs[inputs.length - 1];
    
    // 4. Role Textbox
    let roleTextboxes = queryDeep('[role="textbox"]').filter(el => isVisible(el) && !isSearch(el));
    if (roleTextboxes.length > 0) {
       roleTextboxes = roleTextboxes.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
       return roleTextboxes[0];
    }
    
    // 5. Placeholder text scan (The ultimate fallback for dummy React buttons)
    // "What do you want to create"
    const allDivs = queryDeep('div, span, button, p');
    for (const el of allDivs) {
        if (isVisible(el) && !isSearch(el)) {
            const text = (el.textContent || '').trim().toLowerCase();
            if (text.includes('what do you want to create') || text.includes('prompt') || text.includes('message')) {
                // If it's a huge wrapper, ignore it
                const rect = el.getBoundingClientRect();
                if (rect.height > 10 && rect.height < 150) {
                    return el;
                }
            }
        }
    }
    
    return null;
  },
  generateButton: () => {
    const queryDeep = (selector, root = document) => {
      let results = Array.from(root.querySelectorAll(selector));
      results = results.filter(el => {
          if (el.id && el.id.startsWith('fmd-')) return false;
          if (el.className && typeof el.className === 'string' && el.className.includes('fmd-')) return false;
          return true;
      });
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.shadowRoot && node.id !== 'flow-media-downloader-host') {
          results = results.concat(queryDeep(selector, node.shadowRoot));
        }
      }
      return results;
    };

    // Broaden clickable selector because modern apps use weird tags for buttons
    const clickableSelector = 'button, div[role="button"], span[role="button"], a[role="button"], [aria-label*="send" i], [aria-label*="submit" i]';
    const buttons = queryDeep(clickableSelector);
    
    // 1. Explicit Generate button
    const genBtn = buttons.find(b => b.textContent && b.textContent.toLowerCase().includes('generate'));
    if (genBtn) return genBtn;
    
    // 2. Spatial Fallback: Find the button closest to the prompt input! (Most robust method)
    const input = window.FlowSelectors.promptInput();
    if (input) {
        let container = input.parentElement;
        for (let i = 0; i < 15; i++) { // Increased to 15 levels to account for deep React DOMs!
            if (!container) break;
            // Also include SVGs in the spatial search if they are clickable icons
            const containerButtons = Array.from(container.querySelectorAll(`${clickableSelector}, svg`)).filter(b => {
                const l = (b.getAttribute('aria-label') || '').toLowerCase();
                const t = (b.getAttribute('title') || '').toLowerCase();
                if (l.includes('expand') || t.includes('expand')) return false;
                if (l.includes('maximize') || t.includes('maximize')) return false;
                if (l.includes('upload') || t.includes('upload')) return false;
                if (l.includes('attach') || t.includes('attach')) return false;
                if (l.includes('setting') || t.includes('setting')) return false;
                if (l.includes('history') || t.includes('history')) return false;
                if (l.includes('agent') || t.includes('agent')) return false;
                if (l.includes('home') || t.includes('home')) return false;
                if (l.includes('back') || t.includes('back')) return false;
                if (l.includes('more') || t.includes('more')) return false; // Block 3-dots menu!
                if (l.includes('menu') || t.includes('menu')) return false;
                if (l.includes('option') || t.includes('option')) return false;
                
                // SVG filter
                const rect = b.getBoundingClientRect();
                if (rect.width > 100 || rect.height > 100) return false;
                if (rect.width < 5 || rect.height < 5) return false;
                
                // Don't click the input box itself
                if (b === input || b.contains(input)) return false;

                return true;
            });
            
            // We want to find the localized button group next to the input
            if (containerButtons.length > 0 && containerButtons.length < 15) {
                let targetBtn = containerButtons[0];
                let minDistance = 999999;
                
                const inputRect = input.getBoundingClientRect();
                const inputCenterX = inputRect.left + (inputRect.width / 2);
                const inputCenterY = inputRect.top + (inputRect.height / 2);

                containerButtons.forEach(b => {
                    const rect = b.getBoundingClientRect();
                    const btnCenterX = rect.left + (rect.width / 2);
                    const btnCenterY = rect.top + (rect.height / 2);
                    
                    // Calculate absolute distance from input box
                    const distance = Math.sqrt(
                        Math.pow(btnCenterX - inputCenterX, 2) + 
                        Math.pow(btnCenterY - inputCenterY, 2)
                    );
                    
                    // Give priority to elements explicitly labeled "send" or "submit"
                    const isExplicit = (b.getAttribute('aria-label') || '').toLowerCase().includes('send') || (b.getAttribute('title') || '').toLowerCase().includes('send');
                    
                    // Subtract massive distance if it explicitly says send (making it win)
                    const adjustedDistance = isExplicit ? (distance - 5000) : distance; 
                    
                    // We want the SHORTEST distance
                    if (adjustedDistance < minDistance) {
                        minDistance = adjustedDistance;
                        targetBtn = b;
                    }
                });
                return targetBtn;
            }
            container = container.parentElement;
        }
    }

    // 3. Agent Mode Send/Submit button by aria-label (Global Fallback)
    const sendBtn = buttons.find(b => {
       const label = (b.getAttribute('aria-label') || '').toLowerCase();
       const title = (b.getAttribute('title') || '').toLowerCase();
       
       const matches = (str) => {
           const words = str.split(/[\s,.-]+/);
           return words.includes('send') || words.includes('submit') || 
                  words.includes('generate') || (words.includes('create') && !words.includes('project'));
       };
       return matches(label) || matches(title);
    });
    if (sendBtn) return sendBtn;

    // 4. Fallback: looking for a submit button globally
    const submitBtns = queryDeep('button[type="submit"]');
    if (submitBtns.length > 0) return submitBtns[0];
    
    return null;
  },
  modelSelector: 'button[aria-label*="model" i]',
  aspectRatioSelector: 'button[aria-label*="aspect" i]'
};

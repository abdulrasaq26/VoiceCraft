class TryAiBridge {
    constructor() {
        this.injected = false;
        this.resolvers = new Map();
        
        window.addEventListener('FMD_TRYAI_RES', (e) => {
            const { reqId, data, error } = e.detail;
            const resolver = this.resolvers.get(reqId);
            if (resolver) {
                if (error) resolver.reject(new Error(error));
                else resolver.resolve(data);
                this.resolvers.delete(reqId);
            }
        });
    }

    async init() {
        if (this.injected) return;
        
        await this.injectScript(chrome.runtime.getURL('TryAiToday/0.4.7_0/inject.js'));
        await this.injectScript(chrome.runtime.getURL('TryAiToday/0.4.7_0/wm.js'));
        
        const bridgeScript = document.createElement('script');
        bridgeScript.textContent = `
            window.addEventListener('FMD_TRYAI_REQ', async (e) => {
                const { reqId, method, args } = e.detail;
                try {
                    if (!globalThis.__inj) throw new Error("__inj not found");
                    if (typeof globalThis.__inj[method] !== 'function') throw new Error("Method not found: " + method);
                    
                    const result = await globalThis.__inj[method](...args);
                    window.dispatchEvent(new CustomEvent('FMD_TRYAI_RES', { detail: { reqId, data: result } }));
                } catch (err) {
                    window.dispatchEvent(new CustomEvent('FMD_TRYAI_RES', { detail: { reqId, error: err.message || err } }));
                }
            });
        `;
        document.documentElement.appendChild(bridgeScript);
        this.injected = true;
    }

    injectScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error("Failed to load script: " + src));
            document.documentElement.appendChild(s);
        });
    }

    async callMethod(method, ...args) {
        await this.init();
        return new Promise((resolve, reject) => {
            const reqId = Math.random().toString(36).substr(2, 9);
            this.resolvers.set(reqId, { resolve, reject });
            window.dispatchEvent(new CustomEvent('FMD_TRYAI_REQ', { detail: { reqId, method, args } }));
        });
    }
}
window.TryAiBridge = new TryAiBridge();

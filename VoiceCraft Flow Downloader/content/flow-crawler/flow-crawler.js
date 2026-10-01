// content/flow-crawler/flow-crawler.js
//
// Walks the whole Flow project so every asset is seen at least once — no
// manual scrolling. Everything it finds goes into the shared registry
// (content/detection/media-registry.js), which de-duplicates it.
//
//   start at the top → inspect → scroll a step → wait for lazy content to
//   settle → inspect → … → stop when we're at the bottom, the page stopped
//   growing and nothing new turned up.
//
// States: scanning | waiting | processing | complete | stopped | error
// (Older callers read the upper-case names; `stats.state` keeps those.)

class FlowCrawler {
    constructor(detector, registry) {
        this.detector = detector;
        this.registry = registry;
        this.status = 'idle';
        this.isRunning = false;
        this.subscribers = new Set();
        this.steps = 0;
        this.found = 0;
        this.error = null;
    }

    subscribe(callback) { this.subscribers.add(callback); }
    unsubscribe(callback) { this.subscribers.delete(callback); }

    get state() {
        return ({ idle: 'IDLE', scanning: 'SCANNING', waiting: 'WAITING_FOR_CONTENT', processing: 'VERIFYING',
            complete: 'COMPLETE', stopped: 'STOPPED', error: 'ERROR' })[this.status] || 'IDLE';
    }

    stats() {
        return {
            state: this.state, status: this.status, running: this.isRunning,
            discovered: this.registry.size, named: this.registry.named,
            newThisRun: this.registry.size - this.startCount, steps: this.steps, error: this.error,
        };
    }

    notify(status) {
        if (status) this.status = status;
        const s = this.stats();
        for (const cb of [...this.subscribers]) { try { cb(s); } catch (e) { console.warn('[FlowCrawler]', e); } }
    }

    sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

    // The element that scrolls Flow's media grid: the scrollable area holding
    // the most pictures (falls back to the page itself).
    findScroller() {
        const page = document.scrollingElement || document.documentElement;
        let best = page;
        let bestScore = page.scrollHeight > page.clientHeight + 4 ? page.querySelectorAll('img, video').length * 0.5 : 0;
        for (const el of document.querySelectorAll('div, main, section')) {
            if (el.scrollHeight <= el.clientHeight + 4 || el.clientHeight < 150) continue;
            const oy = getComputedStyle(el).overflowY;
            if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
            const score = el.querySelectorAll('img, video').length * 2 + (el.clientWidth * el.clientHeight) / 1e6;
            if (score > bestScore) { bestScore = score; best = el; }
        }
        return best;
    }

    metrics(el) {
        const page = el === document.scrollingElement || el === document.documentElement;
        return {
            top: page ? window.scrollY : el.scrollTop,
            height: page ? document.documentElement.scrollHeight : el.scrollHeight,
            view: page ? window.innerHeight : el.clientHeight,
        };
    }

    scrollTo(el, top) {
        const page = el === document.scrollingElement || el === document.documentElement;
        if (page) window.scrollTo({ top, behavior: 'auto' });
        else el.scrollTop = top;
        // Some virtualised grids only react to scroll events, not to scrollTop.
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
    }

    // Wait until the page stops changing (new tiles, images finishing) or
    // `max` ms pass — lazy content gets time to arrive without fixed sleeps.
    async settle(max = 2500, quiet = 350) {
        let last = Date.now();
        const mo = new MutationObserver(() => { last = Date.now(); });
        mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'style'] });
        const t0 = Date.now();
        try {
            while (Date.now() - t0 < max) {
                await this.sleep(120);
                const loading = [...document.images].some((img) => !img.complete && img.getBoundingClientRect().top < window.innerHeight * 1.5);
                if (!loading && Date.now() - last >= quiet) return;
            }
        } finally { mo.disconnect(); }
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.error = null;
        this.steps = 0;
        this.registry.checkProject();
        this.startCount = this.registry.size;
        this.notify('scanning');

        const MAX_STEPS = 1500;
        let scroller = this.findScroller();
        const startTop = this.metrics(scroller).top;
        try {
            // From the very top, so nothing above the current position is missed.
            this.scrollTo(scroller, 0);
            this.notify('waiting');
            await this.settle(2000);

            let quietAtBottom = 0;
            let stuck = 0;
            while (this.isRunning && this.steps < MAX_STEPS) {
                this.steps++;
                this.notify('scanning');
                const before = this.registry.size;
                this.detector.scan();
                const m = this.metrics(scroller);
                const atBottom = m.top + m.view >= m.height - 4;

                if (atBottom) {
                    // Flow may still append more: give it time, then look again.
                    this.notify('waiting');
                    await this.settle(3000, 600);
                    this.notify('processing');
                    this.detector.scan();
                    const grown = this.metrics(scroller).height > m.height + 4;
                    const newAssets = this.registry.size > before;
                    quietAtBottom = grown || newAssets ? 0 : quietAtBottom + 1;
                    if (quietAtBottom >= 2) break; // stable boundary: done
                    if (!grown) continue;
                } else {
                    quietAtBottom = 0;
                }

                // Next step: most of a screen, keeping an overlap so tiles on
                // the edge are seen whole at least once.
                const target = Math.min(m.top + Math.max(200, m.view * 0.8), m.height);
                this.scrollTo(scroller, target);
                this.notify('waiting');
                await this.settle();
                if (Math.abs(this.metrics(scroller).top - m.top) < 2 && !atBottom) {
                    // Didn't move: the grid may scroll in another element.
                    if (++stuck >= 3) {
                        const other = this.findScroller();
                        if (other === scroller) break; // nothing else scrolls: that's the boundary
                        scroller = other;
                        stuck = 0;
                    }
                } else stuck = 0;
            }
            // One last look at the end.
            this.detector.scan();
            this.isRunning = false;
            this.notify(this.status === 'stopped' ? 'stopped' : 'complete');
        } catch (e) {
            this.isRunning = false;
            this.error = e && e.message ? e.message : String(e);
            this.notify('error');
        } finally {
            // Put the page back where the user had it.
            try { this.scrollTo(scroller, startTop); } catch (e) { /* page changed */ }
        }
    }

    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.status = 'stopped';
        this.notify();
    }
}
window.FlowCrawler = FlowCrawler;

// content/flow-crawler/flow-crawler.js

class FlowCrawler {
    constructor(detector, tray) {
        this.detector = detector;
        this.tray = tray;
        this.state = 'IDLE';
        this.isRunning = false;
        this.subscribers = new Set();
    }

    subscribe(callback) {
        this.subscribers.add(callback);
    }

    unsubscribe(callback) {
        this.subscribers.delete(callback);
    }

    notify() {
        const stats = {
            state: this.state,
            discovered: this.tray.mediaItems.size
        };
        for (const cb of this.subscribers) {
            cb(stats);
        }
    }

    getScrollContainer() {
        let best = document.scrollingElement || document.documentElement;
        let maxArea = 0;

        const elements = document.querySelectorAll('div, main, section');
        for (const el of elements) {
            const style = window.getComputedStyle(el);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                if (el.scrollHeight > el.clientHeight) {
                    const area = el.clientWidth * el.clientHeight;
                    if (area > maxArea) {
                        maxArea = area;
                        best = el;
                    }
                }
            }
        }
        return best;
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.state = 'STARTING';
        this.notify();

        const container = this.getScrollContainer();
        let previousCount = this.tray.mediaItems.size;
        let unchangedPasses = 0;
        let bottomHits = 0;

        while (this.isRunning) {
            this.state = 'SCANNING';
            this.notify();
            this.detector.scan();
            
            await this.sleep(400);
            
            const currentCount = this.tray.mediaItems.size;
            if (currentCount > previousCount) {
                unchangedPasses = 0;
                previousCount = currentCount;
            } else {
                unchangedPasses++;
            }

            // Sync with Prompt Recovery if it's active
            if (window.GenerationReconcilerInstance) {
                window.GenerationReconcilerInstance.reconcile();
            }
            this.notify(); 

            const scrollTop = container === document.scrollingElement ? window.scrollY : container.scrollTop;
            const scrollHeight = container === document.scrollingElement ? document.documentElement.scrollHeight : container.scrollHeight;
            const clientHeight = container === document.scrollingElement ? window.innerHeight : container.clientHeight;

            if (scrollTop + clientHeight >= scrollHeight - 50) {
                bottomHits++;
            } else {
                bottomHits = 0;
            }

            if (bottomHits >= 2 && unchangedPasses >= 2) {
                this.state = 'VERIFYING';
                this.notify();
                this.detector.scan();
                await this.sleep(1500);
                
                if (this.tray.mediaItems.size === previousCount) {
                    this.state = 'COMPLETE';
                    this.isRunning = false;
                    this.notify();
                    
                    if (window.GenerationReconcilerInstance) {
                        window.GenerationReconcilerInstance.reconcile();
                    }
                    break;
                } else {
                    previousCount = this.tray.mediaItems.size;
                    unchangedPasses = 0;
                    bottomHits = 0;
                }
            }

            if (!this.isRunning) break;

            this.state = 'SCROLLING';
            this.notify();
            
            const scrollAmount = clientHeight * 0.75;
            if (container === document.scrollingElement) {
                window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
            } else {
                container.scrollBy({ top: scrollAmount, behavior: 'smooth' });
            }

            this.state = 'WAITING_FOR_CONTENT';
            this.notify();
            await this.sleep(1200);
        }
    }

    stop() {
        this.isRunning = false;
        if (this.state !== 'COMPLETE') {
            this.state = 'STOPPED';
        }
        this.notify();
    }
}
window.FlowCrawler = FlowCrawler;

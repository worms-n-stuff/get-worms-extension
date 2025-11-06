/**
 * observer-adapter.ts
 * -----------------------------------------------------------------------------
 * Encapsulates DOM observers and scroll/resize/mutation wiring for PageWorms.
 *
 * Responsibilities:
 *   - Wire window + document listeners that request rerenders.
 *   - Maintain a host ResizeObserver that keeps overlay boxes aligned.
 *   - Expose a simple API so PageWorms can start/stop observation on demand.
 */
class BrowserObserverAdapter {
    constructor() {
        this.scheduleRender = null;
        this.isManagedNode = null;
        this.resizeObserver = null;
        this.mutationObserver = null;
        this.hostObserver = null;
        this.scrollTimer = null;
        this.handleScroll = () => {
            const root = document.documentElement;
            if (!root.classList.contains("pp-scrolling"))
                root.classList.add("pp-scrolling");
            if (this.scrollTimer)
                clearTimeout(this.scrollTimer);
            this.scrollTimer = setTimeout(() => root.classList.remove("pp-scrolling"), 140);
        };
    }
    start(options) {
        this.stop();
        this.scheduleRender = options.scheduleRender;
        this.isManagedNode = options.isManagedNode;
        const scheduleRender = this.scheduleRender;
        if (!scheduleRender)
            return;
        window.addEventListener("resize", scheduleRender);
        window.addEventListener("scroll", this.handleScroll, {
            passive: true,
            capture: true,
        });
        this.resizeObserver = new ResizeObserver(() => {
            this.scheduleRender?.();
        });
        this.resizeObserver.observe(document.documentElement);
        this.mutationObserver = new MutationObserver((entries) => {
            if (!this.scheduleRender || !this.isManagedNode)
                return;
            if (entries.length === 0)
                return;
            for (const record of entries) {
                if (this.isManagedNode(record.target) ||
                    [...record.addedNodes].some((node) => this.isManagedNode(node)) ||
                    [...record.removedNodes].some((node) => this.isManagedNode(node))) {
                    continue;
                }
                this.scheduleRender();
                break;
            }
        });
        const body = document.body;
        if (body) {
            this.mutationObserver.observe(body, {
                childList: true,
                subtree: true,
            });
        }
    }
    stop() {
        if (this.scheduleRender) {
            window.removeEventListener("resize", this.scheduleRender);
        }
        window.removeEventListener("scroll", this.handleScroll, { capture: true });
        this.resizeObserver?.disconnect();
        this.mutationObserver?.disconnect();
        this.disconnectHostObserver();
        if (this.scrollTimer) {
            clearTimeout(this.scrollTimer);
            this.scrollTimer = null;
        }
        this.resizeObserver = null;
        this.mutationObserver = null;
        this.scheduleRender = null;
        this.isManagedNode = null;
    }
    observeHost(host) {
        const observer = this.ensureHostObserver();
        observer.observe(host);
    }
    disconnectHostObserver() {
        this.hostObserver?.disconnect();
        this.hostObserver = null;
    }
    ensureHostObserver() {
        if (!this.hostObserver) {
            this.hostObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const hostEl = entry.target;
                    if (!(hostEl instanceof HTMLElement))
                        continue;
                    const containerEl = hostEl.parentElement;
                    if (!containerEl)
                        continue;
                    const box = containerEl.querySelector(`:scope > .pp-box[data-for='${hostEl.dataset.ppId}']`);
                    if (!box)
                        continue;
                    box.style.width = hostEl.offsetWidth + "px";
                    box.style.height = hostEl.offsetHeight + "px";
                    box.style.left = hostEl.offsetLeft + "px";
                    box.style.top = hostEl.offsetTop + "px";
                }
            });
        }
        return this.hostObserver;
    }
}
export function createObserverAdapter() {
    return new BrowserObserverAdapter();
}

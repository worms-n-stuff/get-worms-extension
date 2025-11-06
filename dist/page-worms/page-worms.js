/**
 * page-worms.ts
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Orchestrates the PageWorms experience around adapter-driven anchoring,
 *   storage, rendering, and event wiring.
 *
 * Responsibilities:
 *   - init(): Bootstraps styles, storage hydration, observers, and initial render.
 *   - addWorm(opts): Create a new worm from adapter-derived position data.
 *   - Anchoring adapter: Resolve persisted worm positions using multi-strategy fallbacks.
 *   - Storage adapter: Persist worm collections keyed by canonical URL.
 *   - _observe(): Resize/scroll/mutation listeners with throttled rerender.
 *   - clearScreen(): Remove rendered worms and tear down DOM overlays.
 *   - destroy(): Cleanup listeners/observers and DOM artifacts.
 *   - UI adapter: Surface modals/tooltips and relay user edits/deletions.
 *
 * Important Behavior:
 *   - Worms fade out while scrolling, reappear after ~140ms idle.
 *   - Anchors are redundant: TextQuote, DOM selector, and element-relative (x,y).
 *
 * Public API:
 *   - class PageWorms
 *   - async function attachPageWorms(options): convenience bootstrap (exposes window.__pageWorms)
 */
// Adapters
import { createAnchoringAdapter, } from "./anchoring/index.js";
import { createStorageAdapter, } from "./storage/index.js";
import { createObserverAdapter, } from "./observer/index.js";
import { createRenderingAdapter, } from "./rendering/index.js";
import { createUIAdapter } from "./ui/index.js";
import { DEFAULTS, PW_OWNED_SELECTOR } from "./constants.js";
import { throttle, getCanonicalUrl } from "./utils.js";
import { injectStyles } from "./styles.js";
export class PageWorms {
    // ---------------------------------------------------------------------------
    // #region Lifecycle
    // ---------------------------------------------------------------------------
    constructor(storageOption) {
        injectStyles();
        this.url = getCanonicalUrl();
        this.worms = [];
        this._idCounter = 0;
        this.uiAdapter = createUIAdapter({
            getWormById: (id) => this._findWormById(id),
            onEdit: async (id, data) => {
                await this._handleEditFromUI(id, data);
            },
            onDelete: (id) => this._handleDeleteFromUI(id),
        });
        this.anchoringAdapter = createAnchoringAdapter();
        this.storageAdapter = createStorageAdapter(storageOption);
        this.observerAdapter = createObserverAdapter();
        this.renderingAdapter = createRenderingAdapter({
            anchoringAdapter: this.anchoringAdapter,
            observerAdapter: this.observerAdapter,
            wireWormElement: (el) => this.uiAdapter.wireWormElement(el),
        });
    }
    /**
     * Initialize the overlay layer, hydrate persisted worms, and start observers.
     */
    async init() {
        await this.load();
        this._observe();
        await this.renderingAdapter.renderAll(this.worms);
    }
    /** Tear down observers/listeners and remove rendered worm elements. */
    destroy() {
        this.observerAdapter.stop();
        this.renderingAdapter.clear();
        this.uiAdapter.destroy();
    }
    /** Remove all tracked worms and aggressively clear overlay artifacts. */
    clearScreen() {
        this.renderingAdapter.clear();
        this.worms = [];
        this.uiAdapter.reset();
    }
    async renderAll() {
        await this.renderingAdapter.renderAll(this.worms);
    }
    // #endregion
    // ---------------------------------------------------------------------------
    // #region Observer Integration
    // ---------------------------------------------------------------------------
    /** Wire resize/scroll/mutation observers with a throttled render loop. */
    _observe() {
        const scheduleRender = throttle(() => {
            void this.renderingAdapter.renderAll(this.worms);
        }, DEFAULTS.throttleMs);
        this.observerAdapter.start({
            scheduleRender,
            isManagedNode: (node) => this._isManagedNode(node),
        });
    }
    /** Returns true when a mutation target belongs to PageWorms-managed UI. */
    _isManagedNode(node) {
        if (!node)
            return false;
        const el = node instanceof Element ? node : node.parentElement;
        return !!(el &&
            typeof el.closest === "function" &&
            el.closest(PW_OWNED_SELECTOR));
    }
    // #endregion
    // ---------------------------------------------------------------------------
    // #region Persistence & Lookup
    // ---------------------------------------------------------------------------
    /** Load worms for the current canonical URL via the configured storage adapter. */
    async load() {
        this.worms = await this.storageAdapter.get(this.url);
        this._idCounter = this.worms.reduce((max, worm) => {
            const id = Number(worm?.id);
            return Number.isFinite(id) && id > max ? id : max;
        }, 0);
    }
    /** Persist the in-memory worm list for the current page. */
    async _persist() {
        await this.storageAdapter.set(this.url, this.worms);
    }
    _generateId() {
        this._idCounter += 1;
        return this._idCounter;
    }
    _findWormById(id) {
        if (typeof id !== "number" || !Number.isFinite(id))
            return null;
        return this.worms.find((w) => w.id === id) || null;
    }
    // #endregion
    // ---------------------------------------------------------------------------
    // #region Worm Actions & UI
    // ---------------------------------------------------------------------------
    /**
     * Programmatically add a worm using either a selection or a click point.
     */
    async addWorm({ target, clickX, clickY, selection = null, }) {
        const position = this.anchoringAdapter.createPosition({
            target,
            clickX,
            clickY,
            selection,
        });
        const formResult = await this.uiAdapter.promptCreate({
            content: "",
            tags: [],
            status: "private",
        });
        if (!formResult)
            return null;
        const now = new Date().toISOString();
        const worm = {
            id: this._generateId(),
            created_at: now,
            updated_at: null,
            content: formResult.content ?? "",
            status: formResult.status,
            tags: formResult.tags.length ? formResult.tags : null,
            author_id: null,
            position,
            host_url: this.url,
        };
        this.worms.push(worm);
        this._logWormEvent("create", worm, { via: "contextmenu" });
        await this._persist();
        this.renderingAdapter.drawWorm(worm);
        await this.renderingAdapter.renderAll(this.worms);
        await this.uiAdapter.openViewer(worm.id);
        return worm;
    }
    async _handleEditFromUI(wormId, payload) {
        const worm = this._findWormById(wormId);
        if (!worm)
            return null;
        worm.content = payload.content ?? "";
        worm.tags = payload.tags.length ? payload.tags : null;
        worm.status = payload.status;
        worm.updated_at = new Date().toISOString();
        await this._persist();
        this._logWormEvent("update", worm, { via: "ui" });
        await this.renderingAdapter.renderAll(this.worms);
        return worm;
    }
    async _handleDeleteFromUI(wormId) {
        const worm = this._findWormById(wormId);
        if (!worm)
            return;
        this.worms = this.worms.filter((w) => w.id !== wormId);
        this.renderingAdapter.removeWorm(wormId);
        await this._persist();
        this._logWormEvent("delete", worm, { via: "ui" });
        await this.renderingAdapter.renderAll(this.worms);
    }
    // #endregion
    // ---------------------------------------------------------------------------
    // #region Instrumentation
    // ---------------------------------------------------------------------------
    /** Console instrumentation helper for creation/render lifecycle events. */
    _logWormEvent(action, worm, extra = {}) {
        try {
            console.log("[PageWorms]", {
                action,
                id: worm?.id,
                url: this?.url,
                created_at: worm?.created_at,
                position: worm?.position,
                ...extra,
            });
        }
        catch { }
    }
}
/** Convenience bootstrap for drop-in usage */
export async function attachPageWorms(storageOption) {
    const pp = new PageWorms(storageOption);
    await pp.init();
    window.__pageWorms = pp;
    return pp;
}

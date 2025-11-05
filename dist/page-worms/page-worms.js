/**
 * page-worms.js
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Orchestrates anchoring, storage, rendering, and event wiring.
 *
 * Responsibilities:
 *   - init(): Bootstraps styles, storage load, observers, and initial render.
 *   - addWorm(opts): Create a new worm at given click/selection.
 *   - renderAll(): Redraw all worms after DOM changes/resizes.
 *   - Anchoring adapter: Re-anchor via TextQuote -> selector -> tag+attrs -> body.
 *   - _observe(): Resize/scroll/mutation listeners with throttled rerender.
 *   - clearScreen(): Remove rendered worms and tear down DOM overlays.
 *   - destroy(): Cleanup listeners/observers and DOM artifacts.
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
import { DEFAULTS } from "./constants.js";
import { uuid, throttle, getCanonicalUrl } from "./utils.js";
import { injectStyles } from "./styles.js";
import { createWormEl, makePositioningContext, createOrUpdateBox, } from "./layer.js";
import { WormUI } from "./ui.js";
const OWNED_SELECTOR = "[data-pw-owned]"; // Internal UI nodes flagged to skip mutation feedback
function clamp01(value) {
    if (!Number.isFinite(value))
        return 0;
    if (value < 0)
        return 0;
    if (value > 1)
        return 1;
    return value;
}
function toStringRecord(value) {
    if (!value || typeof value !== "object")
        return {};
    const out = {};
    for (const [key, val] of Object.entries(value)) {
        if (typeof val === "string") {
            out[key] = val;
        }
    }
    return out;
}
function normalizePosition(raw) {
    const obj = raw && typeof raw === "object" ? raw : {};
    const dom = obj.dom && typeof obj.dom === "object"
        ? obj.dom
        : null;
    const selector = typeof dom?.selector === "string" ? dom.selector : "";
    const textQuoteRaw = obj.textQuote && typeof obj.textQuote === "object"
        ? obj.textQuote
        : null;
    const textQuote = textQuoteRaw &&
        typeof textQuoteRaw.exact === "string" &&
        textQuoteRaw.exact.trim()
        ? {
            exact: textQuoteRaw.exact,
            prefix: typeof textQuoteRaw.prefix === "string" ? textQuoteRaw.prefix : "",
            suffix: typeof textQuoteRaw.suffix === "string" ? textQuoteRaw.suffix : "",
        }
        : null;
    const elementRaw = obj.element && typeof obj.element === "object"
        ? obj.element
        : {};
    const relPctRaw = elementRaw.relBoxPct && typeof elementRaw.relBoxPct === "object"
        ? elementRaw.relBoxPct
        : {};
    const rawX = relPctRaw.x;
    const rawY = relPctRaw.y;
    const relBoxPct = {
        x: clamp01(typeof rawX === "number" ? rawX : 0.5),
        y: clamp01(typeof rawY === "number" ? rawY : 0.5),
    };
    const fallbackRaw = obj.fallback && typeof obj.fallback === "object"
        ? obj.fallback
        : {};
    const rawScrollPct = fallbackRaw.scrollPct;
    let scrollPct = 0;
    if (typeof rawScrollPct === "number" && Number.isFinite(rawScrollPct)) {
        scrollPct = clamp01(rawScrollPct);
    }
    return {
        dom: { selector },
        textQuote,
        element: {
            tag: typeof elementRaw.tag === "string" && elementRaw.tag
                ? elementRaw.tag
                : "BODY",
            attrs: toStringRecord(elementRaw.attrs),
            relBoxPct,
        },
        fallback: {
            scrollPct,
        },
    };
}
export class PageWorms {
    // ---------------------------------------------------------------------------
    // #region Lifecycle & Observers
    // ---------------------------------------------------------------------------
    constructor(storageOption) {
        injectStyles();
        this._isRendering = false;
        this.url = getCanonicalUrl();
        this.worms = [];
        this.wormEls = new Map();
        this._resizeObs = null;
        this._mutObs = null;
        this._hostRO = null;
        this._scrollTimer = null;
        this._hostByWorm = new Map(); // id -> resolved hostEl (for diffing)
        this._anchorCache = null;
        this._raf = null;
        this._idCounter = 0;
        this._needsMigration = false;
        this._ui = new WormUI({
            getWormById: (id) => this._findWormById(id),
            onEdit: async (id, data) => {
                await this._handleEditFromUI(id, data);
            },
            onDelete: (id) => this._handleDeleteFromUI(id),
        });
        this._onAnyScroll = () => {
            const root = document.documentElement;
            if (!root.classList.contains("pp-scrolling"))
                root.classList.add("pp-scrolling");
            if (this._scrollTimer)
                clearTimeout(this._scrollTimer);
            this._scrollTimer = setTimeout(() => root.classList.remove("pp-scrolling"), 140);
        };
        this._reposition = null;
        this.anchoringAdapter = createAnchoringAdapter();
        this.storageAdapter = createStorageAdapter(storageOption);
    }
    /**
     * Initialize the overlay layer, hydrate persisted worms, and start observers.
     */
    async init() {
        await this.load();
        this._observe();
        await this.renderAll();
        this._initHostResizeObserver();
    }
    /** Wire resize/scroll/mutation observers with a throttled render loop. */
    _observe() {
        const reposition = throttle(() => {
            if (this._raf)
                cancelAnimationFrame(this._raf);
            this._raf = requestAnimationFrame(() => {
                void this.renderAll();
            });
        }, DEFAULTS.throttleMs);
        this._reposition = reposition;
        window.addEventListener("resize", reposition);
        window.addEventListener("scroll", this._onAnyScroll, {
            passive: true,
            capture: true,
        });
        this._resizeObs = new ResizeObserver(reposition);
        this._resizeObs.observe(document.documentElement);
        this._mutObs = new MutationObserver((entries) => {
            if (this._isRendering)
                return;
            for (const record of entries) {
                if (this._isManagedNode(record.target) ||
                    [...record.addedNodes].some((node) => this._isManagedNode(node)) ||
                    [...record.removedNodes].some((node) => this._isManagedNode(node))) {
                    continue;
                }
                reposition();
                break;
            }
        });
        const body = document.body;
        if (body) {
            this._mutObs.observe(body, { childList: true, subtree: true });
        }
    }
    /** Returns true when a mutation target belongs to PageWorms-managed UI. */
    _isManagedNode(node) {
        if (!node)
            return false;
        const el = node instanceof Element ? node : node.parentElement;
        return !!(el &&
            typeof el.closest === "function" &&
            el.closest(OWNED_SELECTOR));
    }
    /** Lazily create a ResizeObserver that keeps overlay boxes in sync. */
    _initHostResizeObserver() {
        if (this._hostRO)
            return;
        this._hostRO = new ResizeObserver((entries) => {
            for (const e of entries) {
                const hostEl = e.target;
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
    /** Tear down observers/listeners and remove rendered worm elements. */
    destroy() {
        if (this._reposition)
            window.removeEventListener("resize", this._reposition);
        window.removeEventListener("scroll", this._onAnyScroll, { capture: true });
        this._resizeObs?.disconnect();
        this._mutObs?.disconnect();
        this._hostRO?.disconnect();
        for (const el of this.wormEls.values())
            el.remove();
        this.wormEls.clear();
        this._ui.destroy();
    }
    /** Remove all tracked worms and aggressively clear overlay artifacts. */
    clearScreen() {
        // Cancel pending animation frames
        if (this._raf) {
            cancelAnimationFrame(this._raf);
            this._raf = null;
        }
        // Remove the ones we know
        for (const el of this.wormEls.values())
            el.remove();
        this.wormEls.clear();
        this.worms = [];
        this._hostByWorm.clear();
        this._anchorCache = null;
        this._ui.reset();
        // Aggressive sweep
        try {
            document
                .querySelectorAll(`.${DEFAULTS.wormClass}`)
                .forEach((n) => n.remove());
            document.querySelectorAll(`.pp-box`).forEach((n) => n.remove());
        }
        catch { }
    }
    // #endregion
    // ---------------------------------------------------------------------------
    // #region Worm Management & Persistence
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
        const formResult = await this._ui.promptCreate({
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
            status: this._normalizeStatus(formResult.status),
            tags: formResult.tags.length ? formResult.tags : null,
            author_id: null,
            position,
            host_url: this.url,
        };
        this.worms.push(worm);
        this._logWormEvent("create", worm, { via: "contextmenu" });
        await this._persist();
        this._drawWorm(worm);
        await this.renderAll();
        await this._ui.openViewer(worm.id);
        return worm;
    }
    /** Load worms for the current canonical URL via the configured storage adapter. */
    async load() {
        const raw = await this.storageAdapter.get(this.url);
        this._idCounter = 0;
        this._needsMigration = false;
        this.worms = raw.map((w) => this._normalizeWorm(w));
        if (this._needsMigration)
            await this._persist();
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
    // #endregion
    // ---------------------------------------------------------------------------
    // #region Normalization
    // ---------------------------------------------------------------------------
    _normalizeStatus(value) {
        if (value === "friends" || value === "public")
            return value;
        return "private";
    }
    _normalizeTags(value) {
        if (Array.isArray(value)) {
            const normalized = value
                .map((item) => (typeof item === "string" ? item.trim() : ""))
                .filter(Boolean);
            return normalized.length ? normalized : null;
        }
        if (typeof value === "string") {
            const normalized = value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean);
            return normalized.length ? normalized : null;
        }
        return null;
    }
    // TODO: this is probably not needed. Also investigate if other _normalize functions are needed.
    _normalizeWorm(raw) {
        const data = raw && typeof raw === "object" ? raw : {};
        let changed = false;
        const rawId = data.id;
        let id;
        if (typeof rawId === "number" && Number.isFinite(rawId)) {
            id = rawId;
            this._idCounter = Math.max(this._idCounter, rawId);
        }
        else if (typeof rawId === "string" && /^\d+$/.test(rawId)) {
            const parsed = Number(rawId);
            id = parsed;
            this._idCounter = Math.max(this._idCounter, parsed);
            changed = true;
        }
        else {
            id = this._generateId();
            changed = true;
        }
        const created_at = typeof data.created_at === "string"
            ? data.created_at
            : new Date().toISOString();
        if (created_at !== data.created_at)
            changed = true;
        const updated_at = data.updated_at === null || typeof data.updated_at === "string"
            ? data.updated_at
            : null;
        if (updated_at !== data.updated_at)
            changed = true;
        const status = this._normalizeStatus(data.status);
        if (status !== data.status)
            changed = true;
        const tags = this._normalizeTags(data.tags);
        if (tags !== data.tags)
            changed = true;
        const positionSource = data.position ?? data.anchor ?? null;
        if (!data.position && data.anchor)
            changed = true;
        const position = normalizePosition(positionSource);
        const author_id = typeof data.author_id === "number" ? data.author_id : null;
        if (author_id !== data.author_id)
            changed = true;
        const host_url = typeof data.host_url === "string"
            ? data.host_url
            : typeof data.url === "string"
                ? data.url
                : this.url;
        if (host_url !== data.host_url)
            changed = true;
        const content = typeof data.content === "string" ? data.content : "";
        if (content !== data.content)
            changed = true;
        const worm = {
            id,
            created_at,
            updated_at,
            content,
            status,
            tags: tags ?? null,
            author_id,
            position,
            host_url,
        };
        if (changed)
            this._needsMigration = true;
        return worm;
    }
    // #endregion
    // ---------------------------------------------------------------------------
    // #region UI Delegates
    // ---------------------------------------------------------------------------
    async _handleEditFromUI(wormId, payload) {
        const worm = this._findWormById(wormId);
        if (!worm)
            return null;
        worm.content = payload.content ?? "";
        worm.tags = payload.tags.length ? payload.tags : null;
        worm.status = this._normalizeStatus(payload.status);
        worm.updated_at = new Date().toISOString();
        await this._persist();
        this._logWormEvent("update", worm, { via: "ui" });
        await this.renderAll();
        return worm;
    }
    async _handleDeleteFromUI(wormId) {
        const worm = this._findWormById(wormId);
        if (!worm)
            return;
        this.worms = this.worms.filter((w) => w.id !== wormId);
        const el = this.wormEls.get(wormId);
        if (el) {
            el.remove();
            this.wormEls.delete(wormId);
        }
        this._hostByWorm.delete(wormId);
        await this._persist();
        this._logWormEvent("delete", worm, { via: "ui" });
        await this.renderAll();
    }
    // #endregion
    // ---------------------------------------------------------------------------
    // #region Rendering Pipeline
    // ---------------------------------------------------------------------------
    /** Re-render every worm, batching DOM writes behind requestAnimationFrame. */
    async renderAll() {
        this._isRendering = true;
        try {
            // Ensure styles still exist (some SPAs/Helmet can drop our style tag)
            injectStyles();
            // rebuild anchoring cache per render
            this._anchorCache = this.anchoringAdapter.buildTextCache();
            // Phase A: build a plan (reads)
            const plan = [];
            const nextIds = new Set(this.worms.map((w) => w.id));
            // Remove stale elements (ids no longer present)
            for (const [id, el] of this.wormEls) {
                if (!nextIds.has(id)) {
                    el.remove();
                    this.wormEls.delete(id);
                    this._hostByWorm.delete(id);
                }
            }
            // For current worms, resolve hosts and compute placement
            for (const worm of this.worms) {
                const hostEl = this.anchoringAdapter.resolvePosition(worm.position, this._anchorCache);
                const fallbackHost = document.body ?? document.documentElement;
                const host = (hostEl ?? fallbackHost);
                // Decide container (can host children or not)
                const cannotContain = /^(IMG|VIDEO|CANVAS|SVG|IFRAME)$/i.test(host.tagName);
                const containerEl = cannotContain
                    ? host.parentElement instanceof HTMLElement
                        ? host.parentElement
                        : document.body ?? host
                    : host;
                // Ensure positioning context (read ok)
                makePositioningContext(containerEl);
                // If we need a box overlay, compute (reads); created in write phase
                const xPct = (worm.position?.element?.relBoxPct?.x ?? 0.5) * 100;
                const yPct = (worm.position?.element?.relBoxPct?.y ?? 0.5) * 100;
                plan.push({ worm, host, cannotContain, containerEl, xPct, yPct });
            }
            // Phase B: apply the plan (writes in a single rAF)
            if (this._raf)
                cancelAnimationFrame(this._raf);
            this._raf = requestAnimationFrame(() => this._applyPlan(plan));
        }
        finally {
            this._isRendering = false;
        }
    }
    /** Apply a precomputed render plan, reusing DOM nodes and minimizing writes. */
    _applyPlan(plan) {
        const activeIds = new Set(this.worms.map((w) => w.id));
        for (const item of plan) {
            const { worm, host, cannotContain, containerEl, xPct, yPct } = item;
            // Guard against worms no longer present
            if (!activeIds.has(worm.id)) {
                this.wormEls.delete(worm.id);
                this._hostByWorm.delete(worm.id);
                continue;
            }
            // (a) Reuse existing element or create if missing
            let wormEl = this.wormEls.get(worm.id);
            if (!wormEl) {
                wormEl = createWormEl(); // already sets class, aria-label
                wormEl.dataset.wormId = String(worm.id);
                this.wormEls.set(worm.id, wormEl);
            }
            // (b) Determine the final parent for this wormEl
            let parentEl = containerEl;
            let box = null;
            if (cannotContain) {
                // Create/update overlay box aligned to host (write)
                box = createOrUpdateBox(containerEl, host, uuid);
                parentEl = box;
                // Make sure host resize observer watches this host (cheap)
                this._initHostResizeObserver?.();
                if (this._hostRO)
                    this._hostRO.observe(host);
            }
            // (c) If host changed, reparent; else leave it alone
            const prevHost = this._hostByWorm.get(worm.id);
            if (prevHost !== host) {
                if (wormEl.parentElement !== parentEl) {
                    parentEl.appendChild(wormEl);
                }
                this._hostByWorm.set(worm.id, host);
            }
            else {
                // Host same; parent might still differ (e.g., box recreated)
                if (wormEl.parentElement !== parentEl) {
                    parentEl.appendChild(wormEl);
                }
            }
            // (d) Only write style when the value actually changed (avoids layout work)
            const prevL = wormEl.dataset.l, prevT = wormEl.dataset.t;
            const l = String(xPct), t = String(yPct);
            if (prevL !== l) {
                wormEl.style.left = l + "%";
                wormEl.dataset.l = l;
            }
            if (prevT !== t) {
                wormEl.style.top = t + "%";
                wormEl.dataset.t = t;
            }
            this._ui.wireWormElement(wormEl);
        }
        this._raf = null;
    }
    /** Render a single worm immediately (used for freshly created annotations). */
    _drawWorm(worm) {
        injectStyles();
        const hostEl = this.anchoringAdapter.resolvePosition(worm.position, this._anchorCache);
        const fallbackHost = document.body ?? document.documentElement;
        const host = (hostEl ?? fallbackHost);
        // Container choice
        const cannotContain = /^(IMG|VIDEO|CANVAS|SVG|IFRAME)$/i.test(host.tagName);
        const containerEl = cannotContain
            ? host.parentElement instanceof HTMLElement
                ? host.parentElement
                : document.body ?? host
            : host;
        // Positioning context
        makePositioningContext(containerEl);
        // Box overlay if needed
        const targetContainer = cannotContain
            ? createOrUpdateBox(containerEl, host, uuid)
            : containerEl;
        // Worm
        const wormEl = createWormEl();
        wormEl.dataset.wormId = String(worm.id);
        const x = (worm.position?.element?.relBoxPct?.x ?? 0.5) * 100;
        const y = (worm.position?.element?.relBoxPct?.y ?? 0.5) * 100;
        wormEl.style.left = x + "%";
        wormEl.style.top = y + "%";
        targetContainer.appendChild(wormEl);
        this.wormEls.set(worm.id, wormEl);
        this._ui.wireWormElement(wormEl);
        // Observe host for cheap overlay resync
        this._initHostResizeObserver?.();
        if (this._hostRO && cannotContain)
            this._hostRO.observe(host);
    }
}
/** Convenience bootstrap for drop-in usage */
export async function attachPageWorms(storageOption) {
    const pp = new PageWorms(storageOption);
    await pp.init();
    window.__pageWorms = pp;
    return pp;
}

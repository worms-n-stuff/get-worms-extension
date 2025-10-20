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
 *   - _resolve(position): Re-anchor via TextQuote -> selector -> tag+attrs -> body.
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
 *
 * Options:
 *   - storage: "local" | "chrome" | { get(url), set(url, arr) }
 *   - enableSelection: boolean (store TextQuote when selection exists)
 *
 * Data Model (per worm):
 *   {
 *     id: number;
 *     created_at: string;
 *     updated_at: string | null;
 *     content: string;
 *     status: "private" | "friends" | "public";
 *     tags: string[] | null;
 *     author_id: number | null;
 *     position: {
 *       dom: { selector },
 *       textQuote?: { exact, prefix, suffix },
 *       element: { tag, attrs, relBoxPct: { x, y } },
 *       fallback: { scrollPct }
 *     };
 *     host_url: string;
 *   }
 */
import { DEFAULTS } from "./constants.js";
import { uuid, throttle, normalizeText, getCanonicalUrl } from "./utils.js";
import {
  cssPath,
  findQuoteRange,
  elementBoxPct,
  selectionContext,
  stableAttrs,
  elementForRange,
  docScrollPct,
  textContentStream,
} from "./dom-anchors.js";
import { injectStyles } from "./styles.js";
import { LocalStorageAdapter, ChromeStorageAdapter } from "./storage.js";
import {
  ensureLayer,
  createWormEl,
  makePositioningContext,
  createOrUpdateBox,
} from "./layer.js";
import { WormUI } from "./ui.js";

class PageWorms {
  /**
   * @param {Object} opts
   * @param {"local"|"chrome"|Object} opts.storage "local" (default), "chrome", or custom {get,set}
   * @param {boolean} opts.enableSelection If true, store TextQuote for current selection
   */
  // ---------------------------------------------------------------------------
  // #region Lifecycle & Observers
  // ---------------------------------------------------------------------------
  constructor(opts = {}) {
    injectStyles();
    this._layer = null;
    this._isRendering = false;
    this.opts = { enableSelection: true, ...opts };
    this.url = getCanonicalUrl();
    this.worms = [];
    this.wormEls = new Map();
    this._resizeObs = null;
    this._mutObs = null;
    this._hostRO = null;
    this._scrollTimer = null;
    this._hostByWorm = new Map(); // id -> resolved hostEl (for diffing)
    this._textCache = null; // { nodes, allText, stamp }
    this._raf = null;
    this._idCounter = 0;
    this._needsMigration = false;
    this._ui = new WormUI({
      getWormById: (id) => this._findWormById(id),
      onEdit: (id, data) => this._handleEditFromUI(id, data),
      onDelete: (id) => this._handleDeleteFromUI(id),
    });

    this._onAnyScroll = () => {
      const root = document.documentElement;
      if (!root.classList.contains("pp-scrolling"))
        root.classList.add("pp-scrolling");
      clearTimeout(this._scrollTimer);
      this._scrollTimer = setTimeout(
        () => root.classList.remove("pp-scrolling"),
        140
      );
    };

    const storage = this.opts.storage;
    this.store =
      storage === "chrome"
        ? new ChromeStorageAdapter()
        : storage && typeof storage.get === "function"
        ? storage
        : new LocalStorageAdapter();
  }

  /**
   * Initialize the overlay layer, hydrate persisted worms, and start observers.
   */
  async init() {
    this._layer = ensureLayer();
    await this.load();
    this._observe();
    this.renderAll();
    this._initHostResizeObserver();
  }

  /** Wire resize/scroll/mutation observers with a throttled render loop. */
  _observe() {
    this._reposition = throttle(() => {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => this.renderAll());
    }, DEFAULTS.throttleMs);

    window.addEventListener("resize", this._reposition);
    window.addEventListener("scroll", this._onAnyScroll, {
      passive: true,
      capture: true,
    });

    this._resizeObs = new ResizeObserver(this._reposition);
    this._resizeObs.observe(document.documentElement);

    this._mutObs = new MutationObserver((entries) => {
      if (this._isRendering) return;
      for (const m of entries) {
        if (
          this._layer &&
          (this._layer.contains(m.target) ||
            [...m.addedNodes].some(
              (n) => n.nodeType === 1 && this._layer.contains(n)
            ) ||
            [...m.removedNodes].some(
              (n) => n.nodeType === 1 && this._layer.contains(n)
            ))
        )
          continue;
        this._reposition();
        break;
      }
    });
    this._mutObs.observe(document.body, { childList: true, subtree: true });
  }

  /** Lazily create a ResizeObserver that keeps overlay boxes in sync. */
  _initHostResizeObserver() {
    if (this._hostRO) return;
    this._hostRO = new ResizeObserver((entries) => {
      for (const e of entries) {
        const hostEl = e.target,
          containerEl = hostEl.parentElement;
        if (!containerEl) continue;
        const box = containerEl.querySelector(
          `:scope > .pp-box[data-for='${hostEl.dataset.ppId}']`
        );
        if (!box) continue;
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

    for (const el of this.wormEls.values()) el.remove();
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
    for (const el of this.wormEls.values()) el.remove();
    this.wormEls.clear();
    this.worms = [];
    this._hostByWorm.clear();
    this._ui.reset();

    // Aggressive sweep
    try {
      document
        .querySelectorAll(`.${DEFAULTS.wormClass}`)
        .forEach((n) => n.remove());
      document.querySelectorAll(`.pp-box`).forEach((n) => n.remove());
    } catch {}
  }

  // #endregion
  // ---------------------------------------------------------------------------
  // #region Worm Management & Persistence
  // ---------------------------------------------------------------------------
  /**
   * Programmatically add a worm using either a selection or a click point.
   * @param {Object} opts
   * @param {Element} opts.target - Element that received the context click (or selection ancestor)
   * @param {number} opts.clickX - clientX for the position relBoxPct
   * @param {number} opts.clickY - clientY for the position relBoxPct
   * @param {Range|null} opts.selection - Optional selection range to create a TextQuote anchor
   */
  async addWorm({ target, clickX, clickY, selection = null }) {
    const position = this._makePosition({ target, clickX, clickY, selection });
    const formResult = await this._ui.promptCreate({
      content: "",
      tags: [],
      status: "private",
    });
    if (!formResult) return null;

    const now = new Date().toISOString();
    const worm = {
      id: this._generateId(),
      created_at: now,
      updated_at: null,
      content: formResult.content || "",
      status:
        formResult.status === "friends" || formResult.status === "public"
          ? formResult.status
          : "private",
      tags: formResult.tags && formResult.tags.length ? formResult.tags : null,
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
    const raw = (await this.store.get(this.url)) || [];
    this._idCounter = 0;
    this._needsMigration = false;
    this.worms = raw.map((w) => this._normalizeWorm(w));
    if (this._needsMigration) await this._persist();
  }
  /** Persist the in-memory worm list for the current page. */
  async _persist() {
    await this.store.set(this.url, this.worms);
  }

  _generateId() {
    this._idCounter += 1;
    return this._idCounter;
  }

  _normalizeWorm(raw = {}) {
    let changed = false;
    let id = raw?.id;

    if (typeof id === "number" && Number.isFinite(id)) {
      this._idCounter = Math.max(this._idCounter, id);
    } else if (typeof id === "string" && /^\d+$/.test(id)) {
      id = Number(id);
      this._idCounter = Math.max(this._idCounter, id);
      changed = true;
    } else {
      id = this._generateId();
      changed = true;
    }

    const created_at =
      typeof raw?.created_at === "string"
        ? raw.created_at
        : new Date().toISOString();
    if (created_at !== raw?.created_at) changed = true;

    const updated_at =
      raw?.updated_at === null || typeof raw?.updated_at === "string"
        ? raw.updated_at
        : null;
    if (updated_at !== raw?.updated_at) changed = true;

    let status = "private";
    if (raw?.status === "friends" || raw?.status === "public") {
      status = raw.status;
    } else if (raw?.status === "private" || raw?.status === undefined) {
      // ok
    } else {
      changed = true;
    }

    let tags = null;
    if (Array.isArray(raw?.tags)) {
      const normalizedTags = raw.tags
        .map((t) => (typeof t === "string" ? t.trim() : ""))
        .filter(Boolean);
      if (normalizedTags.length) tags = normalizedTags;
      if (
        normalizedTags.length !== raw.tags.length ||
        normalizedTags.some((t, idx) => t !== raw.tags[idx])
      ) {
        changed = true;
      }
    } else if (typeof raw?.tags === "string") {
      const normalizedTags = raw.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (normalizedTags.length) tags = normalizedTags;
      changed = true;
    } else if (raw?.tags != null) {
      changed = true;
    }

    const position = raw?.position ?? raw?.anchor ?? null;
    if (!raw?.position && raw?.anchor) changed = true;

    const author_id = typeof raw?.author_id === "number" ? raw.author_id : null;
    if (author_id !== raw?.author_id) changed = true;

    const host_url =
      typeof raw?.host_url === "string" ? raw.host_url : raw?.url || this.url;
    if (host_url !== raw?.host_url) changed = true;

    const content = typeof raw?.content === "string" ? raw.content : "";
    if (content !== raw?.content) changed = true;

    if (typeof id !== "number" || !Number.isFinite(id)) {
      id = this._generateId();
      changed = true;
    }

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

    if (changed) this._needsMigration = true;
    return worm;
  }

  _findWormById(id) {
    if (typeof id !== "number" || !Number.isFinite(id)) return null;
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
    } catch {}
  }

  // #endregion
  // ---------------------------------------------------------------------------
  // #region Anchoring Helpers
  // ---------------------------------------------------------------------------
  /** Compose a resilient position anchor from DOM target, click point, and optional selection. */
  _makePosition({ target, clickX, clickY, selection }) {
    const el = target?.nodeType === 1 ? target : target?.parentElement;
    const selector = el ? cssPath(el) : "";

    let textQuote = null;
    if (selection) {
      const { prefix, suffix } = selectionContext(
        selection,
        DEFAULTS.maxTextContext
      );
      const exact = selection
        .toString()
        .normalize("NFC")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1024);
      textQuote = { exact, prefix, suffix };
    }

    const hostEl = el || document.body;
    const pct = elementBoxPct(hostEl, clickX, clickY);

    return {
      dom: { selector },
      textQuote, // may be null
      element: {
        tag: hostEl?.tagName || "BODY",
        attrs: stableAttrs(hostEl),
        relBoxPct: { x: pct.x, y: pct.y },
      },
      fallback: { scrollPct: docScrollPct() },
    };
  }

  /** Resolve a stored anchor back to a live host element using multiple fallbacks. */
  _resolve(position) {
    // 0) If both selector and textQuote, try to resolve selector and
    // verify it still contains the quote. If yes, use it as host.
    if (position?.dom?.selector && position?.textQuote?.exact) {
      try {
        const el = document.querySelector(position.dom.selector);
        if (
          el &&
          normalizeText(el.innerText || "").includes(
            normalizeText(position.textQuote.exact)
          )
        ) {
          return { hostEl: el };
        }
      } catch {}
    }

    // 1) TextQuote
    if (position?.textQuote?.exact) {
      const range = findQuoteRange(
        position.textQuote.exact,
        position.textQuote.prefix,
        position.textQuote.suffix,
        this._textCache
      );
      if (range) {
        const rects = range.getClientRects();
        if (rects.length) {
          let hostEl = elementForRange(range);
          if (hostEl === document.body && position.dom?.selector) {
            try {
              const sEl = document.querySelector(position.dom.selector);
              if (sEl) hostEl = sEl;
            } catch {}
          }
          return { hostEl };
        }
      }
    }
    // 2) DOM selector
    let hostEl = null;
    if (position?.dom?.selector) {
      try {
        hostEl = document.querySelector(position.dom.selector);
      } catch {}
    }
    // 3) Tag + stable attrs
    if (!hostEl) {
      const tag = position?.element?.tag || null;
      if (tag) {
        const cands = Array.from(document.getElementsByTagName(tag));
        const want = position?.element?.attrs || {};
        hostEl =
          cands.find((el) =>
            Object.keys(want).every(
              (k) => (el.getAttribute(k) || "") === want[k]
            )
          ) || null;
      }
    }
    // 4) Fallback
    if (!hostEl) hostEl = document.body;
    return { hostEl };
  }

  // #endregion
  // ---------------------------------------------------------------------------
  // #region UI Delegates
  // ---------------------------------------------------------------------------

  async _handleEditFromUI(wormId, payload) {
    const worm = this._findWormById(wormId);
    if (!worm) return null;

    worm.content = payload?.content || "";
    worm.tags =
      Array.isArray(payload?.tags) && payload.tags.length ? payload.tags : null;
    worm.status =
      payload?.status === "friends" || payload?.status === "public"
        ? payload.status
        : "private";
    worm.updated_at = new Date().toISOString();

    await this._persist();
    this._logWormEvent("update", worm, { via: "ui" });
    await this.renderAll();
    return worm;
  }

  async _handleDeleteFromUI(wormId) {
    const worm = this._findWormById(wormId);
    if (!worm) return;

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
  /** Snapshot visible text content to accelerate later TextQuote resolution. */
  _buildTextCache() {
    const { nodes } = textContentStream(document.body);
    const allText = nodes.map((n) => n.text).join("");
    this._textCache = { nodes, allText, stamp: performance.now() };
  }

  /** Re-render every worm, batching DOM writes behind requestAnimationFrame. */
  async renderAll() {
    this._isRendering = true;
    try {
      // Ensure styles still exist (some SPAs/Helmet can drop our style tag)
      injectStyles();
      // build text cache per render
      this._buildTextCache();

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
        const { hostEl } = this._resolve(worm.position /*, this._textCache*/);
        const host = hostEl || document.body;

        // Decide container (can host children or not)
        const cannotContain = /^(IMG|VIDEO|CANVAS|SVG|IFRAME)$/i.test(
          host.tagName
        );
        const containerEl = cannotContain
          ? host.parentElement || document.body
          : host;

        // Ensure positioning context (read ok)
        makePositioningContext(containerEl);

        // If we need a box overlay, compute (reads); created in write phase
        const xPct = (worm.position?.element?.relBoxPct?.x ?? 0.5) * 100;
        const yPct = (worm.position?.element?.relBoxPct?.y ?? 0.5) * 100;

        plan.push({ worm, host, cannotContain, containerEl, xPct, yPct });
      }

      // Phase B: apply the plan (writes in a single rAF)
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => this._applyPlan(plan));
    } finally {
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
        wormEl.dataset.wormId = worm.id;
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
        if (this._hostRO) this._hostRO.observe(host);
      }

      // (c) If host changed, reparent; else leave it alone
      const prevHost = this._hostByWorm.get(worm.id);
      if (prevHost !== host) {
        if (wormEl.parentElement !== parentEl) {
          parentEl.appendChild(wormEl);
        }
        this._hostByWorm.set(worm.id, host);
      } else {
        // Host same; parent might still differ (e.g., box recreated)
        if (wormEl.parentElement !== parentEl) {
          parentEl.appendChild(wormEl);
        }
      }

      // (d) Only write style when the value actually changed (avoids layout work)
      const prevL = wormEl.dataset.l,
        prevT = wormEl.dataset.t;
      const l = String(xPct),
        t = String(yPct);
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

    const { hostEl } = this._resolve(worm.position);
    const host = hostEl || document.body;

    // Container choice
    const cannotContain = /^(IMG|VIDEO|CANVAS|SVG|IFRAME)$/i.test(host.tagName);
    const containerEl = cannotContain
      ? host.parentElement || document.body
      : host;

    // Positioning context
    makePositioningContext(containerEl);

    // Box overlay if needed
    const box = cannotContain
      ? createOrUpdateBox(containerEl, host, uuid)
      : containerEl;

    // Worm
    const wormEl = createWormEl();
    wormEl.dataset.wormId = worm.id;

    const x = (worm.position?.element?.relBoxPct?.x ?? 0.5) * 100;
    const y = (worm.position?.element?.relBoxPct?.y ?? 0.5) * 100;
    wormEl.style.left = x + "%";
    wormEl.style.top = y + "%";

    (cannotContain ? box : containerEl).appendChild(wormEl);
    this.wormEls.set(worm.id, wormEl);
    this._ui.wireWormElement(wormEl);

    // Observe host for cheap overlay resync
    this._initHostResizeObserver?.();
    if (this._hostRO && cannotContain) this._hostRO.observe(host);
  }
  //#endregion
}

/** Convenience bootstrap for drop-in usage */
export async function attachPageWorms(options = {}) {
  const pp = new PageWorms(options);
  await pp.init();
  window.__pageWorms = pp;
  return pp;
}

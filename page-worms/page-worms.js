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
 *   - _resolve(anchor): Re-anchor via TextQuote -> selector -> tag+attrs -> body.
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
 *     id, created_at, url, algo,
 *     anchor: {
 *       dom: { selector },
 *       textQuote?: { exact, prefix, suffix },
 *       element: { tag, attrs, relBoxPct: { x, y } },
 *       fallback: { scrollPct }
 *     }
 *   }
 */
import { DEFAULTS } from "./constants.js";
import { uuid, throttle } from "./utils.js";
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
import { getCanonicalUrl } from "./utils.js";

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
   * @param {number} opts.clickX - clientX for the anchor relBoxPct
   * @param {number} opts.clickY - clientY for the anchor relBoxPct
   * @param {Range|null} opts.selection - Optional selection range to create a TextQuote anchor
   */
  async addWorm({ target, clickX, clickY, selection = null }) {
    const anchor = this._makeAnchor({ target, clickX, clickY, selection });
    const worm = {
      id: uuid(),
      created_at: new Date().toISOString(),
      url: this.url,
      algo: DEFAULTS.algoVersion,
      anchor,
    };
    this.worms.push(worm);
    this._logWormEvent("create", worm, { via: "contextmenu" });
    await this._persist();
    this._drawWorm(worm);
    return worm;
  }

  /** Load worms for the current canonical URL via the configured storage adapter. */
  async load() {
    this.worms = (await this.store.get(this.url)) || [];
  }
  /** Persist the in-memory worm list for the current page. */
  async _persist() {
    await this.store.set(this.url, this.worms);
  }

  /** Console instrumentation helper for creation/render lifecycle events. */
  _logWormEvent(action, worm, extra = {}) {
    try {
      console.log("[PageWorms]", {
        action,
        id: worm?.id,
        url: this?.url,
        created_at: worm?.created_at,
        anchor: worm?.anchor, // includes dom, textQuote, relBoxPct, fallback scrollPct
        ...extra,
      });
    } catch {}
  }

  // #endregion
  // ---------------------------------------------------------------------------
  // #region Anchoring Helpers
  // ---------------------------------------------------------------------------
  /** Compose a resilient anchor from DOM target, click position, and optional selection. */
  _makeAnchor({ target, clickX, clickY, selection }) {
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
  _resolve(anchor) {
    // 0) If both selector and textQuote, try to resolve selector and
    // verify it still contains the quote. If yes, use it as host.
    if (anchor.dom?.selector && anchor.textQuote?.exact) {
      try {
        const el = document.querySelector(anchor.dom.selector);
        if (
          el &&
          normalizeText(el.innerText || "").includes(
            normalizeText(anchor.textQuote.exact)
          )
        ) {
          return { hostEl: el };
        }
      } catch {}
    }

    // 1) TextQuote
    if (anchor.textQuote?.exact) {
      const range = findQuoteRange(
        anchor.textQuote.exact,
        anchor.textQuote.prefix,
        anchor.textQuote.suffix,
        this._textCache
      );
      if (range) {
        const rects = range.getClientRects();
        if (rects.length) {
          let hostEl = elementForRange(range);
          if (hostEl === document.body && anchor.dom?.selector) {
            try {
              const sEl = document.querySelector(anchor.dom.selector);
              if (sEl) hostEl = sEl;
            } catch {}
          }
          return { hostEl };
        }
      }
    }
    // 2) DOM selector
    let hostEl = null;
    if (anchor.dom?.selector) {
      try {
        hostEl = document.querySelector(anchor.dom.selector);
      } catch {}
    }
    // 3) Tag + stable attrs
    if (!hostEl) {
      const tag = anchor.element?.tag || null;
      if (tag) {
        const cands = Array.from(document.getElementsByTagName(tag));
        const want = anchor.element?.attrs || {};
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
        const { hostEl } = this._resolve(worm.anchor /*, this._textCache*/);
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
        const xPct = (worm.anchor.element?.relBoxPct?.x ?? 0.5) * 100;
        const yPct = (worm.anchor.element?.relBoxPct?.y ?? 0.5) * 100;

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
    }

    this._raf = null;
  }

  /** Render a single worm immediately (used for freshly created annotations). */
  _drawWorm(worm) {
    injectStyles();

    const { hostEl } = this._resolve(worm.anchor);
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

    const x = (worm.anchor.element?.relBoxPct?.x ?? 0.5) * 100;
    const y = (worm.anchor.element?.relBoxPct?.y ?? 0.5) * 100;
    wormEl.style.left = x + "%";
    wormEl.style.top = y + "%";

    (cannotContain ? box : containerEl).appendChild(wormEl);
    this.wormEls.set(worm.id, wormEl);

    // Observe host for cheap overlay resync
    this._initHostResizeObserver?.();
    if (this._hostRO && cannotContain) this._hostRO.observe(host);
  }
}

/** Convenience bootstrap for drop-in usage */
export async function attachPageWorms(options = {}) {
  const pp = new PageWorms(options);
  await pp.init();
  window.__pageWorms = pp;
  return pp;
}

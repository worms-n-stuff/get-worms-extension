/**
 * page-worms.js
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Orchestrates anchoring, storage, rendering, and event wiring.
 *
 * Responsibilities:
 *   - init(): Bootstraps styles, storage load, observers, and initial render.
 *   - enableCapture()/disableCapture(): Toggle click-to-worm mode.
 *   - _onClick(): Create a worm; persist; render; LOG creation (no hover logs).
 *   - renderAll(): Redraw all worms after DOM changes/resizes.
 *   - _resolve(anchor): Re-anchor via TextQuote -> selector -> tag+attrs -> body.
 *   - _observe(): Resize/scroll/mutation listeners with throttled rerender.
 *   - destroy(): Cleanup listeners/observers and DOM artifacts.
 *
 * Important Behavior:
 *   - Worms fade out while scrolling, reappear after ~140ms idle.
 *   - Anchors are redundant: TextQuote, DOM selector, and element-relative (x,y).
 *
 * Public API:
 *   - class PageWorms
 *   - async function attachPageWorms(options): convenience bootstrap
 *
 * Options:
 *   - storage: "local" | "chrome" | { get(url), set(url, arr) }
 *   - enableSelection: boolean (store TextQuote when selection exists)
 *   - startCapture (attachPageWorms only): boolean (begin in capture mode)
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
  constructor(opts = {}) {
    injectStyles();
    this._layer = null;
    this._isRendering = false;
    this.opts = { enableSelection: true, ...opts };
    this.url = getCanonicalUrl();
    this.worms = [];
    this.wormEls = new Map();
    this.captureEnabled = false;
    this._resizeObs = null;
    this._mutObs = null;
    this._hostRO = null;
    this._scrollTimer = null;

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

  async init() {
    this._layer = ensureLayer();
    await this.load();
    this._observe();
    this.renderAll();
    this._initHostResizeObserver();
  }

  enableCapture() {
    if (this.captureEnabled) return;
    this.captureEnabled = true;
    document.body.style.cursor = DEFAULTS.captureCursor;
    document.addEventListener("click", this._onClick, true);
  }

  disableCapture() {
    if (!this.captureEnabled) return;
    this.captureEnabled = false;
    document.body.style.cursor = "";
    document.removeEventListener("click", this._onClick, true);
  }

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

  _onClick = async (ev) => {
    if (ev.button !== 0) return; // left click only
    if (ev.target?.classList?.contains(DEFAULTS.wormClass)) return; // ignore worm self-clicks

    // Optional TextQuote anchor
    let selection = null;
    if (this.opts.enableSelection) {
      const sel = window.getSelection?.();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        selection = sel.getRangeAt(0).cloneRange();
      }
    }

    const target = selection
      ? selection.commonAncestorContainer.nodeType === 1
        ? selection.commonAncestorContainer
        : selection.commonAncestorContainer.parentElement
      : ev.target;

    const anchor = this._makeAnchor({
      target,
      clickX: ev.clientX,
      clickY: ev.clientY,
      selection,
    });

    const worm = {
      id: uuid(),
      created_at: new Date().toISOString(),
      url: this.url,
      algo: DEFAULTS.algoVersion,
      anchor,
    };

    this.worms.push(worm);
    this._logWormEvent("create", worm);
    await this._persist();
    this._drawWorm(worm);
    ev.preventDefault();
    ev.stopPropagation();
  };

  async load() {
    this.worms = (await this.store.get(this.url)) || [];
  }
  async _persist() {
    await this.store.set(this.url, this.worms);
  }

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

  async renderAll() {
    this._isRendering = true;
    try {
      for (const el of this.wormEls.values()) el.remove();
      this.wormEls.clear();
      for (const worm of this.worms) this._drawWorm(worm);
    } finally {
      this._isRendering = false;
    }
  }

  _drawWorm(worm) {
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

  _resolve(anchor) {
    // 1) TextQuote
    if (anchor.textQuote?.exact) {
      const range = findQuoteRange(
        anchor.textQuote.exact,
        anchor.textQuote.prefix,
        anchor.textQuote.suffix
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

  _observe() {
    this._reposition = throttle(() => this.renderAll(), DEFAULTS.throttleMs);

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

  destroy() {
    this.disableCapture();
    if (this._reposition)
      window.removeEventListener("resize", this._reposition);
    window.removeEventListener("scroll", this._onAnyScroll, { capture: true });

    this._resizeObs?.disconnect();
    this._mutObs?.disconnect();
    this._hostRO?.disconnect();

    for (const el of this.wormEls.values()) el.remove();
    this.wormEls.clear();
  }

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

  clearScreen() {
    for (const el of this.wormEls.values()) el.remove();
    this.wormEls.clear();
    this.worms = [];
  }
}

/** Convenience bootstrap for drop-in usage */
export async function attachPageWorms(options = {}) {
  const pp = new PageWorms(options);
  await pp.init();
  if (options.startCapture) pp.enableCapture();
  window.__pageWorms = pp;
  return pp;
}

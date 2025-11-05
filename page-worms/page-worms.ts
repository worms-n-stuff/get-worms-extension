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
 *
 * Options:
 *   - storage: "local" | "chrome" | { get(url), set(url, arr) }
 *   - anchoring: "dom" | AnchoringAdapter
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
import { uuid, throttle, getCanonicalUrl } from "./utils.js";
import { injectStyles } from "./styles.js";
import { createAnchoringAdapter } from "./anchoring/index.js";
import { createStorageAdapter } from "./storage/storage.js";
import type {
  AnchorCache,
  AnchoringAdapter,
  AnchoringModuleOption,
} from "./anchoring/index.js";
import type {
  StorageAdapter,
  StorageModuleOption,
} from "./storage/storage.js";
import {
  createWormEl,
  makePositioningContext,
  createOrUpdateBox,
} from "./layer.js";
import { WormUI } from "./ui.js";
import type { WormRecord, WormPosition, WormFormData, WormStatus } from "./types.js";

const OWNED_SELECTOR = "[data-pw-owned]"; // Internal UI nodes flagged to skip mutation feedback

type RenderPlanItem = {
  worm: WormRecord;
  host: HTMLElement;
  cannotContain: boolean;
  containerEl: HTMLElement;
  xPct: number;
  yPct: number;
};

export type PageWormsOptions = {
  storage?: StorageModuleOption;
  anchoring?: AnchoringModuleOption;
  enableSelection?: boolean;
};

type InternalOptions = {
  storage?: PageWormsOptions["storage"];
  anchoring?: PageWormsOptions["anchoring"];
  enableSelection: boolean;
};

type AddWormOptions = {
  target: Node | null;
  clickX: number;
  clickY: number;
  selection?: Range | null;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "string") {
      out[key] = val;
    }
  }
  return out;
}

function normalizePosition(raw: unknown): WormPosition {
  const obj = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const dom = (obj.dom && typeof obj.dom === "object" ? (obj.dom as Record<string, unknown>) : null);
  const selector =
    typeof dom?.selector === "string" ? dom.selector : "";

  const textQuoteRaw =
    obj.textQuote && typeof obj.textQuote === "object"
      ? (obj.textQuote as Record<string, unknown>)
      : null;
  const textQuote =
    textQuoteRaw && typeof textQuoteRaw.exact === "string" && textQuoteRaw.exact.trim()
      ? {
          exact: textQuoteRaw.exact,
          prefix: typeof textQuoteRaw.prefix === "string" ? textQuoteRaw.prefix : "",
          suffix: typeof textQuoteRaw.suffix === "string" ? textQuoteRaw.suffix : "",
        }
      : null;

  const elementRaw =
    obj.element && typeof obj.element === "object"
      ? (obj.element as Record<string, unknown>)
      : {};
  const relPctRaw =
    elementRaw.relBoxPct && typeof elementRaw.relBoxPct === "object"
      ? (elementRaw.relBoxPct as Record<string, unknown>)
      : {};
  const rawX = relPctRaw.x;
  const rawY = relPctRaw.y;
  const relBoxPct = {
    x: clamp01(typeof rawX === "number" ? rawX : 0.5),
    y: clamp01(typeof rawY === "number" ? rawY : 0.5),
  };

  const fallbackRaw =
    obj.fallback && typeof obj.fallback === "object"
      ? (obj.fallback as Record<string, unknown>)
      : {};

  const rawScrollPct = (fallbackRaw as Record<string, unknown>).scrollPct;
  let scrollPct = 0;
  if (typeof rawScrollPct === "number" && Number.isFinite(rawScrollPct)) {
    scrollPct = clamp01(rawScrollPct);
  }

  return {
    dom: { selector },
    textQuote,
    element: {
      tag: typeof elementRaw.tag === "string" && elementRaw.tag ? elementRaw.tag : "BODY",
      attrs: toStringRecord(elementRaw.attrs),
      relBoxPct,
    },
    fallback: {
      scrollPct,
    },
  };
}

export class PageWorms {
  private _isRendering: boolean;
  private opts: InternalOptions;
  private url: string;
  private worms: WormRecord[];
  private wormEls: Map<number, HTMLButtonElement>;
  private _resizeObs: ResizeObserver | null;
  private _mutObs: MutationObserver | null;
  private _hostRO: ResizeObserver | null;
  private _scrollTimer: ReturnType<typeof setTimeout> | null;
  private _hostByWorm: Map<number, HTMLElement>;
  private _anchorCache: AnchorCache | null;
  private _raf: number | null;
  private _idCounter: number;
  private _needsMigration: boolean;
  private _ui: WormUI;
  private _onAnyScroll: () => void;
  private store: StorageAdapter;
  private anchoring: AnchoringAdapter;
  private _reposition: (() => void) | null;
  /**
   * @param {Object} opts
   * @param {"local"|"chrome"|Object} opts.storage "local" (default), "chrome", or custom {get,set}
   * @param {boolean} opts.enableSelection If true, store TextQuote for current selection
   */
  // ---------------------------------------------------------------------------
  // #region Lifecycle & Observers
  // ---------------------------------------------------------------------------
  constructor(opts: PageWormsOptions = {}) {
    injectStyles();
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
      if (this._scrollTimer) clearTimeout(this._scrollTimer);
      this._scrollTimer = setTimeout(
        () => root.classList.remove("pp-scrolling"),
        140
      );
    };

    this._reposition = null;
    this.anchoring = createAnchoringAdapter(this.opts.anchoring);

    this.store = createStorageAdapter(this.opts.storage);
  }

  /**
   * Initialize the overlay layer, hydrate persisted worms, and start observers.
   */
  async init(): Promise<void> {
    await this.load();
    this._observe();
    await this.renderAll();
    this._initHostResizeObserver();
  }

  /** Wire resize/scroll/mutation observers with a throttled render loop. */
  private _observe(): void {
    const reposition = throttle(() => {
      if (this._raf) cancelAnimationFrame(this._raf);
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

    this._mutObs = new MutationObserver((entries: MutationRecord[]) => {
      if (this._isRendering) return;
      for (const record of entries) {
        if (
          this._isManagedNode(record.target) ||
          [...record.addedNodes].some((node) => this._isManagedNode(node)) ||
          [...record.removedNodes].some((node) => this._isManagedNode(node))
        ) {
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
  private _isManagedNode(node: Node | null): boolean {
    if (!node) return false;
    const el = node instanceof Element ? node : node.parentElement;
    return !!(el && typeof el.closest === "function" && el.closest(OWNED_SELECTOR));
  }

  /** Lazily create a ResizeObserver that keeps overlay boxes in sync. */
  private _initHostResizeObserver(): void {
    if (this._hostRO) return;
    this._hostRO = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      for (const e of entries) {
        const hostEl = e.target;
        if (!(hostEl instanceof HTMLElement)) continue;
        const containerEl = hostEl.parentElement;
        if (!containerEl) continue;
        const box = containerEl.querySelector<HTMLElement>(
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
  destroy(): void {
    if (this._reposition) window.removeEventListener("resize", this._reposition);
    window.removeEventListener("scroll", this._onAnyScroll, { capture: true });

    this._resizeObs?.disconnect();
    this._mutObs?.disconnect();
    this._hostRO?.disconnect();

    for (const el of this.wormEls.values()) el.remove();
    this.wormEls.clear();
    this._ui.destroy();
  }

  /** Remove all tracked worms and aggressively clear overlay artifacts. */
  clearScreen(): void {
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
    this._anchorCache = null;
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
  async addWorm({
    target,
    clickX,
    clickY,
    selection = null,
  }: AddWormOptions): Promise<WormRecord | null> {
    const position = this.anchoring.createPosition({
      target,
      clickX,
      clickY,
      selection:
        this.opts.enableSelection && selection ? selection : null,
    });
    const formResult = await this._ui.promptCreate({
      content: "",
      tags: [],
      status: "private",
    });
    if (!formResult) return null;

    const now = new Date().toISOString();
    const worm: WormRecord = {
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
  async load(): Promise<void> {
    const raw = await this.store.get(this.url);
    this._idCounter = 0;
    this._needsMigration = false;
    this.worms = raw.map((w) => this._normalizeWorm(w));
    if (this._needsMigration) await this._persist();
  }
  /** Persist the in-memory worm list for the current page. */
  private async _persist(): Promise<void> {
    await this.store.set(this.url, this.worms);
  }

  private _generateId(): number {
    this._idCounter += 1;
    return this._idCounter;
  }

  private _normalizeWorm(raw: unknown): WormRecord {
    const data =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    let changed = false;
    const rawId = data.id;
    let id: number;

    if (typeof rawId === "number" && Number.isFinite(rawId)) {
      id = rawId;
      this._idCounter = Math.max(this._idCounter, rawId);
    } else if (typeof rawId === "string" && /^\d+$/.test(rawId)) {
      const parsed = Number(rawId);
      id = parsed;
      this._idCounter = Math.max(this._idCounter, parsed);
      changed = true;
    } else {
      id = this._generateId();
      changed = true;
    }

    const created_at =
      typeof data.created_at === "string"
        ? data.created_at
        : new Date().toISOString();
    if (created_at !== data.created_at) changed = true;

    const updated_at =
      data.updated_at === null || typeof data.updated_at === "string"
        ? (data.updated_at as string | null)
        : null;
    if (updated_at !== data.updated_at) changed = true;

    const status = this._normalizeStatus(data.status);
    if (status !== data.status) changed = true;

    const tags = this._normalizeTags(data.tags);
    if (tags !== data.tags) changed = true;

    const positionSource = data.position ?? data.anchor ?? null;
    if (!data.position && data.anchor) changed = true;
    const position = normalizePosition(positionSource);

    const author_id = typeof data.author_id === "number" ? data.author_id : null;
    if (author_id !== data.author_id) changed = true;

    const host_url =
      typeof data.host_url === "string" ? data.host_url : (typeof data.url === "string" ? data.url : this.url);
    if (host_url !== data.host_url) changed = true;

    const content = typeof data.content === "string" ? data.content : "";
    if (content !== data.content) changed = true;

    const worm: WormRecord = {
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

  private _findWormById(id: number): WormRecord | null {
    if (typeof id !== "number" || !Number.isFinite(id)) return null;
    return this.worms.find((w) => w.id === id) || null;
  }

  /** Console instrumentation helper for creation/render lifecycle events. */
  private _logWormEvent(
    action: string,
    worm: WormRecord | null,
    extra: Record<string, unknown> = {}
  ): void {
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
  private _normalizeStatus(value: unknown): WormStatus {
    if (value === "friends" || value === "public") return value;
    return "private";
  }

  private _normalizeTags(value: unknown): string[] | null {
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

  // #endregion
  // ---------------------------------------------------------------------------
  // #region UI Delegates
  // ---------------------------------------------------------------------------

  private async _handleEditFromUI(
    wormId: number,
    payload: WormFormData
  ): Promise<WormRecord | null> {
    const worm = this._findWormById(wormId);
    if (!worm) return null;

    worm.content = payload.content ?? "";
    worm.tags = payload.tags.length ? payload.tags : null;
    worm.status = this._normalizeStatus(payload.status);
    worm.updated_at = new Date().toISOString();

    await this._persist();
    this._logWormEvent("update", worm, { via: "ui" });
    await this.renderAll();
    return worm;
  }

  private async _handleDeleteFromUI(wormId: number): Promise<void> {
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
  /** Re-render every worm, batching DOM writes behind requestAnimationFrame. */
  async renderAll(): Promise<void> {
    this._isRendering = true;
    try {
      // Ensure styles still exist (some SPAs/Helmet can drop our style tag)
      injectStyles();
      // rebuild anchoring cache per render
      this._anchorCache = this.anchoring.buildTextCache();

      // Phase A: build a plan (reads)
      const plan: RenderPlanItem[] = [];
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
        const { hostEl } = this.anchoring.resolvePosition(
          worm.position,
          this._anchorCache
        );
        const fallbackHost = document.body ?? document.documentElement;
        const host = (hostEl ?? fallbackHost) as HTMLElement;

        // Decide container (can host children or not)
        const cannotContain = /^(IMG|VIDEO|CANVAS|SVG|IFRAME)$/i.test(
          host.tagName
        );
        const containerEl = cannotContain
          ? (host.parentElement instanceof HTMLElement
              ? host.parentElement
              : (document.body ?? host))
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
  private _applyPlan(plan: RenderPlanItem[]): void {
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
      let parentEl: HTMLElement = containerEl;
      let box: HTMLElement | null = null;
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
  private _drawWorm(worm: WormRecord): void {
    injectStyles();

    const { hostEl } = this.anchoring.resolvePosition(
      worm.position,
      this._anchorCache
    );
    const fallbackHost = document.body ?? document.documentElement;
    const host = (hostEl ?? fallbackHost) as HTMLElement;

    // Container choice
    const cannotContain = /^(IMG|VIDEO|CANVAS|SVG|IFRAME)$/i.test(host.tagName);
    const containerEl = cannotContain
      ? (host.parentElement instanceof HTMLElement
          ? host.parentElement
          : (document.body ?? host))
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
    if (this._hostRO && cannotContain) this._hostRO.observe(host);
  }
  //#endregion
}

/** Convenience bootstrap for drop-in usage */
export async function attachPageWorms(
  options: PageWormsOptions = {}
): Promise<PageWorms> {
  const pp = new PageWorms(options);
  await pp.init();
  window.__pageWorms = pp;
  return pp;
}

declare global {
  interface Window {
    __pageWorms?: PageWorms;
  }
}

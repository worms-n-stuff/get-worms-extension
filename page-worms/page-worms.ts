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
 *   - renderAll(): Redraw all worms after DOM changes/resizes via adapter resolution.
 *   - Anchoring adapter: Resolve persisted worm positions using multi-strategy fallbacks.
 *   - Storage adapter: Persist worm collections keyed by canonical URL.
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
import {
  createAnchoringAdapter,
  type DomAnchorCache,
  type AnchoringAdapter,
} from "./anchoring/index.js";
import {
  createStorageAdapter,
  type StorageAdapter,
  type StorageOption,
} from "./storage/index.js";
import {
  createObserverAdapter,
  type ObserverAdapter,
} from "./observer/index.js";

import { DEFAULTS } from "./constants.js";
import { uuid, throttle, getCanonicalUrl } from "./utils.js";
import { injectStyles } from "./styles.js";
import {
  createWormEl,
  makePositioningContext,
  createOrUpdateBox,
} from "./layer.js";
import { WormUI } from "./ui.js";
import type { WormRecord, WormFormData, WormStatus } from "./types.js";

const OWNED_SELECTOR = "[data-pw-owned]"; // Internal UI nodes flagged to skip mutation feedback

type RenderPlanItem = {
  worm: WormRecord;
  host: HTMLElement;
  cannotContain: boolean;
  containerEl: HTMLElement;
  xPct: number;
  yPct: number;
};

type AddWormOptions = {
  target: Node | null; //  Element that received the context click (or selection ancestor)
  clickX: number; // clientX for the position relBoxPct
  clickY: number; // clientY for the position relBoxPct
  selection?: Range | null; // Optional selection range to create a TextQuote anchor
};

export class PageWorms {
  // adapters
  private storageAdapter: StorageAdapter;
  private anchoringAdapter: AnchoringAdapter;
  private observerAdapter: ObserverAdapter;

  private url: string;
  private worms: WormRecord[];
  private wormEls: Map<number, HTMLButtonElement>;
  private _hostByWorm: Map<number, HTMLElement>;
  private _anchorCache: DomAnchorCache | null;
  private _raf: number | null;
  private _idCounter: number;
  private _needsMigration: boolean;
  private _ui: WormUI;
  // ---------------------------------------------------------------------------
  // #region Lifecycle & Observers
  // ---------------------------------------------------------------------------
  constructor(storageOption?: StorageOption) {
    injectStyles();
    this.url = getCanonicalUrl();
    this.worms = [];
    this.wormEls = new Map();
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

    this.anchoringAdapter = createAnchoringAdapter();

    this.storageAdapter = createStorageAdapter(storageOption);
    this.observerAdapter = createObserverAdapter();
  }

  /**
   * Initialize the overlay layer, hydrate persisted worms, and start observers.
   */
  async init(): Promise<void> {
    await this.load();
    this._observe();
    await this.renderAll();
  }

  /** Wire resize/scroll/mutation observers with a throttled render loop. */
  private _observe(): void {
    const scheduleRender = throttle(() => {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => {
        void this.renderAll();
      });
    }, DEFAULTS.throttleMs);
    this.observerAdapter.start({
      scheduleRender,
      isManagedNode: (node) => this._isManagedNode(node),
    });
  }

  /** Returns true when a mutation target belongs to PageWorms-managed UI. */
  private _isManagedNode(node: Node | null): boolean {
    if (!node) return false;
    const el = node instanceof Element ? node : node.parentElement;
    return !!(
      el &&
      typeof el.closest === "function" &&
      el.closest(OWNED_SELECTOR)
    );
  }

  /** Tear down observers/listeners and remove rendered worm elements. */
  destroy(): void {
    this.observerAdapter.stop();

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
    this.observerAdapter.disconnectHostObserver();
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
   */
  async addWorm({
    target,
    clickX,
    clickY,
    selection = null,
  }: AddWormOptions): Promise<WormRecord | null> {
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
    this.worms = await this.storageAdapter.get(this.url);
    this._idCounter = this.worms.reduce((max, worm) => {
      const id = Number(worm?.id);
      return Number.isFinite(id) && id > max ? id : max;
    }, 0);
    this._needsMigration = false;
    if (this._needsMigration) await this._persist();
  }
  /** Persist the in-memory worm list for the current page. */
  private async _persist(): Promise<void> {
    await this.storageAdapter.set(this.url, this.worms);
  }

  private _generateId(): number {
    this._idCounter += 1;
    return this._idCounter;
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
  // #region Normalization
  // ---------------------------------------------------------------------------
  private _normalizeStatus(value: unknown): WormStatus {
    if (value === "friends" || value === "public") return value;
    return "private";
  }

  // TODO: investigate if _nomalizeStatus is needed.

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
    try {
      // Ensure styles still exist (some SPAs/Helmet can drop our style tag)
      injectStyles();
      // rebuild anchoring cache per render
      this._anchorCache = this.anchoringAdapter.buildTextCache();

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
        const hostEl = this.anchoringAdapter.resolvePosition(
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
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => this._applyPlan(plan));
    } catch {}
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
        this.observerAdapter.observeHost(host);
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

    const hostEl = this.anchoringAdapter.resolvePosition(
      worm.position,
      this._anchorCache
    );
    const fallbackHost = document.body ?? document.documentElement;
    const host = (hostEl ?? fallbackHost) as HTMLElement;

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
    if (cannotContain) this.observerAdapter.observeHost(host);
  }
  //#endregion
}

/** Convenience bootstrap for drop-in usage */
export async function attachPageWorms(
  storageOption?: StorageOption
): Promise<PageWorms> {
  const pp = new PageWorms(storageOption);
  await pp.init();
  window.__pageWorms = pp;
  return pp;
}

declare global {
  interface Window {
    __pageWorms?: PageWorms;
  }
}

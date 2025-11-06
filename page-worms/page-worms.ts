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
import {
  createRenderingAdapter,
  type RenderingAdapter,
} from "./rendering/index.js";

import { DEFAULTS } from "./constants.js";
import { throttle, getCanonicalUrl } from "./utils.js";
import { injectStyles } from "./styles.js";
import { WormUI } from "./ui.js";
import type { WormRecord, WormFormData, WormStatus } from "./types.js";

const OWNED_SELECTOR = "[data-pw-owned]"; // Internal UI nodes flagged to skip mutation feedback

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
  private renderingAdapter: RenderingAdapter;

  private url: string;
  private worms: WormRecord[];
  private _idCounter: number;
  private _needsMigration: boolean;
  private _ui: WormUI;
  // ---------------------------------------------------------------------------
  // #region Lifecycle
  // ---------------------------------------------------------------------------
  constructor(storageOption?: StorageOption) {
    injectStyles();
    this.url = getCanonicalUrl();
    this.worms = [];
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
    this.renderingAdapter = createRenderingAdapter({
      anchoringAdapter: this.anchoringAdapter,
      observerAdapter: this.observerAdapter,
      wireWormElement: (el) => this._ui.wireWormElement(el),
    });
  }

  /**
   * Initialize the overlay layer, hydrate persisted worms, and start observers.
   */
  async init(): Promise<void> {
    await this.load();
    this._observe();
    await this.renderAll();
  }

  /** Tear down observers/listeners and remove rendered worm elements. */
  destroy(): void {
    this.observerAdapter.stop();
    this.renderingAdapter.clear();
    this._ui.destroy();
  }

  /** Remove all tracked worms and aggressively clear overlay artifacts. */
  clearScreen(): void {
    this.renderingAdapter.clear();
    this.worms = [];
    this._ui.reset();
  }

  // #endregion
  // ---------------------------------------------------------------------------
  // #region Observer Integration
  // ---------------------------------------------------------------------------
  /** Wire resize/scroll/mutation observers with a throttled render loop. */
  private _observe(): void {
    const scheduleRender = throttle(() => {
      void this.renderAll();
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

  // #endregion
  // ---------------------------------------------------------------------------
  // #region Persistence & Lookup
  // ---------------------------------------------------------------------------
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
  // #region Worm Actions & UI
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
    this.renderingAdapter.removeWorm(wormId);

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
    await this.renderingAdapter.renderAll(this.worms);
  }

  /** Render a single worm immediately (used for freshly created annotations). */
  private _drawWorm(worm: WormRecord): void {
    this.renderingAdapter.drawWorm(worm);
  }
  // #endregion
  // ---------------------------------------------------------------------------
  // #region Instrumentation
  // ---------------------------------------------------------------------------
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

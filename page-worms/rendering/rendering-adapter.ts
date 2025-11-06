/**
 * rendering-adapter.ts
 * -----------------------------------------------------------------------------
 * Concrete DOM renderer for PageWorms.
 *
 * Responsibilities:
 *   - Build render plans that minimize DOM writes.
 *   - Manage worm elements, host alignment boxes, and positioning contexts.
 *   - Expose a small API so PageWorms can delegate drawing/clearing concerns.
 */

import { DEFAULTS } from "../constants.js";
import { createOrUpdateBox, createWormEl, makePositioningContext } from "../layer.js";
import { injectStyles } from "../styles.js";
import type { WormRecord } from "../types.js";
import { uuid } from "../utils.js";
import type { DomAnchorCache } from "../anchoring/index.js";

import type { RenderingAdapter, RenderingAdapterDeps } from "./types.js";

type RenderPlanItem = {
  worm: WormRecord;
  host: HTMLElement;
  containerEl: HTMLElement;
  cannotContain: boolean;
  xPct: number;
  yPct: number;
};

class DomRenderingAdapter implements RenderingAdapter {
  private readonly anchoringAdapter: RenderingAdapterDeps["anchoringAdapter"];
  private readonly observerAdapter: RenderingAdapterDeps["observerAdapter"];
  private readonly wireWormElement: RenderingAdapterDeps["wireWormElement"];

  // DOM state cached so we can reuse elements between renders.
  private readonly wormEls = new Map<number, HTMLButtonElement>();
  private readonly hostByWorm = new Map<number, HTMLElement>();
  private anchorCache: DomAnchorCache | null = null;
  private latestWorms: WormRecord[] = [];
  private raf: number | null = null;

  constructor({ anchoringAdapter, observerAdapter, wireWormElement }: RenderingAdapterDeps) {
    this.anchoringAdapter = anchoringAdapter;
    this.observerAdapter = observerAdapter;
    this.wireWormElement = wireWormElement;
  }

  async renderAll(worms: WormRecord[]): Promise<void> {
    try {
      injectStyles();
      // Snapshot collection so remove/update operations can reconcile DOM later.
      this.latestWorms = worms.slice();
      this.anchorCache = this.anchoringAdapter.buildTextCache();

      const plan: RenderPlanItem[] = [];
      const nextIds = new Set(worms.map((w) => w.id));

      for (const [id, el] of this.wormEls) {
        if (!nextIds.has(id)) {
          el.remove();
          this.wormEls.delete(id);
          this.hostByWorm.delete(id);
        }
      }

      for (const worm of worms) {
        const hostEl = this.anchoringAdapter.resolvePosition(worm.position, this.anchorCache);
        const fallbackHost = document.body ?? document.documentElement;
        const host = (hostEl ?? fallbackHost) as HTMLElement;

        const cannotContain = /^(IMG|VIDEO|CANVAS|SVG|IFRAME)$/i.test(host.tagName);
        // When the host cannot contain children, we fall back to an overlay box.
        const containerEl = cannotContain
          ? host.parentElement instanceof HTMLElement
            ? host.parentElement
            : (document.body ?? host)
          : host;

        makePositioningContext(containerEl);

        // Relative percentages determine left/top positioning for the worm.
        const xPct = (worm.position?.element?.relBoxPct?.x ?? 0.5) * 100;
        const yPct = (worm.position?.element?.relBoxPct?.y ?? 0.5) * 100;

        plan.push({ worm, host, containerEl, cannotContain, xPct, yPct });
      }

      this.cancelFrame();
      this.raf = requestAnimationFrame(() => this.applyPlan(plan));
    } catch {
      // Swallow rendering errors; consumer can retry on next mutation/resize.
    }
  }

  drawWorm(worm: WormRecord): void {
    injectStyles();
    // Keep latest worm reference so applyPlan can detect staleness.
    this.upsertLocalWorm(worm);
    if (!this.anchorCache) {
      this.anchorCache = this.anchoringAdapter.buildTextCache();
    }

    const hostEl = this.anchoringAdapter.resolvePosition(worm.position, this.anchorCache);
    const fallbackHost = document.body ?? document.documentElement;
    const host = (hostEl ?? fallbackHost) as HTMLElement;

    const cannotContain = /^(IMG|VIDEO|CANVAS|SVG|IFRAME)$/i.test(host.tagName);
    const containerEl = cannotContain
      ? host.parentElement instanceof HTMLElement
        ? host.parentElement
        : (document.body ?? host)
      : host;

    makePositioningContext(containerEl);

    // Overlay boxes mirror non-container host bounds.
    const targetContainer = cannotContain
      ? createOrUpdateBox(containerEl, host, uuid)
      : containerEl;

    let wormEl = this.wormEls.get(worm.id);
    if (!wormEl) {
      wormEl = createWormEl();
      wormEl.dataset.wormId = String(worm.id);
      this.wormEls.set(worm.id, wormEl);
    }

    const x = (worm.position?.element?.relBoxPct?.x ?? 0.5) * 100;
    const y = (worm.position?.element?.relBoxPct?.y ?? 0.5) * 100;
    wormEl.style.left = x + "%";
    wormEl.style.top = y + "%";
    wormEl.dataset.l = String(x);
    wormEl.dataset.t = String(y);

    if (wormEl.parentElement !== targetContainer) {
      targetContainer.appendChild(wormEl);
    }
    this.hostByWorm.set(worm.id, host);

    this.wireWormElement(wormEl);

    if (cannotContain) {
      this.observerAdapter.observeHost(host);
    }
  }

  removeWorm(id: number): void {
    const el = this.wormEls.get(id);
    if (el) {
      el.remove();
      this.wormEls.delete(id);
    }
    this.hostByWorm.delete(id);
    this.latestWorms = this.latestWorms.filter((w) => w.id !== id);
  }

  clear(): void {
    this.cancelFrame();
    for (const el of this.wormEls.values()) {
      el.remove();
    }
    this.wormEls.clear();
    this.hostByWorm.clear();
    this.latestWorms = [];
    this.anchorCache = null;

    this.observerAdapter.disconnectHostObserver();

    try {
      // Extra sweeps handle any stray nodes if the document mutated drastically.
      document.querySelectorAll(`.${DEFAULTS.wormClass}`).forEach((node) => {
        if (node instanceof HTMLElement) node.remove();
      });
      document.querySelectorAll(".pp-box").forEach((node) => {
        if (node instanceof HTMLElement) node.remove();
      });
    } catch {
      // Ignore DOM query errors (e.g. during teardown in non-browser envs).
    }
  }

  private applyPlan(plan: RenderPlanItem[]): void {
    const activeIds = new Set(this.latestWorms.map((w) => w.id));

    for (const item of plan) {
      const { worm, host, containerEl, cannotContain, xPct, yPct } = item;

      if (!activeIds.has(worm.id)) {
        this.wormEls.delete(worm.id);
        this.hostByWorm.delete(worm.id);
        continue;
      }

      let wormEl = this.wormEls.get(worm.id);
      if (!wormEl) {
        wormEl = createWormEl();
        wormEl.dataset.wormId = String(worm.id);
        this.wormEls.set(worm.id, wormEl);
      }

      let parentEl: HTMLElement = containerEl;
      if (cannotContain) {
        parentEl = createOrUpdateBox(containerEl, host, uuid);
        // Host resize tracking keeps overlay boxes sized correctly.
        this.observerAdapter.observeHost(host);
      }

      const prevHost = this.hostByWorm.get(worm.id);
      if (prevHost !== host) {
        this.hostByWorm.set(worm.id, host);
      }

      if (wormEl.parentElement !== parentEl) {
        parentEl.appendChild(wormEl);
      }

      const nextL = String(xPct);
      const nextT = String(yPct);
      if (wormEl.dataset.l !== nextL) {
        wormEl.style.left = nextL + "%";
        wormEl.dataset.l = nextL;
      }
      if (wormEl.dataset.t !== nextT) {
        wormEl.style.top = nextT + "%";
        wormEl.dataset.t = nextT;
      }

      this.wireWormElement(wormEl);
    }

    this.raf = null;
  }

  private upsertLocalWorm(worm: WormRecord): void {
    const next = this.latestWorms.slice();
    const idx = next.findIndex((w) => w.id === worm.id);
    if (idx === -1) {
      next.push(worm);
    } else {
      next[idx] = worm;
    }
    this.latestWorms = next;
  }

  private cancelFrame(): void {
    if (this.raf) {
      // Matches requestAnimationFrame in renderAll so we can debounce rerenders.
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }
}

export function createRenderingAdapter(deps: RenderingAdapterDeps): RenderingAdapter {
  return new DomRenderingAdapter(deps);
}

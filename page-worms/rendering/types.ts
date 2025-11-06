import type { AnchoringAdapter } from "../anchoring/index.js";
import type { ObserverAdapter } from "../observer/index.js";
import type { WormRecord } from "../types.js";

export type RenderingAdapterDeps = {
  /** Anchoring is required to translate stored positions into live DOM hosts. */
  anchoringAdapter: AnchoringAdapter;
  /** Observer coordination keeps overlay boxes aligned with their hosts. */
  observerAdapter: ObserverAdapter;
  /** UI wiring callback allows the adapter to register hover/click handlers. */
  wireWormElement: (el: HTMLButtonElement) => void;
};

export interface RenderingAdapter {
  /** Re-render the full worm collection, reusing DOM wherever possible. */
  renderAll(worms: WormRecord[]): Promise<void>;
  /** Draw a single worm immediately (used after creation). */
  drawWorm(worm: WormRecord): void;
  /** Remove a worm's DOM artifacts by id. */
  removeWorm(id: number): void;
  /** Clear all rendered worms and associated overlay state. */
  clear(): void;
}

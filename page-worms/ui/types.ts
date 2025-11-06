/**
 * types.ts
 * -----------------------------------------------------------------------------
 * Contracts for the UI adapter so PageWorms only depends on a narrow surface.
 */

import type { WormRecord, WormFormData } from "../types.js";

export type UIAdapterDeps = {
  /** Returns a worm record given its numeric id. */
  getWormById: (id: number) => WormRecord | null;
  /** Propagate edits initiated from the UI layer. */
  onEdit: (id: number, data: WormFormData) => void | Promise<void>;
  /** Propagate deletions initiated from the UI layer. */
  onDelete: (id: number) => void | Promise<void>;
};

export interface UIAdapter {
  /** Attach hover/focus/click listeners to a worm element. */
  wireWormElement(el: HTMLElement | null): void;
  /** Prompt the user for worm creation data. */
  promptCreate(initial?: Partial<WormFormData>): Promise<WormFormData | null>;
  /** Open the viewer modal for a worm. */
  openViewer(wormId: number): Promise<void>;
  /** Hide any tooltips immediately or after a delay. */
  hideTooltip(immediate?: boolean): void;
  /** Close the modal and clear transient UI state. */
  closeModal(): void;
  /** Reset tooltip/modal state without destroying DOM nodes. */
  reset(): void;
  /** Tear down all UI artifacts and listeners. */
  destroy(): void;
}

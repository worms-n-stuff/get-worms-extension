/**
 * ui-adapter.ts
 * -----------------------------------------------------------------------------
 * Thin wrapper around the existing WormUI so PageWorms can treat UI concerns
 * as an adapter and wire dependencies similarly to other subsystems.
 */

import { WormUI } from "./ui-manager/ui.js";
import type { WormFormData } from "../types.js";
import type { UIAdapter, UIAdapterDeps } from "./types.js";

class DomUIAdapter implements UIAdapter {
  private readonly ui: WormUI;

  constructor(deps: UIAdapterDeps) {
    this.ui = new WormUI({
      getWormById: deps.getWormById,
      onEdit: deps.onEdit,
      onDelete: deps.onDelete,
    });
  }

  wireWormElement(el: HTMLElement | null): void {
    this.ui.wireWormElement(el);
  }

  async promptCreate(initial: Partial<WormFormData> = {}): Promise<WormFormData | null> {
    return this.ui.promptCreate(initial);
  }

  async openViewer(wormId: number): Promise<void> {
    await this.ui.openViewer(wormId);
  }

  hideTooltip(immediate = false): void {
    this.ui.hideTooltip(immediate);
  }

  closeModal(): void {
    this.ui.closeModal();
  }

  reset(): void {
    this.ui.reset();
  }

  destroy(): void {
    this.ui.destroy();
  }
}

export function createUIAdapter(deps: UIAdapterDeps): UIAdapter {
  return new DomUIAdapter(deps);
}

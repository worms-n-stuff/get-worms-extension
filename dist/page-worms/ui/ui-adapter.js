/**
 * ui-adapter.ts
 * -----------------------------------------------------------------------------
 * Thin wrapper around the existing WormUI so PageWorms can treat UI concerns
 * as an adapter and wire dependencies similarly to other subsystems.
 */
import { WormUI } from "./ui-manager/ui.js";
class DomUIAdapter {
    constructor(deps) {
        this.ui = new WormUI({
            getWormById: deps.getWormById,
            onEdit: deps.onEdit,
            onDelete: deps.onDelete,
        });
    }
    wireWormElement(el) {
        this.ui.wireWormElement(el);
    }
    async promptCreate(initial = {}) {
        return this.ui.promptCreate(initial);
    }
    async openViewer(wormId) {
        await this.ui.openViewer(wormId);
    }
    hideTooltip(immediate = false) {
        this.ui.hideTooltip(immediate);
    }
    closeModal() {
        this.ui.closeModal();
    }
    reset() {
        this.ui.reset();
    }
    destroy() {
        this.ui.destroy();
    }
}
export function createUIAdapter(deps) {
    return new DomUIAdapter(deps);
}

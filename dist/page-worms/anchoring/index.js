import { createDomAnchoringAdapter } from "./dom-anchors.js";
import { isAnchoringAdapter, } from "./types.js";
export { isAnchoringAdapter } from "./types.js";
export function createAnchoringAdapter(option) {
    if (!option || option === "dom") {
        return createDomAnchoringAdapter();
    }
    if (isAnchoringAdapter(option)) {
        return option;
    }
    return createDomAnchoringAdapter();
}

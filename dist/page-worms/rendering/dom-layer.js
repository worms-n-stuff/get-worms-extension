/**
 * dom-layer.ts
 * -----------------------------------------------------------------------------
 * Rendering primitives for worm elements and host-aligned overlay boxes.
 */
import { DEFAULTS, PW_OWNED_DATASET_KEY, PW_OWNED_DATASET_VALUE, } from "../constants.js";
/** Build the base worm button element with class + aria labelling. */
export function createWormEl() {
    const el = document.createElement("button");
    el.type = "button";
    el.className = DEFAULTS.wormClass;
    el.setAttribute("aria-label", "Page Worm");
    el.dataset[PW_OWNED_DATASET_KEY] = PW_OWNED_DATASET_VALUE;
    return el;
}
/** Ensure a positioning context on the container, memoizing the previous state. */
export function makePositioningContext(containerEl) {
    const cs = getComputedStyle(containerEl);
    if (cs.position === "static") {
        containerEl.style.position = "relative";
        return true;
    }
    return false;
}
/** Create/update a positioned box that mirrors the host's bounds within a container. */
export function createOrUpdateBox(containerEl, hostEl, idGen) {
    let id = hostEl.dataset.ppId ?? "";
    if (!id) {
        hostEl.dataset.ppId = id = idGen();
    }
    let box = containerEl.querySelector(`:scope > .pp-box[data-for='${id}']`);
    if (!box) {
        box = document.createElement("div");
        box.className = "pp-box";
        box.dataset.for = id;
        containerEl.appendChild(box);
    }
    box.dataset[PW_OWNED_DATASET_KEY] = PW_OWNED_DATASET_VALUE;
    const left = hostEl.offsetLeft, top = hostEl.offsetTop, w = hostEl.offsetWidth, h = hostEl.offsetHeight;
    box.style.left = left + "px";
    box.style.top = top + "px";
    box.style.width = w + "px";
    box.style.height = h + "px";
    return box;
}

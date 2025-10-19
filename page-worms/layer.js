/**
 * layer.js
 * -----------------------------------------------------------------------------
 * Purpose:
 *   DOM primitives for the overlay layer, worms, and host-aligned box elements.
 *
 * Responsibilities:
 *   - ensureLayer(): Create/get the root overlay container (ignored by MO).
 *   - createWormEl(): Construct a basic worm button (unstyled logic-wise).
 *   - makePositioningContext(el): Ensure "position: relative" on containers.
 *   - createOrUpdateBox(container, host, idGen): Align a box to host bounds.
 *
 * Notes:
 *   - Boxes allow worm placement for non-container hosts (IMG/IFRAME/etc.).
 */

import { DEFAULTS } from "./constants.js";

/** Host overlay layer for worms/boxes (ignored by MO). */
export function ensureLayer() {
  let layer = document.getElementById("pp-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "pp-layer";
    layer.setAttribute("data-pp-layer", "");
    layer.style.position = "relative";
    document.body.appendChild(layer);
  }
  return layer;
}

/** Simple worm element. */
export function createWormEl() {
  const el = document.createElement("button");
  el.type = "button";
  el.className = DEFAULTS.wormClass;
  el.setAttribute("aria-label", "Page Worm");
  return el;
}

/** Ensure a positioning context on the container. */
export function makePositioningContext(containerEl) {
  const cs = getComputedStyle(containerEl);
  if (cs.position === "static") {
    containerEl.dataset.ppOldPosition = "static";
    containerEl.style.position = "relative";
    return true;
  }
  return false;
}

/** Create/update a box that overlays host inside container. */
export function createOrUpdateBox(containerEl, hostEl, idGen) {
  let id = hostEl.dataset.ppId;
  if (!id) hostEl.dataset.ppId = id = idGen();
  let box = containerEl.querySelector(`:scope > .pp-box[data-for='${id}']`);
  if (!box) {
    box = document.createElement("div");
    box.className = "pp-box";
    box.dataset.for = id;
    containerEl.appendChild(box);
  }
  const left = hostEl.offsetLeft,
    top = hostEl.offsetTop,
    w = hostEl.offsetWidth,
    h = hostEl.offsetHeight;
  box.style.left = left + "px";
  box.style.top = top + "px";
  box.style.width = w + "px";
  box.style.height = h + "px";
  return box;
}

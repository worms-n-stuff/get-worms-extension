/**
 * layer.js
 * -----------------------------------------------------------------------------
 * Purpose:
 *   DOM primitives for worm elements and host-aligned overlay boxes.
 *
 * Responsibilities:
 *   - createWormEl(): Construct a basic worm button (unstyled logic-wise).
 *   - makePositioningContext(el): Ensure "position: relative" on containers.
 *   - createOrUpdateBox(container, host, idGen): Align a box to host bounds.
 *
 * Notes:
 *   - Boxes allow worm placement for non-container hosts (IMG/IFRAME/etc.).
 */

import { DEFAULTS } from "./constants.js";

/** Build the base worm button element with class + aria labelling. */
export function createWormEl() {
  const el = document.createElement("button");
  el.type = "button";
  el.className = DEFAULTS.wormClass;
  el.setAttribute("aria-label", "Page Worm");
  el.dataset.pwOwned = "1";
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
  let id = hostEl.dataset.ppId;
  if (!id) hostEl.dataset.ppId = id = idGen();
  let box = containerEl.querySelector(`:scope > .pp-box[data-for='${id}']`);
  if (!box) {
    box = document.createElement("div");
    box.className = "pp-box";
    box.dataset.for = id;
    containerEl.appendChild(box);
  }
  box.dataset.pwOwned = "1";
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

/**
 * styles.js
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Inject a single <style> block with the worm UI and scroll-fade effect.
 *
 * Responsibilities:
 *   - injectStyles(): Idempotently append CSS once per document.
 *   - Define high z-index worm buttons with subtle hover effect.
 *   - Provide ".pp-scrolling" fade-out during active scroll.
 */

import { DEFAULTS } from "./constants.js";

/** Inject the overlay styles once, covering worm visuals and scroll fade behaviour. */
export function injectStyles() {
  if (document.getElementById("pp-style")) return;
  const css = `
  .${DEFAULTS.wormClass}{
    position: absolute;
    width: 16px; height: 16px;
    border-radius: 50%; border: 2px solid white;
    box-shadow: 0 2px 8px rgba(0,0,0,.25);
    background: #ff4d4f; color: white;
    cursor: pointer; z-index: 2147483647;
    transform: translate(-50%, -100%);
    transition: opacity 120ms ease;
    line-height: 0; padding: 0; border-width: 2px;
  }
  .${DEFAULTS.wormClass}::after{
    content: "";
    display: block;
    width: 8px; height: 8px;
    border-radius: 9999px;
    margin: 2px auto;   /* centers the inner dot */
    background: currentColor;
  }
  .pp-scrolling .${DEFAULTS.wormClass}{ opacity: 0; pointer-events: none; }
  .${DEFAULTS.wormClass}.${DEFAULTS.wormActiveClass}{ outline: 2px solid #1677ff; }
  .pp-box{ position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }
  .pp-box > .${DEFAULTS.wormClass}{ pointer-events: auto; }`;

  const style = document.createElement("style");
  style.id = "pp-style";
  style.textContent = css;
  document.head.appendChild(style);
}

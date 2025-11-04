/**
 * constants.js
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Centralized configuration and string constants for PageWorms.
 *
 * Responsibilities:
 *   - Provide a single source of truth for class names, UI timings, and storage keys.
 *   - Make it easy to tune behavior without touching core logic.
 */
export const DEFAULTS = {
    wormClass: "pw-worm",
    wormActiveClass: "pw-worm-active",
    maxTextContext: 256,
    throttleMs: 60,
    storageKeyPrefix: "pageworms::",
    algoVersion: "pw-v1",
};

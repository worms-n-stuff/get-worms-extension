/**
 * constants.js
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Config and constants for PageWorms.
 */
export const DEFAULTS = {
    wormClass: "pw-worm", // css class for worm elements
    wormActiveClass: "pw-worm-active", // css class for active worm elements
    maxTextContext: 256, // max chars for text quote context (prefix + suffix)
    throttleMs: 60,
    storageKeyPrefix: "pageworms::",
    algoVersion: "pw-v1",
};

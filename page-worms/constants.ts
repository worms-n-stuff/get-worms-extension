/**
 * constants.ts
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Shared configuration values and DOM metadata for PageWorms.
 */

export const DEFAULTS = {
  wormClass: "pw-worm", // css class for worm elements
  wormActiveClass: "pw-worm-active", // css class for active worm elements
  maxTextContext: 256, // max chars for text quote context (prefix + suffix)
  throttleMs: 60, // resize/scroll/mutation observers throttle delay
  storageKeyPrefix: "pageworms::", // used for local storage (both chrome and local storage adapter)
};

// Shared DOM metadata for PageWorm-owned nodes.
export const PW_OWNED_ATTR = "data-pw-owned";
export const PW_OWNED_SELECTOR = `[${PW_OWNED_ATTR}]`;
export const PW_OWNED_DATASET_KEY = "pwOwned";
export const PW_OWNED_DATASET_VALUE = "1";

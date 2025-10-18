/**
 * utils.js
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Small, generic utilities with zero DOM coupling.
 *
 * Responsibilities:
 *   - uuid(): RFC4122 v4 UUID with a crypto fallback.
 *   - throttle(fn, ms): Thin rate-limiter for expensive callbacks.
 *   - normalizeText(s): Canonicalize unicode + whitespace for robust matching.
 *   - getCanonicalUrl(): Strip query params; keep path + hash.
 *
 * Key Exports:
 *   - uuid, throttle, normalizeText, getCanonicalUrl
 */

/** UUID v4 (with crypto fallback). */
export function uuid() {
  const c = globalThis.crypto || window.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const buf = new Uint8Array(16);
  c.getRandomValues(buf);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Simple throttle: runs at most once per `ms`. */
export function throttle(fn, ms) {
  let t = 0,
    lastArgs = null,
    scheduled = false;
  return (...args) => {
    const now = Date.now();
    lastArgs = args;
    if (!scheduled) {
      scheduled = true;
      setTimeout(() => {
        t = Date.now();
        scheduled = false;
        fn(...lastArgs);
      }, Math.max(0, ms - (now - t)));
    }
  };
}

/** Normalize for robust text matching. */
export const normalizeText = (s) =>
  s.normalize("NFC").replace(/\s+/g, " ").trim();

/** Canonicalize URL (strip query, keep path+hash). */
export function getCanonicalUrl() {
  const u = new URL(location.href);
  u.search = "";
  return u.toString();
}

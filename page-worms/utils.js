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

/** RFC4122 v4 UUID using crypto.randomUUID when available (fallback to manual entropy). */
export function uuid() {
  const cryptoObj = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  if (!cryptoObj?.getRandomValues) {
    const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
    return template.replace(/[xy]/g, (ch) => {
      const r = Math.random() * 16;
      const v = ch === "x" ? r : (r & 0x3) | 0x8;
      return Math.floor(v).toString(16);
    });
  }
  const buf = new Uint8Array(16);
  cryptoObj.getRandomValues(buf);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Throttle helper that schedules at most one call per `ms`, replaying the latest args. */
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

/** Normalize text for anchoring: NFC transform plus whitespace collapsing. */
export const normalizeText = (s) =>
  (s ?? "")
    .toString()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();

/** Canonicalize URL for storage keys (strip query, preserve path + hash). */
export function getCanonicalUrl() {
  const u = new URL(location.href);
  u.search = "";
  return u.toString();
}

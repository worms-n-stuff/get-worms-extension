/**
 * storage.js
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Persistence adapters with a tiny async API for portability.
 *
 * Responsibilities:
 *   - LocalStorageAdapter: JSON encode/decode per-page worms.
 *   - ChromeStorageAdapter: Chrome extension storage parity.
 *
 * Adapter API:
 *   - get(url): Promise<Array> — return array of worm records for url.
 *   - set(url, arr): Promise<void> — persist full array atomically.
 *
 * Notes:
 *   - Callers provide canonical URL string as key.
 */

import { DEFAULTS } from "./constants.js";

export class LocalStorageAdapter {
  constructor(prefix = DEFAULTS.storageKeyPrefix) {
    this.prefix = prefix;
  }
  keyFor(url) {
    return `${this.prefix}${url}`;
  }
  async get(url) {
    try {
      return JSON.parse(localStorage.getItem(this.keyFor(url)) || "[]");
    } catch {
      return [];
    }
  }
  async set(url, arr) {
    localStorage.setItem(this.keyFor(url), JSON.stringify(arr));
  }
}

export class ChromeStorageAdapter {
  constructor(prefix = DEFAULTS.storageKeyPrefix) {
    this.prefix = prefix;
  }
  keyFor(url) {
    return `${this.prefix}${url}`;
  }
  async get(url) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) return resolve([]);
      chrome.storage.local.get([this.keyFor(url)], (res) =>
        resolve(res[this.keyFor(url)] || [])
      );
    });
  }
  async set(url, arr) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) return resolve();
      chrome.storage.local.set({ [this.keyFor(url)]: arr }, resolve);
    });
  }
}

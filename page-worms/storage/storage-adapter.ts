/**
 * storage
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Persistence adapters with a tiny async API for portability.
 *
 * Responsibilities:
 *   - LocalStorageAdapter: Generic local storage.
 *   - ChromeStorageAdapter: Local storage for chrome extensions.
 *
 * Adapter API:
 *   - get(url): Promise<Array> -> return array of worm records for url.
 *   - set(url, arr): Promise<void> -> persist full array atomically.
 *
 * Notes:
 *   - Callers provide canonical URL string as key.
 */

// global config
import { DEFAULTS } from "../constants.js";
// global types
import type { WormRecord } from "../types.js";
// storage types
import type { StorageAdapter, StorageOption } from "./types.js";

class LocalStorageAdapter implements StorageAdapter {
  private readonly prefix: string;

  constructor(prefix = DEFAULTS.storageKeyPrefix) {
    this.prefix = prefix;
  }

  keyFor(url: string): string {
    return `${this.prefix}${url}`;
  }

  async get(url: string): Promise<WormRecord[]> {
    try {
      const raw = localStorage.getItem(this.keyFor(url));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as WormRecord[]) : [];
    } catch {
      return [];
    }
  }

  async set(url: string, worms: WormRecord[]): Promise<void> {
    localStorage.setItem(this.keyFor(url), JSON.stringify(worms));
  }
}

class ChromeStorageAdapter implements StorageAdapter {
  private readonly prefix: string;

  constructor(prefix = DEFAULTS.storageKeyPrefix) {
    this.prefix = prefix;
  }

  keyFor(url: string): string {
    return `${this.prefix}${url}`;
  }

  async get(url: string): Promise<WormRecord[]> {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve([]);
        return;
      }
      chrome.storage.local.get([this.keyFor(url)], (res) => {
        const value = res[this.keyFor(url)] as unknown;
        resolve(Array.isArray(value) ? (value as WormRecord[]) : []);
      });
    });
  }

  async set(url: string, worms: WormRecord[]): Promise<void> {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve();
        return;
      }
      chrome.storage.local.set({ [this.keyFor(url)]: worms }, resolve);
    });
  }
}

export function createStorageAdapter(
  storageOption: StorageOption = "chrome"
): StorageAdapter {
  if (storageOption === "chrome") {
    return new ChromeStorageAdapter();
  }
  return new LocalStorageAdapter();
}

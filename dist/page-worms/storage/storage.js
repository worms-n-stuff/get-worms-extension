/**
 * storage
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Persistence adapters with a tiny async API for portability.
 *
 * Responsibilities:
 *   - LocalStorageAdapter: JSON encode/decode per-page worms.
 *   - ChromeStorageAdapter: Chrome extension storage parity.
 *
 * Adapter API:
 *   - get(url): Promise<Array> -> return array of worm records for url.
 *   - set(url, arr): Promise<void> -> persist full array atomically.
 *
 * Notes:
 *   - Callers provide canonical URL string as key.
 */
import { DEFAULTS } from "../constants.js";
export class LocalStorageAdapter {
    constructor(prefix = DEFAULTS.storageKeyPrefix) {
        this.prefix = prefix;
    }
    keyFor(url) {
        return `${this.prefix}${url}`;
    }
    async get(url) {
        try {
            const raw = localStorage.getItem(this.keyFor(url));
            if (!raw)
                return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    }
    async set(url, worms) {
        localStorage.setItem(this.keyFor(url), JSON.stringify(worms));
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
            if (!chrome?.storage?.local) {
                resolve([]);
                return;
            }
            chrome.storage.local.get([this.keyFor(url)], (res) => {
                const value = res[this.keyFor(url)];
                resolve(Array.isArray(value) ? value : []);
            });
        });
    }
    async set(url, worms) {
        return new Promise((resolve) => {
            if (!chrome?.storage?.local) {
                resolve();
                return;
            }
            chrome.storage.local.set({ [this.keyFor(url)]: worms }, resolve);
        });
    }
}
export function isStorageAdapter(value) {
    return (typeof value === "object" &&
        value !== null &&
        typeof value.get === "function" &&
        typeof value.set === "function");
}
export function createStorageAdapter(option) {
    if (!option || option === "local") {
        return new LocalStorageAdapter();
    }
    if (option === "chrome") {
        return new ChromeStorageAdapter();
    }
    if (isStorageAdapter(option)) {
        return option;
    }
    return new LocalStorageAdapter();
}

/**
 * storage-adapter.ts
 * -----------------------------------------------------------------------------
 * Persistence adapters for PageWorms with a thin async API.
 *
 * Responsibilities:
 *   - LocalStorageAdapter: browser localStorage fallback.
 *   - ChromeStorageAdapter: chrome.storage-backed persistence for extensions.
 *
 * Contract:
 *   - get(url): load all WormRecord entries for a canonical URL.
 *   - set(url, worms): persist the WormRecord array atomically.
 */
// global config
import { DEFAULTS } from "../constants.js";
class LocalStorageAdapter {
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
class ChromeStorageAdapter {
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
export function createStorageAdapter(storageOption = "chrome") {
    if (storageOption === "chrome") {
        return new ChromeStorageAdapter();
    }
    return new LocalStorageAdapter();
}

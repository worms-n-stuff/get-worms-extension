/**
 * storage-adapter.ts
 * -----------------------------------------------------------------------------
 * Persistence adapters for PageWorms with a thin async API.
 *
 * Responsibilities:
 *   - LocalStorageAdapter: browser localStorage fallback.
 *   - ChromeStorageAdapter: chrome.storage-backed persistence for extensions.
 *   - SupabaseStorageAdapter: remote persistence (implemented separately).
 */

import { DEFAULTS } from "../constants.js";
import type { WormFormData, WormRecord } from "../types.js";
import type { StorageAdapter, StorageOption, WormDraft } from "./types.js";
import { createSupabaseStorageAdapter } from "./supabase-adapter.js";

function normalizeTags(tags: string[]): string[] | null {
  return tags && tags.length ? tags : null;
}

function cloneWorm(worm: WormRecord): WormRecord {
  if (typeof structuredClone === "function") {
    return structuredClone(worm);
  }
  return JSON.parse(JSON.stringify(worm));
}

abstract class ArrayStorageAdapter implements StorageAdapter {
  protected abstract read(url: string): Promise<WormRecord[]>;
  protected abstract write(url: string, worms: WormRecord[]): Promise<void>;

  async list(url: string): Promise<WormRecord[]> {
    return this.read(url);
  }

  async create(url: string, payload: WormDraft): Promise<WormRecord> {
    const worms = await this.read(url);
    const now = new Date().toISOString();
    const nextId = this.nextId(worms);
    const worm: WormRecord = {
      id: nextId,
      created_at: now,
      updated_at: null,
      content: payload.content ?? "",
      tags: normalizeTags(payload.tags),
      status: payload.status,
      author_id: payload.author_id ?? null,
      position: payload.position,
      host_url: payload.host_url,
    };
    worms.push(worm);
    await this.write(url, worms);
    return cloneWorm(worm);
  }

  async update(url: string, wormId: number, updates: WormFormData): Promise<WormRecord> {
    const worms = await this.read(url);
    const idx = worms.findIndex((w) => w.id === wormId);
    if (idx === -1) {
      throw new Error(`Worm ${wormId} not found for url ${url}`);
    }
    const now = new Date().toISOString();
    const updated: WormRecord = {
      ...worms[idx],
      content: updates.content ?? "",
      tags: normalizeTags(updates.tags),
      status: updates.status,
      updated_at: now,
    };
    worms[idx] = updated;
    await this.write(url, worms);
    return cloneWorm(updated);
  }

  async remove(url: string, wormId: number): Promise<void> {
    const worms = await this.read(url);
    const next = worms.filter((w) => w.id !== wormId);
    if (next.length === worms.length) return; // nothing to remove
    await this.write(url, next);
  }

  private nextId(worms: WormRecord[]): number {
    const maxId = worms.reduce((max, worm) => {
      const id = Number(worm.id);
      return Number.isFinite(id) && id > max ? id : max;
    }, 0);
    return maxId + 1;
  }
}

function parseStoredWorms(value: unknown): WormRecord[] {
  if (Array.isArray(value)) return value as WormRecord[];
  return [];
}

class LocalStorageAdapter extends ArrayStorageAdapter {
  private readonly prefix: string;

  constructor(prefix = DEFAULTS.storageKeyPrefix) {
    super();
    this.prefix = prefix;
  }

  private keyFor(url: string): string {
    return `${this.prefix}${url}`;
  }

  protected async read(url: string): Promise<WormRecord[]> {
    if (typeof localStorage === "undefined") return [];
    try {
      const raw = localStorage.getItem(this.keyFor(url));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return parseStoredWorms(parsed);
    } catch {
      return [];
    }
  }

  protected async write(url: string, worms: WormRecord[]): Promise<void> {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(this.keyFor(url), JSON.stringify(worms));
  }
}

class ChromeStorageAdapter extends ArrayStorageAdapter {
  private readonly prefix: string;

  constructor(prefix = DEFAULTS.storageKeyPrefix) {
    super();
    this.prefix = prefix;
  }

  private keyFor(url: string): string {
    return `${this.prefix}${url}`;
  }

  protected async read(url: string): Promise<WormRecord[]> {
    if (!chrome?.storage?.local) return [];
    const key = this.keyFor(url);
    const res = await chrome.storage.local.get([key]);
    return parseStoredWorms(res[key]);
  }

  protected async write(url: string, worms: WormRecord[]): Promise<void> {
    if (!chrome?.storage?.local) return;
    await chrome.storage.local.set({ [this.keyFor(url)]: worms });
  }
}

export function createStorageAdapter(
  storageOption: StorageOption = "remote"
): StorageAdapter {
  if (storageOption === "local") {
    return new LocalStorageAdapter();
  }
  if (storageOption === "chrome") {
    return new ChromeStorageAdapter();
  }
  if (storageOption === "remote") {
    return createSupabaseStorageAdapter();
  }
  return new ChromeStorageAdapter();
}

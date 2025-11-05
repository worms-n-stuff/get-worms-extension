import type { WormRecord } from "../types.js";

export interface StorageAdapter {
  get(url: string): Promise<WormRecord[]>;
  set(url: string, worms: WormRecord[]): Promise<void>;
}

export type StorageOption = "local" | "chrome" | "remote";
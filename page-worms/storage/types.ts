import type { WormRecord } from "../types.js";

export interface StorageAdapter {
  get(url: string): Promise<WormRecord[]>;
  set(url: string, worms: WormRecord[]): Promise<void>;
}

// types of storage adapters. 
// Local is browser localStorage, 
// chrome is chrome extension local storage, 
// remote is storage on a remote database
export type StorageOption = "local" | "chrome" | "remote";
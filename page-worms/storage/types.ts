import type { WormFormData, WormPosition, WormRecord } from "../types.js";

export interface StorageAdapter {
  list(url: string): Promise<WormRecord[]>;
  create(url: string, payload: WormDraft): Promise<WormRecord>;
  update(url: string, wormId: number, updates: WormFormData): Promise<WormRecord>;
  remove(url: string, wormId: number): Promise<void>;
}

export type WormDraft = WormFormData & {
  position: WormPosition;
  host_url: string;
  author_id?: number | null;
};

// types of storage adapters. 
// Local is browser localStorage, 
// chrome is chrome extension local storage, 
// remote is storage on a remote database
export type StorageOption = "local" | "chrome" | "remote";

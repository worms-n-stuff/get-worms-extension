import type { WormPosition } from "../types.js";

export type AnchorCache = unknown;

export type ResolvedAnchor = {
  hostEl: HTMLElement | null;
};

export type CreateAnchorPositionOptions = {
  target: Node | null;
  clickX: number;
  clickY: number;
  selection: Range | null;
};

export interface AnchoringAdapter<Cache = AnchorCache> {
  buildTextCache(): Cache;
  createPosition(options: CreateAnchorPositionOptions): WormPosition;
  resolvePosition(position: WormPosition, cache: Cache | null): ResolvedAnchor;
}

export type AnchoringModuleOption = "dom" | AnchoringAdapter;

export function isAnchoringAdapter(value: unknown): value is AnchoringAdapter {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AnchoringAdapter).buildTextCache === "function" &&
    typeof (value as AnchoringAdapter).createPosition === "function" &&
    typeof (value as AnchoringAdapter).resolvePosition === "function"
  );
}

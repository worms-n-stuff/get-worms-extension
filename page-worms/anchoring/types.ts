import type { WormPosition } from "../types.js";

/** a dom text node, start and end is the char offset in context of the document text */ 
export type TextNode = {
  node: Text;
  text: string;
  start: number;
  end: number;
};

/** cache for faster anchoring */
export type DomAnchorCache = {
  nodes: TextNode[];
  allText: string;
};

/** the options for createPosition */
export type CreateAnchorOptions = {
  target: Node | null;
  clickX: number;
  clickY: number;
  selection: Range | null;
};

/** defines anchoring adapter, responsible for handling creation and resolution of worm positions */
// TODO: investigate if we could unexpose textCache. Perhaps keep cache internal to adapter?
export interface AnchoringAdapter {
  buildTextCache(): DomAnchorCache;
  /** create a new worm position given needed context */
  createPosition(options: CreateAnchorOptions): WormPosition;
  /** resolve a worm position to an element on the page */
  resolvePosition(position: WormPosition, cache: DomAnchorCache | null): HTMLElement | null;
}
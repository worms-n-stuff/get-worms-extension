/**
 * Shared type definitions for the page-worms modules.
 */

export type WormStatus = "private" | "friends" | "public";

export type TextQuoteAnchor = {
  exact: string;
  prefix: string;
  suffix: string;
};

export type ElementBoxAnchor = {
  tag: string;
  attrs: Record<string, string>;
  relBoxPct: {
    x: number;
    y: number;
  };
};

export type WormPosition = {
  dom: {
    selector: string;
  };
  textQuote: TextQuoteAnchor | null;
  element: ElementBoxAnchor;
  fallback: {
    scrollPct: number;
  };
};

export type WormRecord = {
  id: number;
  created_at: string;
  updated_at: string | null;
  content: string;
  status: WormStatus;
  tags: string[] | null;
  author_id: number | null;
  position: WormPosition;
  host_url: string;
};

export type WormFormData = {
  content: string;
  tags: string[];
  status: WormStatus;
};

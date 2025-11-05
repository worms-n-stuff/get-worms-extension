// anchoring types
import type {
  AnchoringAdapter,
  CreateAnchorOptions,
  DomAnchorCache,
} from "./types.js";

// global types
import type { WormPosition } from "../types.js";

// global config
import { DEFAULTS } from "../constants.js";

// utility functions
import { normalizeText } from "../utils.js";

// anchoring specific helpers
import {
  textContentStream,
  selectionContext,
  elementBoxPct,
  stableAttrs,
  docScrollPct,
  findQuoteRange,
  elementForRange,
  cssPath,
} from "./anchoring-helpers.js";

class DomAnchoringAdapter implements AnchoringAdapter {
  buildTextCache(): DomAnchorCache {
    const root = document.body ?? document;
    const nodes = textContentStream(root);
    const allText = nodes.map((n) => n.text).join("");
    return { nodes, allText };
  }

  createPosition({
    target,
    clickX,
    clickY,
    selection,
  }: CreateAnchorOptions): WormPosition {
    const el =
      target instanceof Element
        ? target
        : target && "parentElement" in target
        ? target.parentElement
        : null;
    const selector = el ? cssPath(el) : "";

    let textQuote: WormPosition["textQuote"] = null;
    if (selection) {
      const { prefix, suffix } = selectionContext(
        selection,
        DEFAULTS.maxTextContext
      );
      const exact = selection
        .toString()
        .normalize("NFC")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1024);
      textQuote = { exact, prefix, suffix };
    }

    const hostEl = (el ??
      document.body ??
      document.documentElement ??
      document.createElement("div")) as HTMLElement;
    const pct = elementBoxPct(hostEl, clickX, clickY);

    return {
      dom: { selector },
      textQuote,
      element: {
        tag: hostEl?.tagName || "BODY",
        attrs: stableAttrs(hostEl),
        relBoxPct: { x: pct.x, y: pct.y },
      },
      fallback: { scrollPct: docScrollPct() },
    };
  }

  resolvePosition(
    position: WormPosition,
    cache: DomAnchorCache | null
  ): HTMLElement | null {
    if (position.dom.selector && position.textQuote?.exact) {
      try {
        const el = document.querySelector(position.dom.selector);
        if (
          el instanceof HTMLElement &&
          normalizeText(el.innerText || "").includes(
            normalizeText(position.textQuote.exact)
          )
        ) {
          return el;
        }
      } catch {}
    }

    if (position.textQuote?.exact) {
      const range = findQuoteRange(
        position.textQuote.exact,
        position.textQuote.prefix,
        position.textQuote.suffix,
        cache
      );
      if (range) {
        const rects = range.getClientRects();
        if (rects.length) {
          let hostEl = elementForRange(range);
          if (hostEl === document.body && position.dom.selector) {
            try {
              const sEl = document.querySelector(position.dom.selector);
              if (sEl instanceof HTMLElement) hostEl = sEl;
            } catch {}
          }
          return hostEl instanceof HTMLElement ? hostEl : null;
        }
      }
    }

    let hostEl: HTMLElement | null = null;
    if (position.dom.selector) {
      try {
        const el = document.querySelector(position.dom.selector);
        if (el instanceof HTMLElement) hostEl = el;
      } catch {}
    }
    if (!hostEl) {
      const tag = position.element.tag;
      if (tag) {
        const cands = Array.from(document.getElementsByTagName(tag)).filter(
          (el): el is HTMLElement => el instanceof HTMLElement
        );
        const want = position.element.attrs;
        hostEl =
          cands.find((el) =>
            Object.keys(want).every(
              (k) => (el.getAttribute(k) || "") === want[k]
            )
          ) || null;
      }
    }
    if (!hostEl) {
      const fallback = document.body ?? document.documentElement;
      hostEl = fallback instanceof HTMLElement ? fallback : null;
    }
    return hostEl;
  }
}

export function createAnchoringAdapter(): AnchoringAdapter {
  return new DomAnchoringAdapter();
}

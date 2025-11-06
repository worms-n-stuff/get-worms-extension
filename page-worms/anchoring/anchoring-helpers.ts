/**
 * anchoring-helpers.ts
 * -----------------------------------------------------------------------------
 * Shared helpers for the DOM anchoring adapter.
 *
 * Responsibilities:
 *   - Generate stable selectors and attribute fingerprints.
 *   - Build searchable text caches and resolve quote ranges.
 *   - Provide geometry helpers for click-relative positioning.
 */

import { normalizeText } from "../utils.js";
import type { TextNode, DomAnchorCache } from "./types.js";

/** generate a unique, stable CSS selector path for a given DOM element */
export function getCssPath(el: Element | null): string {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return "";

  // the path
  const parts: string[] = [];

  // walk up dom tree until <body> element or element with id
  while (el && el.nodeType === Node.ELEMENT_NODE && el !== document.body) {
    const id = el.getAttribute("id") ?? "";
    if (id && /^[A-Za-z][\w\-\:\.]+$/.test(id)) {
      parts.unshift(`#${CSS.escape(id)}`);
      break;
    }

    // tag name
    let tag = el.tagName.toLowerCase();

    // stable attributes
    const attrs = Array.from(el.attributes) as Attr[];
    const getStableAttrs = attrs
      .filter((a) => /^data-|^aria-|^role$/.test(a.name))
      .slice(0, 2)
      .map((a) => `[${a.name}="${a.value}"]`)
      .join("");
    if (getStableAttrs) tag += getStableAttrs;

    // nth of type
    let idx = 1,
      sib = el;
    while ((sib = sib.previousElementSibling))
      if (sib.tagName === el.tagName) idx++;
    parts.unshift(`${tag}:nth-of-type(${idx})`);

    el = el.parentElement;
  }

  return parts.length ? parts.join(" > ") : "";
}

/** Return all visible text nodes and their relevant info. */
export function getAllTextNode(
  root: Element | Document = document.body ?? document
): TextNode[] {
  /** Conditions for non visible elements:
   * - Display none or hidden
   * - not in layout flow (e.g. width/height 0)
   */
  function isVisible(el: Element | null): boolean {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    return el.getClientRects().length > 0;
  }

  // Reject if no parent, in script/style/noscript/template, empty, or not visible
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (p.matches?.("script,style,noscript,template"))
        return NodeFilter.FILTER_REJECT;
      if (!/\S/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
      return isVisible(p) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const nodes: TextNode[] = [];
  let total = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const txt = normalizeText(textNode.nodeValue);
    if (!txt) continue;
    nodes.push({
      node: textNode,
      text: txt,
      start: total,
      end: total + txt.length,
    });
    total += txt.length;
  }
  return nodes;
}

/** Given a text quote, find the corresponding range in the document. */
export function getQuoteRange(
  quote: string,
  prefix = "",
  suffix = "",
  cached?: DomAnchorCache | null
): Range | null {
  /** find the best matching range for a quote in the text, and return its start index */
  function findBestMatch(
    allText: string,
    quote: string,
    prefix = "",
    suffix = ""
  ): number {
    /** Count matching characters between two strings, either from the start or end. */
    function commonOverlapLen(a: string, b: string, fromEnd = false): number {
      const len = Math.min(a.length, b.length);
      let i = 0;
      while (i < len) {
        const ai = fromEnd ? a.charCodeAt(a.length - 1 - i) : a.charCodeAt(i);
        const bi = fromEnd ? b.charCodeAt(b.length - 1 - i) : b.charCodeAt(i);
        if (ai !== bi) break;
        i++;
      }
      return i;
    }

    const hits = [];
    let idx = -1,
      from = 0;
    while ((idx = allText.indexOf(quote, from)) !== -1) {
      // score by how well prefix matches the preceding context
      const pre = allText.slice(Math.max(0, idx - prefix.length), idx);
      const suf = allText.slice(
        idx + quote.length,
        idx + quote.length + suffix.length
      );
      let score = 1;
      if (prefix) score += commonOverlapLen(pre, prefix); // how much of the wanted prefix matches
      if (suffix) score += commonOverlapLen(suf, suffix); // how much of the wanted suffix matches
      hits.push({ idx, score });
      from = idx + 1;
    }
    hits.sort((a, b) => b.score - a.score);
    return hits[0]?.idx ?? -1;
  }

  if (!quote) return null;
  const nodes = cached?.nodes ?? getAllTextNode(document.body ?? document);
  const quoteNorm = normalizeText(quote);

  // build the corpus we will map back onto
  const allText = cached?.allText ?? nodes.map((n) => n.text).join("");

  const startIdx = findBestMatch(allText, quoteNorm, prefix, suffix);
  if (startIdx === -1) return null;
  const endIdx = startIdx + quoteNorm.length;

  const range = document.createRange();
  let sNode: Text | null = null;
  let sOffset = 0;
  let eNode: Text | null = null;
  let eOffset = 0;

  // map offsets to dom range
  for (const seg of nodes) {
    if (sNode == null && startIdx >= seg.start && startIdx <= seg.end) {
      sNode = seg.node;
      sOffset = startIdx - seg.start;
    }
    if (eNode == null && endIdx >= seg.start && endIdx <= seg.end) {
      eNode = seg.node;
      eOffset = endIdx - seg.start;
      break;
    }
  }
  if (sNode && eNode) {
    range.setStart(sNode, Math.max(0, Math.min(sNode.length, sOffset)));
    range.setEnd(eNode, Math.max(0, Math.min(eNode.length, eOffset)));
    return range;
  }
  return null;
}

/** Given the element and the absolute click point (in px), find the click point relative to the element box (in percent) */
export function getClickRelativePos(
  el: Element,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return { x: 0.5, y: 0.5 };
  const x = (clientX - r.left) / r.width;
  const y = (clientY - r.top) / r.height;
  return {
    x: clamp01(x),
    y: clamp01(y),
  };
}

/** Given a text selection range, find the nearest meaningful block or inline element that contains it (e.g. p, h1, li, blockquote, div, etc.) */
export function getRangeContainer(range: Range): Element {
  let node: Node | null = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) {
    node = (node as Text).parentElement;
  }
  const element = node instanceof Element ? node : null;
  const fallback = document.body ?? document.documentElement;
  return (
    element?.closest(
      "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,code,figure,section,article,div,span,a"
    ) || fallback
  );
}

/** Returns up to max normalized characters immediately before and after a selection */
export function selectionContext(
  range: Range,
  max: number
): { prefix: string; suffix: string } {
  /**
   * Resolve a DOM Range boundary (start or end) into a concrete text node
   * and its character offset within that node.
   */
  function resolveBoundary(
    range: Range,
    side: "start" | "end"
  ): { node: Node | null; charOffset: number } {
    const isStart = side === "start";
    const container = isStart ? range.startContainer : range.endContainer;
    const offset = isStart ? range.startOffset : range.endOffset;

    // Case 1: boundary is directly inside a text node → trivial mapping.
    if (container.nodeType === Node.TEXT_NODE) {
      return { node: container, charOffset: offset };
    }

    // Case 2: boundary lies inside an element (offset = child index).
    const element = container as Element;
    const childCount = element.childNodes.length;
    const idx = Math.max(0, Math.min(offset, childCount));

    // Select an initial seed node based on boundary side and offset:
    //  - For "start": if at index 0, stay on the element (so walker moves left/out);
    //                 otherwise take the previous child at idx − 1.
    //  - For "end":   if at index = length, stay on the element (so walker moves right/out);
    //                 otherwise take the child at idx.
    let currentNode: Node | null;
    if (isStart) {
      currentNode = idx === 0 ? element : element.childNodes[idx - 1];
      // Descend to the deepest leaf toward the left edge.
      while (currentNode && currentNode.lastChild && currentNode !== element) {
        currentNode = currentNode.lastChild;
      }
    } else {
      currentNode = idx === childCount ? element : element.childNodes[idx];
      // Descend to the deepest leaf toward the right edge.
      while (currentNode && currentNode.firstChild && currentNode !== element) {
        currentNode = currentNode.firstChild;
      }
    }

    // If the resolved node is a text node, compute its internal offset:
    //  - left/start side → offset at end of text
    //  - right/end side  → offset at beginning
    if (currentNode && currentNode.nodeType === Node.TEXT_NODE) {
      const charOffset = isStart ? (currentNode as Text).data.length : 0;
      return { node: currentNode, charOffset };
    }

    // Otherwise return the non-text node (element, comment, etc.);
    // the grabText walker will step outward to a suitable sibling.
    return { node: currentNode, charOffset: 0 };
  }

  /** Return up to `need` normalized characters adjacent to (left/right of) a node + offset. -1 for left, 1 for right. */
  function grabText(
    startNode: Node | null,
    startOffset: number,
    maxChars: number,
    direction: -1 | 1
  ): string {
    let collectedText = "";
    let currentNode = startNode;

    // If the seed is a text node, only slice from offset in that first iteration.
    const shouldSliceFirst = startNode?.nodeType === Node.TEXT_NODE;
    let isFirstIteration = true;

    while (currentNode && maxChars > 0) {
      // Collect text content if this is a visible text node.
      if (
        currentNode.nodeType === Node.TEXT_NODE &&
        (currentNode as Node).parentElement &&
        !(currentNode as Node).parentElement!.matches(
          "script,style,noscript,template"
        )
      ) {
        const normalized = normalizeText((currentNode as Text).nodeValue || "");

        if (direction < 0) {
          // Moving left: prepend text (slice left of offset on first iteration)
          collectedText =
            (isFirstIteration && shouldSliceFirst
              ? normalized.slice(0, startOffset)
              : normalized) + collectedText;
        } else {
          // Moving right: append text (slice right of offset on first iteration)
          collectedText +=
            isFirstIteration && shouldSliceFirst
              ? normalized.slice(startOffset)
              : normalized;
        }

        if (collectedText.length >= maxChars) break;
        isFirstIteration = false;
      }

      // Move to the next (or previous) sibling text node
      let sibling: Node | null =
        direction < 0 ? currentNode.previousSibling : currentNode.nextSibling;
      while (sibling && sibling.nodeType !== Node.TEXT_NODE) {
        sibling = direction < 0 ? sibling.previousSibling : sibling.nextSibling;
      }

      // If no sibling, move up to parent and continue traversal outward
      if (!sibling) {
        currentNode = currentNode.parentNode;
        if (!currentNode) break;
        currentNode =
          direction < 0 ? currentNode.previousSibling : currentNode.nextSibling;
        if (!currentNode) break;

        // Descend to the deepest leaf node in that direction
        while (direction < 0 ? currentNode.lastChild : currentNode.firstChild) {
          currentNode =
            direction < 0 ? currentNode.lastChild! : currentNode.firstChild!;
        }
      } else {
        currentNode = sibling;
      }

      // Update offset for the next node
      if (currentNode && currentNode.nodeType === Node.TEXT_NODE) {
        startOffset =
          direction < 0 ? ((currentNode as Text).nodeValue || "").length : 0;
      }

      isFirstIteration = false;
    }

    // Clip to requested size (right-trim for leftward traversal)
    return direction < 0
      ? collectedText.slice(-maxChars)
      : collectedText.slice(0, maxChars);
  }

  const { node: startNode, charOffset: startOffset } = resolveBoundary(
    range,
    "start"
  );
  const { node: endNode, charOffset: endOffset } = resolveBoundary(
    range,
    "end"
  );

  return {
    prefix: startNode ? grabText(startNode, startOffset, max, -1) : "",
    suffix: endNode ? grabText(endNode, endOffset, max, 1) : "",
  };
}

/** Whitelist of stable attributes to capture */
export function getStableAttrs(el: Element): Record<string, string> {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return {};
  const out: Record<string, string> = {};
  for (const a of Array.from(el.attributes) as Attr[]) {
    if (/^(data-|aria-|role$|alt$|title$)/.test(a.name)) {
      out[a.name] = a.value.slice(0, 256);
    }
  }
  if (el.tagName === "IMG") {
    const src = el.getAttribute("src");
    if (src) out.src = src;
  }
  return out;
}

/** Document vertical scroll percentage */
export function getScrollPercentage(): number {
  const doc = document.documentElement;
  const h = doc.scrollHeight - doc.clientHeight;
  return h <= 0 ? 0 : doc.scrollTop / h;
}

/** Get coarse selector (i.e. a stable parent/ancestor node for anchoring) */
export function getCoarseContainer(el: Element): Element {
  /** climb a few levels until we hit a block-ish ancestor or enough text */
  function getBlockAncestor(el: Element, maxHops = 4): Element | null {
    let cur: Element | null = el;
    let hops = 0;
    while (cur && hops < maxHops) {
      const cs = getComputedStyle(cur);
      const isBlockish = cs.display !== "inline";
      const textLen = normalizeText(cur.textContent || "").length;
      if (isBlockish && textLen >= 64) return cur;
      cur = cur.parentElement;
      hops++;
    }
    return el.closest("div,section,article,main") || el;
  }

  // Prefer semantic/article-like containers
  const coarse =
    el.closest(
      [
        "article",
        "section",
        "main",
        "[role='main']",
        ".content",
        ".post",
        ".entry",
        ".markdown-body",
        ".prose",
      ].join(",")
    ) || getBlockAncestor(el);

  return coarse ?? document.body ?? document.documentElement;
}

/** clamps percentages to [0, 1] */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Check if one rectangle fully contains another */
export function rectContains(
  outer: DOMRect | DOMRectReadOnly,
  inner: DOMRect | DOMRectReadOnly
): boolean {
  if (!outer || !inner) return false;
  return (
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom
  );
}
/**
 * dom-anchors.js
 * -----------------------------------------------------------------------------
 * Purpose:
 *   DOM-anchoring helpers that resolve stable references for worms.
 *
 * Responsibilities:
 *   - cssPath(el): Generate resilient CSS selectors avoiding ephemeral classes.
 *   - textContentStream(): Iterate visible text nodes with global offsets.
 *   - findQuoteRange(exact, prefix, suffix): Map a TextQuote to a DOM Range.
 *   - elementForRange(range): Choose a sensible host element for a selection.
 *   - selectionContext(range, max): Build prefix/suffix for TextQuote anchors.
 *   - elementBoxPct(el, x, y): Compute relative (x,y) within element bounds.
 *   - stableAttrs(el): Whitelist stable attributes for fuzzy re-anchoring.
 *   - docScrollPct(): Vertical document scroll percentage.
 *
 * Key Exports:
 *   - cssPath, textContentStream, findQuoteRange, elementForRange,
 *     selectionContext, elementBoxPct, stableAttrs, docScrollPct
 *
 * Design Notes:
 *   - Avoid reading from script/style/noscript/template nodes.
 *   - Keep logic best-effort and fast; the actual location algorithm combines multiple anchors.
 */

import { normalizeText } from "./utils.js";

/** Resilient CSS path (avoids ephemeral classes). */
export function cssPath(el) {
  if (!el || el.nodeType !== 1) return "";
  const parts = [];
  while (el && el.nodeType === 1 && el !== document.body) {
    const id = el.getAttribute("id");
    if (id && /^[A-Za-z][\w\-\:\.]+$/.test(id)) {
      parts.unshift(`#${CSS.escape(id)}`);
      break;
    }
    let tag = el.tagName.toLowerCase();
    const stableAttrs = Array.from(el.attributes)
      .filter((a) => /^data-|^aria-|^role$/.test(a.name))
      .slice(0, 2)
      .map((a) => `[${a.name}="${a.value}"]`)
      .join("");
    if (stableAttrs) tag += stableAttrs;

    let idx = 1,
      sib = el;
    while ((sib = sib.previousElementSibling))
      if (sib.tagName === el.tagName) idx++;
    parts.unshift(`${tag}:nth-of-type(${idx})`);
    el = el.parentElement;
  }
  return parts.length ? parts.join(" > ") : "";
}

/** Stream of visible text nodes, with global offsets. */
export function textContentStream(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (p.matches?.("script,style,noscript,template"))
        return NodeFilter.FILTER_REJECT;
      return /\S/.test(n.nodeValue)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  let total = 0,
    node;
  while ((node = walker.nextNode())) {
    const txt = normalizeText(node.nodeValue);
    if (!txt) continue;
    nodes.push({ node, text: txt, start: total, end: total + txt.length });
    total += txt.length;
  }
  return { nodes, totalLen: total };
}

/** Best-effort TextQuote re-anchoring to DOM Range. */
export function findQuoteRange(exact, prefix, suffix) {
  const allText = normalizeText(document.body.innerText || "");
  const exactNorm = normalizeText(exact || "");
  if (!exactNorm) return null;

  const startIdx = allText.indexOf(exactNorm);
  if (startIdx === -1) return null;
  const endIdx = startIdx + exactNorm.length;

  const { nodes } = textContentStream(document.body);
  const range = document.createRange();
  let sNode = null,
    sOffset = 0,
    eNode = null,
    eOffset = 0;

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

/** Relative click point within element box. */
export function elementBoxPct(el, clientX, clientY) {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return { x: 0.5, y: 0.5 };
  return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height };
}

/** Choose a sensible host for a text range (block/inline). */
export function elementForRange(range) {
  let node = range.startContainer;
  if (node.nodeType === 3) node = node.parentElement;
  return (
    node?.closest(
      "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,code,figure,section,article,div,span,a"
    ) || document.body
  );
}

/** Build prefix/suffix context around a selection range. */
export function selectionContext(range, max) {
  function grabLeft(node, offset, need) {
    let out = "",
      n = node,
      o = offset;
    while (n && need > 0) {
      if (
        n.nodeType === 3 &&
        n.parentElement &&
        !n.parentElement.matches("script,style,noscript,template")
      ) {
        const text = normalizeText(n.nodeValue || "");
        out = (n === node ? text.slice(0, o) : text) + out;
        if (out.length >= need) break;
      }
      let prev = n.previousSibling;
      while (prev && prev.nodeType !== 3) prev = prev.previousSibling;
      if (!prev) {
        n = n.parentNode;
        if (!n || !n.previousSibling) break;
        n = n.previousSibling;
        while (n && n.lastChild) n = n.lastChild;
      } else n = prev;
      o = n && n.nodeType === 3 ? (n.nodeValue || "").length : 0;
    }
    return out.slice(-need);
  }

  function grabRight(node, offset, need) {
    let out = "",
      n = node,
      o = offset;
    while (n && need > 0) {
      if (
        n.nodeType === 3 &&
        n.parentElement &&
        !n.parentElement.matches("script,style,noscript,template")
      ) {
        const text = normalizeText(n.nodeValue || "");
        out += n === node ? text.slice(o) : text;
        if (out.length >= need) break;
      }
      let next = n.nextSibling;
      while (next && next.nodeType !== 3) next = next.nextSibling;
      if (!next) {
        n = n.parentNode;
        if (!n || !n.nextSibling) break;
        n = n.nextSibling;
        while (n && n.firstChild) n = n.firstChild;
      } else n = next;
      o = 0;
    }
    return out.slice(0, need);
  }

  const sc =
    range.startContainer.nodeType === 3
      ? range.startContainer
      : range.startContainer.firstChild;
  const ec =
    range.endContainer.nodeType === 3
      ? range.endContainer
      : range.endContainer.firstChild;
  const so = range.startOffset,
    eo = range.endOffset;

  return {
    prefix: sc ? grabLeft(sc, so, max) : "",
    suffix: ec ? grabRight(ec, eo, max) : "",
  };
}

/** Whitelist of stable attributes to capture. */
export function stableAttrs(el) {
  if (!el || el.nodeType !== 1) return {};
  const out = {};
  for (const a of el.attributes) {
    if (/^(data-|aria-|role$|alt$|title$)/.test(a.name))
      out[a.name] = a.value.slice(0, 256);
  }
  if (el.tagName === "IMG" && el.getAttribute("src"))
    out.src = el.getAttribute("src");
  return out;
}

/** Document vertical scroll percentage. */
export function docScrollPct() {
  const doc = document.documentElement;
  const h = doc.scrollHeight - doc.clientHeight;
  return h <= 0 ? 0 : doc.scrollTop / h;
}

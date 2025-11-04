/**
 * dom-anchors.js
 * -----------------------------------------------------------------------------
 * Purpose:
 *   DOM-anchoring helpers that resolve stable references for worms.
 *
 * Responsibilities:
 *   - cssPath(el): Generate resilient CSS selectors avoiding ephemeral classes.
 *   - textContentStream(): Iterate visible text nodes with cached offsets.
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
    if (!el || el.nodeType !== Node.ELEMENT_NODE)
        return "";
    const parts = [];
    while (el && el.nodeType === Node.ELEMENT_NODE && el !== document.body) {
        const id = el.getAttribute("id") ?? "";
        if (id && /^[A-Za-z][\w\-\:\.]+$/.test(id)) {
            parts.unshift(`#${CSS.escape(id)}`);
            break;
        }
        let tag = el.tagName.toLowerCase();
        const attrs = Array.from(el.attributes);
        const stableAttrs = attrs
            .filter((a) => /^data-|^aria-|^role$/.test(a.name))
            .slice(0, 2)
            .map((a) => `[${a.name}="${a.value}"]`)
            .join("");
        if (stableAttrs)
            tag += stableAttrs;
        let idx = 1, sib = el;
        while ((sib = sib.previousElementSibling))
            if (sib.tagName === el.tagName)
                idx++;
        parts.unshift(`${tag}:nth-of-type(${idx})`);
        el = el.parentElement;
    }
    return parts.length ? parts.join(" > ") : "";
}
/** Return visible text nodes with normalized text and running offsets. */
export function textContentStream(root = document.body ?? document) {
    /** Exclude non visible elements. Includes:
     * - Display none or hidden
     * - not in layout flow (e.g. width/height 0)
     */
    function isVisible(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE)
            return false;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden")
            return false;
        return el.getClientRects().length > 0;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
            const p = n.parentElement;
            if (!p)
                return NodeFilter.FILTER_REJECT;
            if (p.matches?.("script,style,noscript,template"))
                return NodeFilter.FILTER_REJECT;
            if (!/\S/.test(n.nodeValue))
                return NodeFilter.FILTER_REJECT;
            return isVisible(p) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
    });
    const nodes = [];
    let total = 0;
    let node;
    while ((node = walker.nextNode())) {
        const textNode = node;
        const txt = normalizeText(textNode.nodeValue);
        if (!txt)
            continue;
        nodes.push({
            node: textNode,
            text: txt,
            start: total,
            end: total + txt.length,
        });
        total += txt.length;
    }
    return { nodes, totalLen: total };
}
/** Best-effort TextQuote re-anchoring that can reuse cached text streams. */
export function findQuoteRange(exact, prefix = "", suffix = "", cached) {
    /**
     * Find the best matching range for a quote in the text.
     * @param {string} allText
     * @param {string} exact
     * @param {string} prefix
     * @param {string} suffix
     * @returns {number}
     */
    function findBestMatch(allText, exact, prefix = "", suffix = "") {
        /**
         * Count matching characters between two strings, either from the start or end.
         * @param {string} a
         * @param {string} b
         * @param {boolean} [fromEnd=false] - If true, compare from the end (suffix).
         * @returns {number} Number of matching characters.
         */
        function commonOverlapLen(a, b, fromEnd = false) {
            const len = Math.min(a.length, b.length);
            let i = 0;
            while (i < len) {
                const ai = fromEnd ? a.charCodeAt(a.length - 1 - i) : a.charCodeAt(i);
                const bi = fromEnd ? b.charCodeAt(b.length - 1 - i) : b.charCodeAt(i);
                if (ai !== bi)
                    break;
                i++;
            }
            return i;
        }
        const hits = [];
        let idx = -1, from = 0;
        while ((idx = allText.indexOf(exact, from)) !== -1) {
            // score by how well prefix matches the preceding context
            const pre = allText.slice(Math.max(0, idx - prefix.length), idx);
            const suf = allText.slice(idx + exact.length, idx + exact.length + suffix.length);
            let score = 1;
            if (prefix)
                score += commonOverlapLen(pre, prefix); // how much of the wanted prefix matches
            if (suffix)
                score += commonOverlapLen(suf, suffix); // how much of the wanted suffix matches
            hits.push({ idx, score });
            from = idx + 1;
        }
        hits.sort((a, b) => b.score - a.score);
        return hits[0]?.idx ?? -1;
    }
    if (!exact)
        return null;
    const nodes = cached?.nodes ?? textContentStream(document.body ?? document).nodes;
    const exactNorm = normalizeText(exact);
    // Build the same corpus we will map back onto
    const allText = cached?.allText ??
        nodes.map((n) => n.text).join("");
    const startIdx = findBestMatch(allText, exactNorm, prefix, suffix);
    if (startIdx === -1)
        return null;
    const endIdx = startIdx + exactNorm.length;
    const range = document.createRange();
    let sNode = null;
    let sOffset = 0;
    let eNode = null;
    let eOffset = 0;
    // Map offsets → DOM Range
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
/** Relative click point within element box, falling back to center when zero-sized. */
export function elementBoxPct(el, clientX, clientY) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0)
        return { x: 0.5, y: 0.5 };
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height };
}
/** Choose a sensible host for a text range (block/inline). */
export function elementForRange(range) {
    let node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
        node = node.parentElement;
    }
    const element = node instanceof Element ? node : null;
    const fallback = document.body ?? document.documentElement;
    return (element?.closest("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,code,figure,section,article,div,span,a") || fallback);
}
/** Build prefix/suffix context around a selection range, constrained by `max`. */
export function selectionContext(range, max) {
    function grabLeft(node, offset, need) {
        let out = "", n = node, o = offset;
        while (n && need > 0) {
            if (n.nodeType === Node.TEXT_NODE &&
                n.parentElement &&
                !n.parentElement.matches("script,style,noscript,template")) {
                const txtNode = n;
                const text = normalizeText(txtNode.nodeValue || "");
                out = (n === node ? text.slice(0, o) : text) + out;
                if (out.length >= need)
                    break;
            }
            let prev = n.previousSibling;
            while (prev && prev.nodeType !== Node.TEXT_NODE)
                prev = prev.previousSibling;
            if (!prev) {
                n = n.parentNode;
                if (!n || !n.previousSibling)
                    break;
                n = n.previousSibling;
                while (n && n.lastChild)
                    n = n.lastChild;
            }
            else {
                n = prev;
            }
            o = n && n.nodeType === Node.TEXT_NODE ? (n.nodeValue || "").length : 0;
        }
        return out.slice(-need);
    }
    function grabRight(node, offset, need) {
        let out = "", n = node, o = offset;
        while (n && need > 0) {
            if (n.nodeType === Node.TEXT_NODE &&
                n.parentElement &&
                !n.parentElement.matches("script,style,noscript,template")) {
                const txtNode = n;
                const text = normalizeText(txtNode.nodeValue || "");
                out += n === node ? text.slice(o) : text;
                if (out.length >= need)
                    break;
            }
            let next = n.nextSibling;
            while (next && next.nodeType !== Node.TEXT_NODE)
                next = next.nextSibling;
            if (!next) {
                n = n.parentNode;
                if (!n || !n.nextSibling)
                    break;
                n = n.nextSibling;
                while (n && n.firstChild)
                    n = n.firstChild;
            }
            else
                n = next;
            o = 0;
        }
        return out.slice(0, need);
    }
    const sc = range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer
        : range.startContainer.firstChild;
    const ec = range.endContainer.nodeType === Node.TEXT_NODE
        ? range.endContainer
        : range.endContainer.firstChild;
    const so = range.startOffset, eo = range.endOffset;
    return {
        prefix: sc ? grabLeft(sc, so, max) : "",
        suffix: ec ? grabRight(ec, eo, max) : "",
    };
}
/** Whitelist of stable attributes to capture (truncated to keep anchors light). */
export function stableAttrs(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE)
        return {};
    const out = {};
    for (const a of Array.from(el.attributes)) {
        if (/^(data-|aria-|role$|alt$|title$)/.test(a.name)) {
            out[a.name] = a.value.slice(0, 256);
        }
    }
    if (el.tagName === "IMG") {
        const src = el.getAttribute("src");
        if (src)
            out.src = src;
    }
    return out;
}
/** Document vertical scroll percentage. */
export function docScrollPct() {
    const doc = document.documentElement;
    const h = doc.scrollHeight - doc.clientHeight;
    return h <= 0 ? 0 : doc.scrollTop / h;
}

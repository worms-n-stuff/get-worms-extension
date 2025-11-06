// global config
import { DEFAULTS } from "../constants.js";
// utility functions
import { normalizeText } from "../utils.js";
// anchoring specific helpers
import { getAllTextNode, selectionContext, getClickRelativePos, getStableAttrs, getScrollPercentage, getQuoteRange, getRangeContainer, getCssPath, getCoarseContainer, } from "./anchoring-helpers.js";
// TextCache helper
function buildTextCacheForRoot(root) {
    const nodes = getAllTextNode(root);
    const allText = nodes.map((n) => n.text).join("");
    return { nodes, allText };
}
class DomAnchoringAdapter {
    buildTextCache() {
        const root = document.body ?? document;
        return buildTextCacheForRoot(root);
    }
    createPosition({ target, clickX, clickY, selection, }) {
        // Prefer a meaningful container for selections; otherwise derive from target.
        const baseEl = selection
            ? getRangeContainer(selection)
            : target instanceof Element
                ? target
                : target && "parentElement" in target
                    ? target.parentElement
                    : null;
        const fineEl = (baseEl ??
            document.body ??
            document.documentElement ??
            document.createElement("div"));
        const coarseEl = getCoarseContainer(fineEl);
        const selectorFine = getCssPath(fineEl);
        const selectorCoarse = coarseEl && coarseEl !== fineEl ? getCssPath(coarseEl) : selectorFine;
        // Build text quote only when there’s a non-empty (normalized) selection.
        let textQuote = null;
        if (selection && !selection.collapsed) {
            const raw = selection.toString();
            const exactNorm = normalizeText(raw).slice(0, 1024);
            if (exactNorm) {
                const { prefix, suffix } = selectionContext(selection, DEFAULTS.maxTextContext);
                textQuote = { exact: exactNorm, prefix, suffix };
            }
        }
        // Click-relative percentage (fallback to center if coords are missing)
        const hasClick = Number.isFinite(clickX) && Number.isFinite(clickY);
        const rel = hasClick
            ? getClickRelativePos(fineEl, clickX, clickY)
            : { x: 0.5, y: 0.5 };
        // Stable attributes (cap potential data: URLs to avoid bloat)
        const attrs = getStableAttrs(fineEl);
        if (attrs.src && attrs.src.startsWith("data:"))
            attrs.src = attrs.src.slice(0, 256);
        return {
            dom: { selectorFine, selectorCoarse },
            textQuote,
            element: {
                tag: fineEl.tagName || "BODY",
                attrs,
                relBoxPct: rel,
            },
            fallback: { scrollPct: getScrollPercentage() },
        };
    }
    resolvePosition(position, cache) {
        const exact = position.textQuote?.exact
            ? normalizeText(position.textQuote.exact)
            : "";
        const tryQuery = (sel) => {
            if (!sel)
                return null;
            try {
                const el = document.querySelector(sel);
                return el instanceof HTMLElement ? el : null;
            }
            catch {
                return null;
            }
        };
        // 1) fine selector + quote sanity
        if (position.dom.selectorFine && exact) {
            const el = tryQuery(position.dom.selectorFine);
            if (el) {
                const txt = normalizeText(el.innerText || "");
                if (txt.includes(exact))
                    return el;
            }
        }
        // 2) scoped re-anchoring inside coarse container
        const coarseEl = tryQuery(position.dom.selectorCoarse);
        if (coarseEl && exact) {
            const scopedCache = buildTextCacheForRoot(coarseEl);
            const range = getQuoteRange(position.textQuote.exact, position.textQuote.prefix, position.textQuote.suffix, scopedCache);
            if (range) {
                const container = getRangeContainer(range);
                if (container instanceof HTMLElement) {
                    return coarseEl.contains(container) ? container : coarseEl;
                }
                return coarseEl;
            }
            // If the quote no longer resolves, still return the coarse anchor as a stable fallback.
            return coarseEl;
        }
        // 3) quote-only (global)
        if (exact) {
            const range = getQuoteRange(position.textQuote.exact, position.textQuote.prefix, position.textQuote.suffix, cache);
            if (range) {
                const hostEl = getRangeContainer(range);
                if (hostEl instanceof HTMLElement)
                    return hostEl;
                if (hostEl === document.body && position.dom.selectorFine) {
                    const nudged = tryQuery(position.dom.selectorFine);
                    if (nudged)
                        return nudged;
                }
            }
        }
        // 4) fine selector
        if (position.dom.selectorFine) {
            const el = tryQuery(position.dom.selectorFine);
            if (el)
                return el;
        }
        // 5) Attribute + tag heuristic.
        let hostEl = null;
        const tag = position.element?.tag;
        if (tag) {
            const want = position.element.attrs ?? {};
            const cands = Array.from(document.getElementsByTagName(tag)).filter((el) => el instanceof HTMLElement);
            hostEl =
                cands.find((el) => Object.keys(want).every((k) => {
                    const got = el.getAttribute(k) || "";
                    if (k === "src") {
                        // Be lenient with cache-busting query strings.
                        try {
                            const a = new URL(got, document.baseURI);
                            const b = new URL(want[k], document.baseURI);
                            return a.origin === b.origin && a.pathname === b.pathname;
                        }
                        catch {
                            return got === want[k];
                        }
                    }
                    // For long data- values, allow prefix match to survive truncation.
                    if (k.startsWith("data-"))
                        return got.startsWith(want[k]);
                    return got === want[k];
                })) || null;
        }
        // 6) Final fallback.
        if (!hostEl) {
            const fb = document.body ?? document.documentElement;
            hostEl = fb instanceof HTMLElement ? fb : null;
        }
        return hostEl;
    }
}
export function createAnchoringAdapter() {
    return new DomAnchoringAdapter();
}

/**
 * anchoring-adapter.ts
 * -----------------------------------------------------------------------------
 * Provides the concrete DOM anchoring implementation for PageWorms.
 *
 * Responsibilities:
 *   - Build text caches for fast quote matching.
 *   - Create worm positions from user interactions (selection or click).
 *   - Resolve persisted worm positions back to DOM elements using multiple fallbacks.
 */
// global config
import { DEFAULTS } from "../constants.js";
// utility functions
import { normalizeText } from "../utils.js";
// anchoring specific helpers
import { getAllTextNode, selectionContext, getClickRelativePos, getStableAttrs, getScrollPercentage, getQuoteRange, getRangeContainer, getCssPath, getCoarseContainer, rectContains, } from "./anchoring-helpers.js";
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
        // Prefer the selection container when present; otherwise fall back to the event target.
        const baseEl = selection
            ? getRangeContainer(selection)
            : target instanceof Element
                ? target
                : target && "parentElement" in target
                    ? target.parentElement
                    : null;
        // fineEl is the primary element we point to via selectorFine.
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
        // Decide which host element to use for relBoxPct and future fallbacks.
        const coarseHost = coarseEl instanceof HTMLElement ? coarseEl : coarseEl;
        let hostForRel = fineEl;
        const selectionRect = selection && !selection.collapsed
            ? selection.getBoundingClientRect()
            : null;
        if (selectionRect &&
            selectionRect.width > 0 &&
            selectionRect.height > 0 &&
            coarseHost) {
            const fineRect = fineEl.getBoundingClientRect();
            if (!rectContains(fineRect, selectionRect)) {
                hostForRel = coarseHost;
            }
        }
        else if (coarseHost && hostForRel === fineEl && fineEl === document.body) {
            hostForRel = coarseHost;
        }
        // Start with the explicit click location if provided.
        let relClientX = Number.isFinite(clickX) ? clickX : NaN;
        let relClientY = Number.isFinite(clickY) ? clickY : NaN;
        if (selectionRect &&
            selectionRect.width > 0 &&
            selectionRect.height > 0) {
            relClientX = selectionRect.left + selectionRect.width / 2;
            relClientY = selectionRect.top + selectionRect.height / 2;
        }
        if (!Number.isFinite(relClientX) || !Number.isFinite(relClientY)) {
            const hostRect = hostForRel.getBoundingClientRect();
            relClientX = hostRect.left + hostRect.width / 2;
            relClientY = hostRect.top + hostRect.height / 2;
        }
        // Compute a percentage relative to the chosen host.
        const rel = getClickRelativePos(hostForRel, relClientX, relClientY);
        // Stable attributes (cap potential data: URLs to avoid bloat)
        const attrs = getStableAttrs(hostForRel);
        if (attrs.src && attrs.src.startsWith("data:"))
            attrs.src = attrs.src.slice(0, 256);
        return {
            dom: { selectorFine, selectorCoarse },
            textQuote,
            element: {
                tag: hostForRel.tagName || "BODY",
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

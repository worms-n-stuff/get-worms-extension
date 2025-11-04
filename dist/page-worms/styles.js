/**
 * styles.js
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Attach the worm UI stylesheet to the document exactly once.
 */
const STYLE_ID = "pw-style-link";
function resolveCssUrl() {
    if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
        return chrome.runtime.getURL("page-worms/page-worms.css");
    }
    try {
        return new URL("./page-worms.css", import.meta.url).toString();
    }
    catch {
        return "page-worms/page-worms.css";
    }
}
/** Inject the overlay styles via <link>, guarding against duplicate inserts. */
export function injectStyles() {
    if (document.getElementById(STYLE_ID))
        return;
    const link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = resolveCssUrl();
    document.head.appendChild(link);
}

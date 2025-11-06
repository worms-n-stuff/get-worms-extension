/**
 * styles.ts
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Attach the worm UI stylesheet to the document exactly once.
 */

const STYLE_ID = "pw-style-link";

function resolveCssUrl(): string {
  if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
    return chrome.runtime.getURL("page-worms/styles.css");
  }
  try {
    return new URL("./styles.css", import.meta.url).toString();
  } catch {
    return "page-worms/styles.css";
  }
}

/** Inject the overlay styles via <link>, guarding against duplicate inserts. */
export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.type = "text/css";
  link.href = resolveCssUrl();
  document.head.appendChild(link);
}

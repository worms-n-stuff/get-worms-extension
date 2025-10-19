/**
 * content-script/worm-module.js - Handles on/off and initialization of the worms module
 */
const KEY = "pw_enabled";
let instance = null;
let attachPageWorms = null;
let alive = true;

const wormsModuleUrl = chrome.runtime.getURL("page-worms/page-worms.js");
const wormsReady = import(wormsModuleUrl).then((mod) => {
  attachPageWorms = mod.attachPageWorms;
});

// --- LIFECYCLE GUARDS -------------------------------------------------------

function isContextAlive() {
  // When a content-script context is invalidated, runtime.id becomes undefined.
  return alive && !!(chrome?.runtime && chrome.runtime.id);
}

// Fires for normal unloads AND BFCache moves (with e.persisted info).
// Use pagehide instead of unload to reliably mark the context as not usable.
window.addEventListener("pagehide", () => {
  alive = false;
  // Optional: remove listeners to avoid scheduling future work
  chrome.storage.onChanged.removeListener(onStorageChange);
  window.removeEventListener("pageshow", onPageShow);
  window.removeEventListener("popstate", onPopState);
});

// If a page returns from BFCache, this context is still valid and can re-apply.
function onPageShow(e) {
  if (!isContextAlive()) return;
  ensureState();
}
window.addEventListener("pageshow", onPageShow);

// SPA route changes
// Patch the browser History API so we can detect SPA route changes.
// When the site calls pushState/replaceState or the user navigates
// with Back/Forward (popstate), re-run ensureState() to reapply worms.
// Wrapped in an IIFE so it runs immediately and keeps variables scoped.
(function patchHistory() {
  const _push = history.pushState,
    _replace = history.replaceState;
  history.pushState = function (...args) {
    const r = _push.apply(this, args);
    queueMicrotask(() => isContextAlive() && ensureState());
    return r;
  };
  history.replaceState = function (...args) {
    const r = _replace.apply(this, args);
    queueMicrotask(() => isContextAlive() && ensureState());
    return r;
  };
  function onPopState() {
    if (isContextAlive()) ensureState();
  }
  window.addEventListener("popstate", onPopState);
})();

// Storage change handler (defined as a named fn so we can remove it on pagehide)
function onStorageChange(changes, area) {
  if (area === "sync" && changes[KEY]) {
    if (!isContextAlive()) return;
    ensureState();
  }
}
chrome.storage.onChanged.addListener(onStorageChange);

// --- SAFE STORAGE ACCESS ----------------------------------------------------

async function getToggleSafe() {
  if (!isContextAlive()) return false;
  try {
    // Guard again inside the try in case context dies during the await.
    const obj = await chrome.storage.sync.get(KEY);
    return !!obj[KEY];
  } catch (e) {
    // If the context died mid-await, Chrome throws "Extension context invalidated"
    // Swallow and treat as "disabled" for this dead page.
    return false;
  }
}

// --- MAIN STATE MACHINE -----------------------------------------------------

async function ensureState() {
  if (!isContextAlive()) return;
  await wormsReady;
  if (!isContextAlive()) return;

  if (!instance) {
    instance = await attachPageWorms({
      storage: "chrome",
      enableSelection: true,
      startCapture: false, // apply explicitly below
    });
    if (!isContextAlive()) return;
  }

  const enabled = await getToggleSafe();
  if (!isContextAlive()) return;

  if (enabled) {
    instance.enableCapture();
    await instance.load();
    await instance.renderAll();
  } else {
    instance.disableCapture();
    instance.clearScreen();
  }
}

// First run
ensureState();

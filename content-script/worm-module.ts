/**
 * content-script/worm-module.js
 * Responsibilties:
 * 1. Handles on/off and initialization of the worms module
 * 2. Handles add new worm action (from context menu)
 */
(() => {
  const KEY = "pw_enabled";
  type AttachPageWorms = typeof import("../page-worms/page-worms.js").attachPageWorms;
  type PageWormsInstance = Awaited<ReturnType<AttachPageWorms>>;
  let instance: PageWormsInstance | null = null;
  let attachPageWormsFn: AttachPageWorms | null = null;
  let alive = true;
  let lastContextClick: { clientX: number; clientY: number } | null = null;

  const wormsModuleUrl = chrome.runtime.getURL("dist/page-worms/page-worms.js");
  const wormsReady = import(wormsModuleUrl).then((mod) => {
    attachPageWormsFn = mod.attachPageWorms;
  });

  /* -------------------------------------------------------------------------- */
  /*                            Init & On/Off Toggle                            */
  /* -------------------------------------------------------------------------- */

  // --- LIFECYCLE GUARDS -------------------------------------------------------

  function isContextAlive() {
    // When a content-script context is invalidated, runtime.id becomes undefined.
    return alive && !!(chrome?.runtime && chrome.runtime.id);
  }

  function onPopState() {
    if (isContextAlive()) ensureState();
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
  function onPageShow(_: PageTransitionEvent) {
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
    const _push = history.pushState;
    const _replace = history.replaceState;
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
    window.addEventListener("popstate", onPopState);
  })();

  // Storage change handler (defined as a named fn so we can remove it on pagehide)
  function onStorageChange(
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ) {
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
    } catch {
      // If the context died mid-await, Chrome throws "Extension context invalidated"
      // Swallow and treat as "disabled" for this dead page.
      return false;
    }
  }

  // --- MAIN STATE MACHINE -----------------------------------------------------

  async function ensureInstanceReady() {
    if (!isContextAlive()) return null;
    await wormsReady;
    if (!isContextAlive()) return null;

    if (!instance && attachPageWormsFn) {
      const created = await attachPageWormsFn();
      if (!isContextAlive()) return null;
      instance = created;
    }
    return instance;
  }

  async function ensureState() {
    const inst = await ensureInstanceReady();
    if (!inst) return;

    const enabled = await getToggleSafe();
    if (!isContextAlive()) return;

    if (enabled) {
      await inst.load();
      if (!isContextAlive()) return;
      await inst.renderAll();
    } else {
      inst.clearScreen();
    }
  }

  // First run
  ensureState();

  /* -------------------------------------------------------------------------- */
  /*                                  Add Worm                                  */
  /* -------------------------------------------------------------------------- */
  // Track right-click coordinates
  window.addEventListener(
    "contextmenu",
    (e) => {
      lastContextClick = { clientX: e.clientX, clientY: e.clientY };
    },
    { capture: true } // capture to observe before site handlers possibly stopPropagation
  );

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "worms:add") {
      void addWormFromContext();
    }
  });

  async function addWormFromContext() {
    const inst = await ensureInstanceReady();
    if (!inst) return;

    const enabled = await getToggleSafe();
    if (!enabled || !isContextAlive()) return; // respect the ON/OFF toggle

    // Use the current DOM selection if any
    const sel = window.getSelection?.();
    const hasSelection = !!(sel && !sel.isCollapsed && sel.rangeCount > 0);
    const selection = hasSelection ? sel.getRangeAt(0).cloneRange() : null;

    // If we have a recorded right-click point, use it; otherwise fall back to center.
    const point = lastContextClick || {
      clientX: window.innerWidth / 2,
      clientY: window.innerHeight / 2,
    };

    // Target element for the anchor (either from selection or from the click point)
    const target = selection
      ? (selection.commonAncestorContainer.nodeType === 1
          ? (selection.commonAncestorContainer as Element)
          : selection.commonAncestorContainer.parentElement) || document.body
      : document.elementFromPoint(point.clientX, point.clientY) || document.body;

    await inst.addWorm({
      target,
      clickX: point.clientX,
      clickY: point.clientY,
      selection,
    });
  }
})();

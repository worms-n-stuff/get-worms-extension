/**
 * content-script/worm-module.ts
 * -----------------------------------------------------------------------------
 * Injected into every page. Starts/stops PageWorms based on the display mode stored
 * in chrome.storage, tracks SPA navigations, and responds to "Add Worm" events
 * emitted by the background context menu handler.
 */
(function registerPageWormsContentScript() {
    let instance = null;
    let attachPageWormsFn = null;
    let alive = true;
    let lastContextClick = null;
    const wormsModuleUrl = chrome.runtime.getURL("dist/page-worms/page-worms.js");
    const wormsReady = import(wormsModuleUrl).then((mod) => {
        attachPageWormsFn = mod.attachPageWorms;
    });
    let readDisplayMode;
    let DISPLAY_MODE_KEY = "pw_display_mode";
    // Load shared toggle helpers via web-accessible runtime URL.
    const togglesReady = import(chrome.runtime.getURL("dist/shared/toggles.js")).then((mod) => {
        readDisplayMode = mod.readDisplayMode;
        DISPLAY_MODE_KEY = mod.DISPLAY_MODE_KEY;
    });
    /* -------------------------------------------------------------------------- */
    /*                           Init & Display Mode                             */
    /* -------------------------------------------------------------------------- */
    // --- LIFECYCLE GUARDS -------------------------------------------------------
    /** Returns false once the extension tears down this execution context. */
    function isContextAlive() {
        return alive && !!(chrome?.runtime && chrome.runtime.id);
    }
    function onPopState() {
        if (isContextAlive())
            ensureState();
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
    function onPageShow(_) {
        if (!isContextAlive())
            return;
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
    function onStorageChange(changes, area) {
        if (area === "sync" && changes[DISPLAY_MODE_KEY]) {
            if (!isContextAlive())
                return;
            ensureState();
        }
    }
    chrome.storage.onChanged.addListener(onStorageChange);
    // --- SAFE STORAGE ACCESS ----------------------------------------------------
    /** Read the worms display mode, tolerating invalidated contexts. */
    async function getDisplayModeSafe() {
        if (!isContextAlive())
            return "off";
        try {
            await togglesReady;
            // Guard again inside the try in case context dies during the await.
            const mode = await readDisplayMode();
            return mode;
        }
        catch {
            // If the context died mid-await, Chrome throws "Extension context invalidated"
            // Swallow and treat as "off" for this dead page.
            return "off";
        }
    }
    // --- MAIN STATE MACHINE -----------------------------------------------------
    /** Lazily create the shared PageWorms singleton. */
    async function ensureInstanceReady() {
        if (!isContextAlive())
            return null;
        await wormsReady;
        if (!isContextAlive())
            return null;
        if (!instance && attachPageWormsFn) {
            const created = await attachPageWormsFn();
            if (!isContextAlive())
                return null;
            instance = created;
        }
        return instance;
    }
    /** Apply the latest toggle state (load or clear PageWorms UI). */
    async function ensureState() {
        const inst = await ensureInstanceReady();
        if (!inst)
            return;
        const mode = await getDisplayModeSafe();
        if (!isContextAlive())
            return;
        if (mode !== "off") {
            await inst.load();
            if (!isContextAlive())
                return;
            await inst.renderAll();
        }
        else {
            inst.clearScreen();
        }
    }
    // First run
    ensureState();
    /* -------------------------------------------------------------------------- */
    /*                                  Add Worm                                  */
    /* -------------------------------------------------------------------------- */
    // Track right-click coordinates
    window.addEventListener("contextmenu", (e) => {
        lastContextClick = { clientX: e.clientX, clientY: e.clientY };
    }, { capture: true } // capture to observe before site handlers possibly stopPropagation
    );
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type === "worms:add") {
            void addWormFromContext();
        }
    });
    /** Spawn a worm using the last context menu coordinates + optional selection. */
    async function addWormFromContext() {
        const inst = await ensureInstanceReady();
        if (!inst)
            return;
        const mode = await getDisplayModeSafe();
        if (mode === "off" || !isContextAlive())
            return; // respect the display mode
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
                ? selection.commonAncestorContainer
                : selection.commonAncestorContainer.parentElement) || document.body
            : document.elementFromPoint(point.clientX, point.clientY) ||
                document.body;
        await inst.addWorm({
            target,
            clickX: point.clientX,
            clickY: point.clientY,
            selection,
        });
    }
})();

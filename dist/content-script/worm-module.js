(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // content-script/worm-module.ts
  var require_worm_module = __commonJS({
    "content-script/worm-module.ts"() {
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
        const togglesReady = import(chrome.runtime.getURL("dist/shared/toggles.js")).then((mod) => {
          readDisplayMode = mod.readDisplayMode;
          DISPLAY_MODE_KEY = mod.DISPLAY_MODE_KEY;
        });
        function isContextAlive() {
          return alive && !!(chrome?.runtime && chrome.runtime.id);
        }
        function onPopState() {
          if (isContextAlive()) ensureState();
        }
        window.addEventListener("pagehide", () => {
          alive = false;
          chrome.storage.onChanged.removeListener(onStorageChange);
          window.removeEventListener("pageshow", onPageShow);
          window.removeEventListener("popstate", onPopState);
        });
        function onPageShow(_) {
          if (!isContextAlive()) return;
          ensureState();
        }
        window.addEventListener("pageshow", onPageShow);
        (function patchHistory() {
          const _push = history.pushState;
          const _replace = history.replaceState;
          history.pushState = function(...args) {
            const r = _push.apply(this, args);
            queueMicrotask(() => isContextAlive() && ensureState());
            return r;
          };
          history.replaceState = function(...args) {
            const r = _replace.apply(this, args);
            queueMicrotask(() => isContextAlive() && ensureState());
            return r;
          };
          window.addEventListener("popstate", onPopState);
        })();
        function onStorageChange(changes, area) {
          if (area === "sync" && changes[DISPLAY_MODE_KEY]) {
            if (!isContextAlive()) return;
            ensureState();
          }
        }
        chrome.storage.onChanged.addListener(onStorageChange);
        async function getDisplayModeSafe() {
          if (!isContextAlive()) return "off";
          try {
            await togglesReady;
            const mode = await readDisplayMode();
            return mode;
          } catch {
            return "off";
          }
        }
        async function ensureInstanceReady() {
          if (!isContextAlive()) return null;
          await wormsReady;
          if (!isContextAlive()) return null;
          if (!instance && attachPageWormsFn) {
            const created = await attachPageWormsFn("remote");
            if (!isContextAlive()) return null;
            instance = created;
          }
          return instance;
        }
        async function ensureState() {
          const inst = await ensureInstanceReady();
          if (!inst) return;
          const mode = await getDisplayModeSafe();
          if (!isContextAlive()) return;
          if (mode !== "off") {
            await inst.load();
            if (!isContextAlive()) return;
            await inst.renderAll();
          } else {
            inst.clearScreen();
          }
        }
        ensureState();
        window.addEventListener(
          "contextmenu",
          (e) => {
            lastContextClick = { clientX: e.clientX, clientY: e.clientY };
          },
          { capture: true }
          // capture to observe before site handlers possibly stopPropagation
        );
        chrome.runtime.onMessage.addListener((msg) => {
          if (msg?.type === "worms:add") {
            void addWormFromContext();
          }
        });
        async function addWormFromContext() {
          const inst = await ensureInstanceReady();
          if (!inst) return;
          const mode = await getDisplayModeSafe();
          if (mode === "off" || !isContextAlive()) return;
          const sel = window.getSelection?.();
          const hasSelection = !!(sel && !sel.isCollapsed && sel.rangeCount > 0);
          const selection = hasSelection ? sel.getRangeAt(0).cloneRange() : null;
          const point = lastContextClick || {
            clientX: window.innerWidth / 2,
            clientY: window.innerHeight / 2
          };
          const target = selection ? (selection.commonAncestorContainer.nodeType === 1 ? selection.commonAncestorContainer : selection.commonAncestorContainer.parentElement) || document.body : document.elementFromPoint(point.clientX, point.clientY) || document.body;
          await inst.addWorm({
            target,
            clickX: point.clientX,
            clickY: point.clientY,
            selection
          });
        }
      })();
    }
  });
  require_worm_module();
})();

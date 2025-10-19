/**
 * content-script/worm-module.js - Handles the per page worms module injection and management
 */
const KEY = "pw_enabled";
let instance = null; // PageWorms instance
let attachPageWorms = null;

const wormsModuleUrl = chrome.runtime.getURL("page-worms/page-worms.js");
const wormsReady = import(wormsModuleUrl)
  .then((mod) => {
    attachPageWorms = mod.attachPageWorms;
    if (typeof attachPageWorms !== "function") {
      throw new Error("attachPageWorms export missing or not a function");
    }
    console.log("PageWorms module loaded");
  })
  .catch((err) => {
    console.error("Failed to load PageWorms module:", err);
  });

async function ensureState() {
  await wormsReady;
  if (typeof attachPageWorms !== "function") return;
  const { [KEY]: enabled } = await chrome.storage.sync.get(KEY);
  if (enabled) await start();
  else await stop();
}

async function start() {
  if (instance) return;
  instance = await attachPageWorms({
    storage: "chrome", // uses ChromeStorageAdapter under the hood
    enableSelection: true,
    startCapture: true,
  });
}

async function stop() {
  if (!instance) return;
  instance.destroy();
  instance = null;
}

// Respond to toggle changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes[KEY]) {
    console.log("adding or removing worms");
    ensureState();
  }
});

// Run once on page load
ensureState();

// Hot-reapply on history navigations in SPAs
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible") await ensureState();
});

/**
 * popup-logic/worm-module.js – stores and syncs the worms toggle value
 */
const TOGGLE_KEY = "pw_enabled";
const toggleEl = document.getElementById("toggle");

(async function init() {
  if (!toggleEl) return;
  const { [TOGGLE_KEY]: enabled } = await chrome.storage.sync.get(TOGGLE_KEY);
  toggleEl.checked = !!enabled;

  toggleEl.addEventListener("change", async () => {
    await chrome.storage.sync.set({ [TOGGLE_KEY]: toggleEl.checked });
  });
})();

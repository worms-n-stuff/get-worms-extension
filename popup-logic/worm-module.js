/**
 * popup-logic/worm-module.js – stores and syncs the worms toggle value
 */
const KEY = "pw_enabled";
const toggleEl = document.getElementById("toggle");

(async function init() {
  const { [KEY]: enabled } = await chrome.storage.sync.get(KEY);
  toggleEl.checked = !!enabled;

  toggleEl.addEventListener("change", async () => {
    await chrome.storage.sync.set({ [KEY]: toggleEl.checked });
  });
})();

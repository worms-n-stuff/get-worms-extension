/**
 * service-worker/worm-module.js – manages the worm module
 * Current simply controls the on/off toggle
 */
const KEY = "pw_enabled"; // global ON/OFF

chrome.runtime.onInstalled.addListener(async () => {
  const { [KEY]: enabled } = await chrome.storage.sync.get(KEY);
  if (enabled === undefined) await chrome.storage.sync.set({ [KEY]: true });
});

chrome.tabs.onActivated.addListener(updateActionUI);
chrome.tabs.onUpdated.addListener((_tabId, info, _tab) => {
  if (info.status === "complete") updateActionUI();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes[KEY]) {
    console.log("Worms toggle changed:", changes[KEY].newValue);
    updateActionUI();
  }
});

async function updateActionUI() {
  const { [KEY]: enabled } = await chrome.storage.sync.get(KEY);
  const text = enabled ? "ON" : "OFF";
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({
    color: enabled ? "#28a745" : "#6c757d",
  });
}

/**
 * service-worker/worm-module.js – manages the worm module
 * Responsibilities:
 * - controls the on/off toggle
 * - create the "Add Worm" context menu item
 */
const KEY = "pw_enabled"; // global ON/OFF
const MENU_ID_ADD_WORM = "worms:add";
const MENU_CONTEXTS = [
  chrome.contextMenus.ContextType.PAGE,
  chrome.contextMenus.ContextType.SELECTION,
  chrome.contextMenus.ContextType.IMAGE,
  chrome.contextMenus.ContextType.LINK,
  chrome.contextMenus.ContextType.VIDEO,
  chrome.contextMenus.ContextType.AUDIO,
] as const;

chrome.runtime.onInstalled.addListener(async () => {
  await ensureToggleDefault();
  createContextMenu();
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

// ---- Context Menu: "Add Worm" -----------------------------------------
async function ensureToggleDefault() {
  const { [KEY]: enabled } = await chrome.storage.sync.get(KEY);
  if (enabled === undefined) await chrome.storage.sync.set({ [KEY]: false });
}

function createContextMenu() {
  try {
    chrome.contextMenus.create({
      id: MENU_ID_ADD_WORM,
      title: "Add Worm",
      contexts: MENU_CONTEXTS as unknown as chrome.contextMenus.CreateProperties["contexts"],
    });
  } catch {
    // Ignore "already exists" errors on reloads
  }
}

chrome.runtime.onStartup?.addListener(createContextMenu);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID_ADD_WORM) return;
  if (!tab?.id) return;

  // Ask the content script in this tab to add a worm using the page’s
  // last right-click coordinates and current selection (if any).
  chrome.tabs.sendMessage(tab.id, { type: "worms:add" }).catch(() => {});
});

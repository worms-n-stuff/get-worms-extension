import { ensureWormsToggle, readWormsToggle, PW_TOGGLE_KEY, } from "../shared/toggles.js";
const MENU_ID_ADD_WORM = "worms:add";
const MENU_CONTEXTS = [
    chrome.contextMenus.ContextType.PAGE,
    chrome.contextMenus.ContextType.SELECTION,
    chrome.contextMenus.ContextType.IMAGE,
    chrome.contextMenus.ContextType.LINK,
    chrome.contextMenus.ContextType.VIDEO,
    chrome.contextMenus.ContextType.AUDIO,
];
async function updateActionUI() {
    const enabled = await readWormsToggle();
    const text = enabled ? "ON" : "OFF";
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({
        color: enabled ? "#28a745" : "#6c757d",
    });
}
function createContextMenu() {
    try {
        chrome.contextMenus.create({
            id: MENU_ID_ADD_WORM,
            title: "Add Worm",
            contexts: MENU_CONTEXTS,
        });
    }
    catch {
        // Ignore "already exists" errors on reloads
    }
}
function handleStorageChange(changes, area) {
    if (area === "sync" && changes[PW_TOGGLE_KEY]) {
        console.log("Worms toggle changed:", changes[PW_TOGGLE_KEY].newValue);
        void updateActionUI();
    }
}
async function handleContextMenuClick(info, tab) {
    if (info.menuItemId !== MENU_ID_ADD_WORM)
        return;
    if (!tab?.id)
        return;
    try {
        await chrome.tabs.sendMessage(tab.id, { type: "worms:add" });
    }
    catch {
        // Content script may not be injected; ignore.
    }
}
export function registerWormModuleHandlers() {
    chrome.runtime.onInstalled.addListener(async () => {
        await ensureWormsToggle();
        createContextMenu();
    });
    chrome.runtime.onStartup?.addListener(createContextMenu);
    chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
    chrome.tabs.onActivated.addListener(() => {
        void updateActionUI();
    });
    chrome.tabs.onUpdated.addListener((_tabId, info) => {
        if (info.status === "complete")
            void updateActionUI();
    });
    chrome.storage.onChanged.addListener(handleStorageChange);
    void updateActionUI();
}

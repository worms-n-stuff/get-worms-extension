/**
 * service-worker/worm-module.ts
 * -----------------------------------------------------------------------------
 * Owns the worms display mode: keeps the action badge updated, exposes the “Add Worm”
 * context menu entry, and forwards click requests to the active tab.
 */
import { ensureDisplayMode, readDisplayMode, DISPLAY_MODE_KEY, } from "../shared/toggles.js";
const MENU_ID_ADD_WORM = "worms:add";
const MENU_CONTEXTS = [
    chrome.contextMenus.ContextType.PAGE,
    chrome.contextMenus.ContextType.SELECTION,
    chrome.contextMenus.ContextType.IMAGE,
    chrome.contextMenus.ContextType.LINK,
    chrome.contextMenus.ContextType.VIDEO,
    chrome.contextMenus.ContextType.AUDIO,
];
const MODE_BADGES = {
    off: { text: "OFF", color: "#6c757d" },
    private: { text: "MINE", color: "#28a745" },
    friends: { text: "FRND", color: "#17a2b8" },
    public: { text: "PUB", color: "#f0ad4e" },
};
/** Reflect the current display mode on the extension action badge. */
async function updateActionUI() {
    const mode = await readDisplayMode();
    const badge = MODE_BADGES[mode] ?? MODE_BADGES.off;
    chrome.action.setBadgeText({ text: badge.text });
    chrome.action.setBadgeBackgroundColor({ color: badge.color });
}
/** Ensure the context menu item exists (safe to call repeatedly). */
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
    if (area === "sync" && changes[DISPLAY_MODE_KEY]) {
        console.log("Worms display mode changed:", changes[DISPLAY_MODE_KEY].newValue);
        void updateActionUI();
    }
}
/** Fire-and-forget handler that asks the tab to add a worm. */
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
/** Wire up storage/tab listeners and bootstrap the display mode. */
export function registerWormModuleHandlers() {
    chrome.runtime.onInstalled.addListener(async () => {
        await ensureDisplayMode();
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

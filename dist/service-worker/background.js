var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// shared/auth.ts
var AUTH_MESSAGES, TRUSTED_LOGIN_ORIGINS, HANDSHAKE_STORAGE_KEY, SESSION_STORAGE_KEY, HANDSHAKE_TTL_MS, LOGIN_ORIGIN, LOGIN_PATH;
var init_auth = __esm({
  "shared/auth.ts"() {
    AUTH_MESSAGES = {
      GET_LOGIN_STATUS: "GW_GET_LOGIN_STATUS",
      BEGIN_LOGIN: "GW_BEGIN_LOGIN",
      GET_PENDING_STATE: "GW_GET_PENDING_STATE",
      COMPLETE_LOGIN: "GW_COMPLETE_LOGIN",
      LOGIN_SUCCESS: "GW_LOGIN_SUCCESS"
    };
    TRUSTED_LOGIN_ORIGINS = [
      "https://get-worms.com",
      "http://localhost:5173"
    ];
    HANDSHAKE_STORAGE_KEY = "gw_login_handshake";
    SESSION_STORAGE_KEY = "gw_supabase_session";
    HANDSHAKE_TTL_MS = 5 * 60 * 1e3;
    LOGIN_ORIGIN = TRUSTED_LOGIN_ORIGINS[0];
    LOGIN_PATH = "";
  }
});

// service-worker/auth.ts
function base64url(bytes) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function generateState(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}
async function setHandshake(handshake) {
  await chrome.storage.local.set({ [HANDSHAKE_STORAGE_KEY]: handshake });
}
async function getHandshake() {
  const obj = await chrome.storage.local.get(HANDSHAKE_STORAGE_KEY);
  return obj[HANDSHAKE_STORAGE_KEY] || null;
}
async function clearHandshake() {
  await chrome.storage.local.remove(HANDSHAKE_STORAGE_KEY);
}
async function setSession(session) {
  await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session });
}
async function getSession() {
  const obj = await chrome.storage.local.get(SESSION_STORAGE_KEY);
  return obj[SESSION_STORAGE_KEY] || null;
}
async function openLoginTab(state) {
  const url = new URL(LOGIN_PATH, LOGIN_ORIGIN);
  url.searchParams.set("return", "extension");
  url.searchParams.set("state", state);
  await chrome.tabs.create({ url: url.toString(), active: true });
}
function registerAuthHandlers() {
  chrome.runtime.onMessage.addListener(authMessageListener);
}
function authMessageListener(msg, _sender, sendResponse) {
  (async () => {
    try {
      switch (msg?.type) {
        case AUTH_MESSAGES.GET_LOGIN_STATUS: {
          const session = await getSession();
          const loggedIn = Boolean(
            session?.access_token && session?.expires_at && session.expires_at * 1e3 > Date.now()
          );
          sendResponse({ ok: true, loggedIn });
          return;
        }
        case AUTH_MESSAGES.BEGIN_LOGIN: {
          const state = generateState(32);
          const createdAt = Date.now();
          await setHandshake({ pendingState: state, createdAt });
          await openLoginTab(state);
          sendResponse({ ok: true });
          return;
        }
        case AUTH_MESSAGES.GET_PENDING_STATE: {
          const hs = await getHandshake();
          sendResponse({ ok: true, pendingState: hs?.pendingState || null });
          return;
        }
        case AUTH_MESSAGES.COMPLETE_LOGIN: {
          const { state, session } = msg || {};
          const hs = await getHandshake();
          if (!hs || !hs.pendingState || hs.pendingState !== state) {
            sendResponse({ ok: false, error: "Bad or missing state" });
            return;
          }
          if (!hs.createdAt || Date.now() - hs.createdAt > HANDSHAKE_TTL_MS) {
            await clearHandshake();
            sendResponse({ ok: false, error: "Handshake expired" });
            return;
          }
          const { access_token, refresh_token, expires_at } = session || {};
          if (!access_token || !refresh_token || !Number.isFinite(expires_at)) {
            sendResponse({ ok: false, error: "Invalid session payload" });
            return;
          }
          await setSession({ access_token, refresh_token, expires_at });
          await clearHandshake();
          sendResponse({ ok: true });
          return;
        }
        default: {
          sendResponse({ ok: false, error: "Unknown message type" });
          return;
        }
      }
    } catch (err) {
      console.error("Background error:", err);
      sendResponse({ ok: false, error: String(err && err.message || err) });
    }
  })();
  return true;
}
var init_auth2 = __esm({
  "service-worker/auth.ts"() {
    init_auth();
  }
});

// shared/toggles.ts
function normalizeMode(value) {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (DISPLAY_MODES.includes(normalized)) {
      return normalized;
    }
    if (normalized === "mine") return "private";
  }
  return null;
}
async function ensureDisplayMode(defaultMode = "off") {
  try {
    const result = await chrome.storage.sync.get(DISPLAY_MODE_KEY);
    const stored = normalizeMode(result?.[DISPLAY_MODE_KEY]);
    if (!stored) {
      await chrome.storage.sync.set({ [DISPLAY_MODE_KEY]: defaultMode });
      return defaultMode;
    }
    return stored;
  } catch {
    return defaultMode;
  }
}
async function readDisplayMode() {
  try {
    const result = await chrome.storage.sync.get(DISPLAY_MODE_KEY);
    return normalizeMode(result?.[DISPLAY_MODE_KEY]) ?? "off";
  } catch {
    return "off";
  }
}
var DISPLAY_MODES, DISPLAY_MODE_KEY;
var init_toggles = __esm({
  "shared/toggles.ts"() {
    DISPLAY_MODES = [
      "off",
      "private",
      "friends",
      "public"
    ];
    DISPLAY_MODE_KEY = "pw_display_mode";
  }
});

// service-worker/worm-module.ts
async function updateActionUI() {
  const mode = await readDisplayMode();
  const badge = MODE_BADGES[mode] ?? MODE_BADGES.off;
  chrome.action.setBadgeText({ text: badge.text });
  chrome.action.setBadgeBackgroundColor({ color: badge.color });
}
function createContextMenu() {
  try {
    chrome.contextMenus.create({
      id: MENU_ID_ADD_WORM,
      title: "Add Worm",
      contexts: MENU_CONTEXTS
    });
  } catch {
  }
}
function handleStorageChange(changes, area) {
  if (area === "sync" && changes[DISPLAY_MODE_KEY]) {
    console.log("Worms display mode changed:", changes[DISPLAY_MODE_KEY].newValue);
    void updateActionUI();
  }
}
async function handleContextMenuClick(info, tab) {
  if (info.menuItemId !== MENU_ID_ADD_WORM) return;
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "worms:add" });
  } catch {
  }
}
function registerWormModuleHandlers() {
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
    if (info.status === "complete") void updateActionUI();
  });
  chrome.storage.onChanged.addListener(handleStorageChange);
  void updateActionUI();
}
var MENU_ID_ADD_WORM, MENU_CONTEXTS, MODE_BADGES;
var init_worm_module = __esm({
  "service-worker/worm-module.ts"() {
    init_toggles();
    MENU_ID_ADD_WORM = "worms:add";
    MENU_CONTEXTS = [
      chrome.contextMenus.ContextType.PAGE,
      chrome.contextMenus.ContextType.SELECTION,
      chrome.contextMenus.ContextType.IMAGE,
      chrome.contextMenus.ContextType.LINK,
      chrome.contextMenus.ContextType.VIDEO,
      chrome.contextMenus.ContextType.AUDIO
    ];
    MODE_BADGES = {
      off: { text: "OFF", color: "#6c757d" },
      private: { text: "MINE", color: "#28a745" },
      friends: { text: "FRND", color: "#17a2b8" },
      public: { text: "PUB", color: "#f0ad4e" }
    };
  }
});

// service-worker/background.ts
var require_background = __commonJS({
  "service-worker/background.ts"() {
    init_auth2();
    init_worm_module();
    registerAuthHandlers();
    registerWormModuleHandlers();
  }
});
export default require_background();

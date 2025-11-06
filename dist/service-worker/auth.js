import { AUTH_MESSAGES, HANDSHAKE_STORAGE_KEY, HANDSHAKE_TTL_MS, LOGIN_ORIGIN, LOGIN_PATH, SESSION_STORAGE_KEY, } from "../shared/auth.js";
// --- Utilities ---
function base64url(bytes) {
    // Convert Uint8Array -> base64url (RFC 4648 §5)
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
/** Register message handlers for auth-related runtime events. */
export function registerAuthHandlers() {
    chrome.runtime.onMessage.addListener(authMessageListener);
}
function authMessageListener(msg, _sender, sendResponse) {
    (async () => {
        try {
            switch (msg?.type) {
                case AUTH_MESSAGES.GET_LOGIN_STATUS: {
                    const session = await getSession();
                    const loggedIn = Boolean(session?.access_token &&
                        session?.expires_at &&
                        session.expires_at * 1000 > Date.now());
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
                    // TTL enforcement
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
                default:
                    sendResponse({ ok: false, error: "Unknown message type" });
                    return;
            }
        }
        catch (err) {
            console.error("Background error:", err);
            sendResponse({ ok: false, error: String((err && err.message) || err) });
        }
    })();
    // Indicate we will respond asynchronously
    return true;
}

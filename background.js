// background.js – service worker that owns auth flow for steps 1–2
// Responsibilities now: generate state (nonce), store { pendingState, createdAt }, open login tab.
// Later it will: accept session via content-script, set Supabase session, and serve queries.

const LOGIN_ORIGIN = "https://get-worms.com"; // http://localhost:5173/
const LOGIN_PATH = "";
const STORAGE_KEY_HANDSHAKE = "gw_login_handshake";
const STORAGE_KEY_SESSION = "gw_supabase_session";
const HANDSHAKE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
  await chrome.storage.local.set({ [STORAGE_KEY_HANDSHAKE]: handshake });
}

async function getHandshake() {
  const obj = await chrome.storage.local.get(STORAGE_KEY_HANDSHAKE);
  return obj[STORAGE_KEY_HANDSHAKE] || null;
}

async function clearHandshake() {
  await chrome.storage.local.remove(STORAGE_KEY_HANDSHAKE);
}

async function setSession(session) {
  await chrome.storage.local.set({ [STORAGE_KEY_SESSION]: session });
}

async function getSession() {
  const obj = await chrome.storage.local.get(STORAGE_KEY_SESSION);
  return obj[STORAGE_KEY_SESSION] || null;
}

async function openLoginTab(state) {
  const url = new URL(LOGIN_PATH, LOGIN_ORIGIN);
  url.searchParams.set("return", "extension");
  url.searchParams.set("state", state);
  await chrome.tabs.create({ url: url.toString(), active: true });
}

// --- Message router ---
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case "GW_GET_LOGIN_STATUS": {
          const session = await getSession();
          const loggedIn = Boolean(
            session?.access_token &&
              session?.expires_at &&
              session.expires_at * 1000 > Date.now()
          );
          sendResponse({ ok: true, loggedIn });
          return;
        }
        case "GW_BEGIN_LOGIN": {
          const state = generateState(32);
          const createdAt = Date.now();
          await setHandshake({ pendingState: state, createdAt });
          await openLoginTab(state);
          sendResponse({ ok: true });
          return;
        }
        case "GW_GET_PENDING_STATE": {
          const hs = await getHandshake();
          sendResponse({ ok: true, pendingState: hs?.pendingState || null });
          return;
        }
        case "GW_COMPLETE_LOGIN": {
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
    } catch (err) {
      console.error("Background error:", err);
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  })();
  // Indicate we will respond asynchronously
  return true;
});

/**
 * content-script/auth.js – listens for window.postMessage from the login page,
 * verifies origin + type + nonce, and relays the session to the background service worker.
 */

const TRUSTED_ORIGINS = new Set([
  "https://get-worms.com",
  "http://localhost:5173",
]);
const MSG_TYPE = "worms:supabaseSession";

let pendingState = null;
let completed = false;

// Ask background for the state we generated in GW_BEGIN_LOGIN
async function fetchPendingState() {
  try {
    const resp = await chrome.runtime.sendMessage({
      type: "GW_GET_PENDING_STATE",
    });
    pendingState = resp?.pendingState || null;
  } catch {}
}
fetchPendingState();

window.addEventListener("message", async (event) => {
  try {
    // 1) origin/type guard
    if (!TRUSTED_ORIGINS.has(event.origin)) return;
    if (event.source !== window) return; // only same-page messages
    const data = event.data;
    if (!data || data.type !== MSG_TYPE) return;

    // 2) ensure we have the current pendingState
    if (!pendingState) await fetchPendingState();

    // 3) validate nonce/state
    if (!data.state || data.state !== pendingState) return;

    // 4) minimal session shape
    const { access_token, refresh_token, expires_at } = data.session || {};
    if (!access_token || !refresh_token || !Number.isFinite(expires_at)) return;

    if (completed) return; // debounce duplicate deliveries
    completed = true;

    // 5) hand off to background
    const response = await chrome.runtime.sendMessage({
      type: "GW_COMPLETE_LOGIN",
      state: data.state,
      session: { access_token, refresh_token, expires_at },
    });

    // 6) notify ui to refresh status
    if (response?.ok) {
      try {
        chrome.runtime.sendMessage({ type: "GW_LOGIN_SUCCESS" });
      } catch {}
    }
  } catch {}
});

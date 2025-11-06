/**
 * content-script/auth.ts
 * -----------------------------------------------------------------------------
 * Bridges the login flow: listens for Supabase session messages from the login
 * page, validates origin + nonce, and delegates persistence to the background
 * service worker.
 */

(function initAuthRelay() {
  type AuthSharedModule = typeof import("../shared/auth.js");
  let authShared: AuthSharedModule | null = null;
  let trustedOrigins = new Set<string>();

  // Load shared auth constants via a web-accessible module URL.
  const authSharedReady = import(
    chrome.runtime.getURL("dist/shared/auth.js")
  ).then((mod) => {
    authShared = mod;
    trustedOrigins = new Set(mod.TRUSTED_LOGIN_ORIGINS);
    return mod;
  });

  let pendingState: string | null = null;
  let completed = false;

  // Fetch the current handshake state from the background worker.
  async function fetchPendingState() {
    await authSharedReady;
    if (!authShared) return;
    try {
      const resp = await chrome.runtime.sendMessage({
        type: authShared.AUTH_MESSAGES.GET_PENDING_STATE,
      });
      pendingState = resp?.pendingState || null;
    } catch {}
  }
  void fetchPendingState();

  window.addEventListener("message", async (event: MessageEvent) => {
    await authSharedReady;
    if (!authShared) return;
    try {
      const { AUTH_MESSAGES, SUPABASE_SESSION_MESSAGE_TYPE } = authShared;
      // 1) origin/type guard
      if (!trustedOrigins.has(event.origin)) return;
      if (event.source !== window) return; // only same-page messages
      const data = event.data as {
        type?: string;
        state?: string;
        session?: {
          access_token?: string;
          refresh_token?: string;
          expires_at?: number;
        };
      };
      if (!data || data.type !== SUPABASE_SESSION_MESSAGE_TYPE) return;

      // 2) ensure we have the current pendingState
      if (!pendingState) await fetchPendingState();

      // 3) validate nonce/state
      if (!data.state || data.state !== pendingState) return;

      // 4) minimal session shape
      const { access_token, refresh_token, expires_at } = data.session || {};
      if (!access_token || !refresh_token || !Number.isFinite(expires_at))
        return;

      if (completed) return; // debounce duplicate deliveries
      completed = true;

      // 5) hand off to background
      const response = await chrome.runtime.sendMessage({
        type: AUTH_MESSAGES.COMPLETE_LOGIN,
        state: data.state,
        session: { access_token, refresh_token, expires_at },
      });

      // 6) notify ui to refresh status
      if (response?.ok) {
        try {
          chrome.runtime.sendMessage({ type: AUTH_MESSAGES.LOGIN_SUCCESS });
        } catch {}
      }
    } catch {}
  });
})();

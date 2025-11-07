(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // content-script/auth.ts
  var require_auth = __commonJS({
    "content-script/auth.ts"() {
      (function initAuthRelay() {
        let authShared = null;
        let trustedOrigins = /* @__PURE__ */ new Set();
        const authSharedReady = import(chrome.runtime.getURL("dist/shared/auth.js")).then((mod) => {
          authShared = mod;
          trustedOrigins = new Set(mod.TRUSTED_LOGIN_ORIGINS);
          return mod;
        });
        let pendingState = null;
        let completed = false;
        async function fetchPendingState() {
          await authSharedReady;
          if (!authShared) return;
          try {
            const resp = await chrome.runtime.sendMessage({
              type: authShared.AUTH_MESSAGES.GET_PENDING_STATE
            });
            pendingState = resp?.pendingState || null;
          } catch {
          }
        }
        void fetchPendingState();
        window.addEventListener("message", async (event) => {
          await authSharedReady;
          if (!authShared) return;
          try {
            const { AUTH_MESSAGES, SUPABASE_SESSION_MESSAGE_TYPE } = authShared;
            if (!trustedOrigins.has(event.origin)) return;
            if (event.source !== window) return;
            const data = event.data;
            if (!data || data.type !== SUPABASE_SESSION_MESSAGE_TYPE) return;
            if (!pendingState) await fetchPendingState();
            if (!data.state || data.state !== pendingState) return;
            const { access_token, refresh_token, expires_at } = data.session || {};
            if (!access_token || !refresh_token || !Number.isFinite(expires_at))
              return;
            if (completed) return;
            completed = true;
            const response = await chrome.runtime.sendMessage({
              type: AUTH_MESSAGES.COMPLETE_LOGIN,
              state: data.state,
              session: { access_token, refresh_token, expires_at }
            });
            if (response?.ok) {
              try {
                chrome.runtime.sendMessage({ type: AUTH_MESSAGES.LOGIN_SUCCESS });
              } catch {
              }
            }
          } catch {
          }
        });
      })();
    }
  });
  require_auth();
})();

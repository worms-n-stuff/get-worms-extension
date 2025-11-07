// shared/auth.ts
var AUTH_MESSAGES = {
  GET_LOGIN_STATUS: "GW_GET_LOGIN_STATUS",
  BEGIN_LOGIN: "GW_BEGIN_LOGIN",
  GET_PENDING_STATE: "GW_GET_PENDING_STATE",
  COMPLETE_LOGIN: "GW_COMPLETE_LOGIN",
  LOGIN_SUCCESS: "GW_LOGIN_SUCCESS"
};
var TRUSTED_LOGIN_ORIGINS = [
  "https://get-worms.com",
  "http://localhost:5173"
];
var HANDSHAKE_TTL_MS = 5 * 60 * 1e3;
var LOGIN_ORIGIN = TRUSTED_LOGIN_ORIGINS[0];

// shared/toggles.ts
var DISPLAY_MODES = [
  "off",
  "private",
  "friends",
  "public"
];
var DISPLAY_MODE_KEY = "pw_display_mode";
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
async function readDisplayMode() {
  try {
    const result = await chrome.storage.sync.get(DISPLAY_MODE_KEY);
    return normalizeMode(result?.[DISPLAY_MODE_KEY]) ?? "off";
  } catch {
    return "off";
  }
}
async function writeDisplayMode(mode) {
  await chrome.storage.sync.set({ [DISPLAY_MODE_KEY]: mode });
}

// popup-logic/popup.ts
var statusEl = document.getElementById("status");
var loginBtn = document.getElementById("loginBtn");
var statusRow = document.getElementById("statusRow");
var modeSection = document.getElementById("modeSection");
var modeInputs = Array.from(
  document.querySelectorAll("input[name='wormMode']")
);
var modeInitialized = false;
function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}
function syncModeRadios(selected) {
  for (const input of modeInputs) {
    input.checked = input.value === selected;
  }
}
async function ensureModeControls() {
  if (modeInitialized) {
    const latest = await readDisplayMode().catch(() => "off");
    syncModeRadios(latest);
    return;
  }
  modeInitialized = true;
  let initialMode = "off";
  try {
    initialMode = await readDisplayMode();
  } catch {
    initialMode = "off";
  }
  syncModeRadios(initialMode);
  for (const input of modeInputs) {
    input.addEventListener("change", async () => {
      if (!input.checked) return;
      const next = input.value;
      if (!DISPLAY_MODES.includes(next)) return;
      try {
        await writeDisplayMode(next);
      } catch {
        syncModeRadios(initialMode);
      }
    });
  }
}
async function refreshStatus() {
  try {
    const resp = await chrome.runtime.sendMessage({
      type: AUTH_MESSAGES.GET_LOGIN_STATUS
    });
    const loggedIn = Boolean(resp?.loggedIn);
    if (loggedIn) {
      await ensureModeControls();
      if (statusRow) statusRow.style.display = "none";
      if (loginBtn) loginBtn.style.display = "none";
      if (modeSection) modeSection.style.display = "flex";
    } else {
      if (statusRow) statusRow.style.display = "flex";
      setStatus("Logged out");
      if (loginBtn) loginBtn.style.display = "inline-block";
      if (modeSection) modeSection.style.display = "none";
      modeInitialized = false;
    }
  } catch (err) {
    console.error("Failed to refresh login status:", err);
    setStatus("Unable to check status");
  }
}
loginBtn?.addEventListener("click", async () => {
  try {
    const resp = await chrome.runtime.sendMessage({
      type: AUTH_MESSAGES.BEGIN_LOGIN
    });
    if (resp?.ok) {
      setStatus("Opening login\u2026");
    } else {
      setStatus("Could not start login");
      console.error(resp?.error || "unknown error");
    }
  } catch (err) {
    setStatus("Could not start login");
    console.error(err);
  }
});
document.addEventListener("DOMContentLoaded", () => {
  void refreshStatus();
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === AUTH_MESSAGES.LOGIN_SUCCESS) {
    setStatus("Logged in");
    void ensureModeControls().then(() => refreshStatus());
  }
});

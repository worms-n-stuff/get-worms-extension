/**
 * popup-logic/popup.ts
 * -----------------------------------------------------------------------------
 * Coordinates login status UI and the worms ON/OFF toggle within the popup.
 */

import { AUTH_MESSAGES } from "../shared/auth.js";
import { readWormsToggle, writeWormsToggle } from "../shared/toggles.js";

const statusEl = document.getElementById("status");
const loginBtn = document.getElementById("loginBtn");
const statusRow = document.getElementById("statusRow");
const toggleLabel = document.getElementById("on-off-toggle");
const toggleEl = document.getElementById("toggle") as HTMLInputElement | null;

let toggleInitialized = false;

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

async function ensureToggleInitialized(): Promise<void> {
  if (!toggleEl || toggleInitialized) return;
  toggleInitialized = true;
  try {
    const enabled = await readWormsToggle();
    toggleEl.checked = !!enabled;
  } catch {
    toggleEl.checked = false;
  }
  toggleEl.addEventListener("change", async () => {
    try {
      await writeWormsToggle(toggleEl.checked);
    } catch {
      // noop – UI state remains optimistic
    }
  });
}

async function refreshStatus(): Promise<void> {
  try {
    const resp = await chrome.runtime.sendMessage({
      type: AUTH_MESSAGES.GET_LOGIN_STATUS,
    });
    const loggedIn = Boolean(resp?.loggedIn);
    if (loggedIn) {
      await ensureToggleInitialized();
      if (statusRow) statusRow.style.display = "none";
      if (loginBtn) loginBtn.style.display = "none";
      if (toggleLabel) toggleLabel.style.display = "block";
    } else {
      if (statusRow) statusRow.style.display = "flex";
      setStatus("Logged out");
      if (loginBtn) loginBtn.style.display = "inline-block";
      if (toggleLabel) toggleLabel.style.display = "none";
    }
  } catch (err) {
    console.error("Failed to refresh login status:", err);
    setStatus("Unable to check status");
  }
}

loginBtn?.addEventListener("click", async () => {
  try {
    const resp = await chrome.runtime.sendMessage({
      type: AUTH_MESSAGES.BEGIN_LOGIN,
    });
    if (resp?.ok) {
      setStatus("Opening login…");
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
    void ensureToggleInitialized().then(() => refreshStatus());
  }
});

export {};

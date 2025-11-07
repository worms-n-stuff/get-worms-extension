/**
 * popup-logic/popup.ts
 * -----------------------------------------------------------------------------
 * Coordinates login status UI and the worms display mode selector within the popup.
 */
import { AUTH_MESSAGES } from "../shared/auth.js";
import { readDisplayMode, writeDisplayMode, DISPLAY_MODES, } from "../shared/toggles.js";
const statusEl = document.getElementById("status");
const loginBtn = document.getElementById("loginBtn");
const statusRow = document.getElementById("statusRow");
const modeSection = document.getElementById("modeSection");
const modeInputs = Array.from(document.querySelectorAll("input[name='wormMode']"));
let modeInitialized = false;
function setStatus(text) {
    if (statusEl)
        statusEl.textContent = text;
}
function syncModeRadios(selected) {
    for (const input of modeInputs) {
        input.checked = input.value === selected;
    }
}
/** Lazily bind the display mode radios and hydrate their initial state. */
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
    }
    catch {
        initialMode = "off";
    }
    syncModeRadios(initialMode);
    for (const input of modeInputs) {
        input.addEventListener("change", async () => {
            if (!input.checked)
                return;
            const next = input.value;
            if (!DISPLAY_MODES.includes(next))
                return;
            try {
                await writeDisplayMode(next);
            }
            catch {
                // Swallow storage errors; popup will try syncing on next open.
                syncModeRadios(initialMode);
            }
        });
    }
}
/** Ask the background worker for the login status and update the view. */
async function refreshStatus() {
    try {
        const resp = await chrome.runtime.sendMessage({
            type: AUTH_MESSAGES.GET_LOGIN_STATUS,
        });
        const loggedIn = Boolean(resp?.loggedIn);
        if (loggedIn) {
            await ensureModeControls();
            if (statusRow)
                statusRow.style.display = "none";
            if (loginBtn)
                loginBtn.style.display = "none";
            if (modeSection)
                modeSection.style.display = "flex";
        }
        else {
            if (statusRow)
                statusRow.style.display = "flex";
            setStatus("Logged out");
            if (loginBtn)
                loginBtn.style.display = "inline-block";
            if (modeSection)
                modeSection.style.display = "none";
            modeInitialized = false;
        }
    }
    catch (err) {
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
        }
        else {
            setStatus("Could not start login");
            console.error(resp?.error || "unknown error");
        }
    }
    catch (err) {
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

/**
 * shared/toggles.ts
 * -----------------------------------------------------------------------------
 * Central helpers for the PageWorms ON/OFF toggle that lives in chrome.storage.
 */
export const PW_TOGGLE_KEY = "pw_enabled";
/** Ensure the toggle has an initialized value (defaults to false) and return it. */
export async function ensureWormsToggle(defaultValue = false) {
    try {
        const result = await chrome.storage.sync.get(PW_TOGGLE_KEY);
        if (result?.[PW_TOGGLE_KEY] === undefined) {
            await chrome.storage.sync.set({ [PW_TOGGLE_KEY]: defaultValue });
            return defaultValue;
        }
        return Boolean(result[PW_TOGGLE_KEY]);
    }
    catch {
        return defaultValue;
    }
}
/** Read the current toggle value (falls back to false on errors). */
export async function readWormsToggle() {
    try {
        const result = await chrome.storage.sync.get(PW_TOGGLE_KEY);
        return Boolean(result?.[PW_TOGGLE_KEY]);
    }
    catch {
        return false;
    }
}
/** Persist the toggle value. */
export async function writeWormsToggle(enabled) {
    await chrome.storage.sync.set({ [PW_TOGGLE_KEY]: enabled });
}

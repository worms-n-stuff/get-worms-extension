/**
 * shared/toggles.ts
 * -----------------------------------------------------------------------------
 * Central helpers for the PageWorms display mode that lives in chrome.storage.
 */

export type WormDisplayMode = "off" | "private" | "friends" | "public";

export const DISPLAY_MODES: WormDisplayMode[] = [
  "off",
  "private",
  "friends",
  "public",
];

export const DISPLAY_MODE_KEY = "pw_display_mode";

function normalizeMode(value: unknown): WormDisplayMode | null {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (DISPLAY_MODES.includes(normalized as WormDisplayMode)) {
      return normalized as WormDisplayMode;
    }
    // Legacy alias support (old "mine" option)
    if (normalized === "mine") return "private";
  }
  return null;
}

/** Ensure the display mode exists (defaults to "off") and return it. */
export async function ensureDisplayMode(
  defaultMode: WormDisplayMode = "off"
): Promise<WormDisplayMode> {
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

/** Read the current display mode (falls back to "off" on errors). */
export async function readDisplayMode(): Promise<WormDisplayMode> {
  try {
    const result = await chrome.storage.sync.get(DISPLAY_MODE_KEY);
    return normalizeMode(result?.[DISPLAY_MODE_KEY]) ?? "off";
  } catch {
    return "off";
  }
}

/** Persist the display mode. */
export async function writeDisplayMode(
  mode: WormDisplayMode
): Promise<void> {
  await chrome.storage.sync.set({ [DISPLAY_MODE_KEY]: mode });
}

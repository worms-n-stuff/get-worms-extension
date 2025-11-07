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
async function ensureDisplayMode(defaultMode = "off") {
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
export {
  DISPLAY_MODES,
  DISPLAY_MODE_KEY,
  ensureDisplayMode,
  readDisplayMode,
  writeDisplayMode
};

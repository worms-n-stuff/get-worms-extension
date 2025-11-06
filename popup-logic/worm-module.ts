/**
 * popup-logic/worm-module.js – stores and syncs the worms toggle value
 */
import { readWormsToggle, writeWormsToggle } from "../shared/toggles.js";

const toggleEl = document.getElementById("toggle") as HTMLInputElement | null;

(async function init() {
  if (!toggleEl) return;
  const enabled = await readWormsToggle();
  toggleEl.checked = !!enabled;

  toggleEl.addEventListener("change", async () => {
    await writeWormsToggle(toggleEl.checked);
  });
})();

export {};

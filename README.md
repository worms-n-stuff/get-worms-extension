# get worms browser extension

This repository contains the **get worms** Chrome extension. It lets authenticated users create and view "worms" (inline comments) on any web page. The codebase has been migrated to TypeScript while preserving the existing runtime behaviour. Compiled JavaScript assets live in `dist/` so the extension can still be shipped as standard JS.

## Project structure

- `content-script/` – in-page scripts that bootstrap the worms UI and handle auth messaging.
- `page-worms/` – shared UI/anchoring logic rendered inside web pages (built as web-accessible modules).
- `popup-logic/` – scripts used by the extension popup (`popup.html`).
- `service-worker/` – background/service worker modules (auth, menu wiring, toggle state).
- `page-worms/styles.css` – styles injected into target pages.
- `dist/` – build output produced by the TypeScript compiler (mirrors the folder layout above).
- `shared/` – cross-context helpers (auth message constants, toggle utilities).

## Getting started

1. Install dependencies: `npm install`
2. Compile TypeScript: `npm run build`
   - Emits JavaScript to `dist/`
3. (Optional) Watch for changes: `npm run dev`
4. Clean build artifacts: `npm run clean`

## Loading the extension locally

1. Run `npm run build` so `dist/` is up to date.
2. Open `chrome://extensions` (or the equivalent in Chromium-based browsers).
3. Enable **Developer mode**.
4. Click **Load unpacked** and choose the repository root (the folder containing `manifest.json`).

The manifest now points to scripts inside `dist/`, so the extension must be rebuilt after TypeScript changes.

## Notes for contributors

- Static assets (HTML, CSS, icons) remain alongside the source files; only TypeScript is compiled into `dist/`.
- The popup HTML now sources its scripts from `dist/popup-logic/*`. If you add new popup modules, remember to update both the TypeScript source and the compiled output via `npm run build`.
- `chrome.runtime.getURL` lookups expect compiled modules in `dist/`, so avoid moving built files without updating those strings.

Happy worming!

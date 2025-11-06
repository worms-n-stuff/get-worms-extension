# get worms browser extension

This repository contains the **get worms** Chrome extension. It lets authenticated users create and view "worms" (inline comments) on any web page. There are two parts to this extension: 
1. the page worms module (the ui/anchoring logic), which resides in page-worms, 
2. and the auth flow, which has relevant codes in content-script, popup-logic, service-worker, and shared. 
All other code are connections which connect the two parts and them to the extension. A important file for connection is manifest.json, which importantly registers what scripts/ui the google extension should use and in what context.

## Project structure

- `content-script/` – in-page scripts that bootstrap the worms UI and handle auth messaging.
- `page-worms/` – shared UI/anchoring logic rendered inside web pages (built as web-accessible modules).
- `popup-logic/` – scripts used by the extension popup (`popup.html`).
- `service-worker/` – background/service worker modules (auth, menu wiring, toggle state).
- `page-worms/styles.css` – styles injected into target pages.
- `dist/` – build output produced by the TypeScript compiler (mirrors the folder layout above).
- `shared/` – cross-context helpers for content-script/popup-logic/service-worker (auth message constants, toggle utilities).

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

Happy worming!

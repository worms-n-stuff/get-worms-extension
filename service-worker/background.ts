/**
 * service-worker/background.ts
 * -----------------------------------------------------------------------------
 * Entry point for the extension service worker. Wires up auth + worm toggles.
 */

import { registerAuthHandlers } from "./auth.js";
import { registerWormModuleHandlers } from "./worm-module.js";

registerAuthHandlers();
registerWormModuleHandlers();

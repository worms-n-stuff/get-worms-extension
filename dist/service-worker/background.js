/**
 * service-worker/background.js – The service worker
 * Responsibilities include:
 * - Owning the auth flow (auth.js)
 * - Controlling the worm module (worm-module.js)
 */
import "./auth.js";
import "./worm-module.js";

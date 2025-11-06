/**
 * shared/auth.ts
 * -----------------------------------------------------------------------------
 * Constants shared across the auth messaging flow (popup, content script, SW).
 */

export const AUTH_MESSAGES = {
  GET_LOGIN_STATUS: "GW_GET_LOGIN_STATUS",
  BEGIN_LOGIN: "GW_BEGIN_LOGIN",
  GET_PENDING_STATE: "GW_GET_PENDING_STATE",
  COMPLETE_LOGIN: "GW_COMPLETE_LOGIN",
  LOGIN_SUCCESS: "GW_LOGIN_SUCCESS",
} as const;

export type AuthMessage =
  (typeof AUTH_MESSAGES)[keyof typeof AUTH_MESSAGES];

export const TRUSTED_LOGIN_ORIGINS = [
  "https://get-worms.com",
  "http://localhost:5173",
] as const;

export const SUPABASE_SESSION_MESSAGE_TYPE = "worms:supabaseSession";

export const HANDSHAKE_STORAGE_KEY = "gw_login_handshake";
export const SESSION_STORAGE_KEY = "gw_supabase_session";
export const HANDSHAKE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const LOGIN_ORIGIN = TRUSTED_LOGIN_ORIGINS[0];
export const LOGIN_PATH = "";

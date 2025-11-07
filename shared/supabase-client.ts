/**
 * shared/supabase-client.ts
 * -----------------------------------------------------------------------------
 * Thin wrapper around the Supabase JS client that knows how to hydrate the
 * session from chrome.storage.local (where the background auth flow persists
 * tokens). All contexts share this helper to ensure consistent auth behavior.
 */

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { SESSION_STORAGE_KEY } from "./auth.js";

export type StoredSupabaseSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

let cachedClient: SupabaseClient | null = null;

function ensureClient(): SupabaseClient {
  if (!cachedClient) {
    cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
  }
  return cachedClient;
}

async function readStoredSession(): Promise<StoredSupabaseSession | null> {
  if (!chrome?.storage?.local) return null;
  try {
    const obj = await chrome.storage.local.get(SESSION_STORAGE_KEY);
    const stored = obj?.[SESSION_STORAGE_KEY];
    if (
      stored &&
      typeof stored.access_token === "string" &&
      typeof stored.refresh_token === "string" &&
      Number.isFinite(stored.expires_at)
    ) {
      return stored as StoredSupabaseSession;
    }
  } catch (err) {
    console.warn("[Supabase] Failed to read stored session", err);
  }
  return null;
}

async function persistStoredSession(session: Partial<StoredSupabaseSession> | null): Promise<void> {
  if (!chrome?.storage?.local) return;
  try {
    if (session) {
      await chrome.storage.local.set({
        [SESSION_STORAGE_KEY]: session,
      });
    } else {
      await chrome.storage.local.remove(SESSION_STORAGE_KEY);
    }
  } catch (err) {
    console.warn("[Supabase] Failed to persist session", err);
  }
}

export type SupabaseConnection = {
  client: SupabaseClient;
  session: Session;
};

/**
 * Hydrate the Supabase client with the stored session. Returns null when
 * credentials or session tokens are missing.
 */
export async function getSupabaseConnection(): Promise<SupabaseConnection | null> {
  const stored = await readStoredSession();
  if (!stored?.access_token || !stored?.refresh_token) return null;
  const client = ensureClient();
  const { data, error } = await client.auth.setSession({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
  });
  if (error || !data.session) {
    console.warn("[Supabase] Failed to hydrate session", error);
    return null;
  }
  await persistSessionFromSupabase(data.session);
  return { client, session: data.session };
}

/** Convenience helper that throws when no Supabase connection is available. */
export async function requireSupabaseConnection(): Promise<SupabaseConnection> {
  const conn = await getSupabaseConnection();
  if (!conn) {
    throw new Error("Supabase session is missing. Please log in via the extension popup.");
  }
  return conn;
}

async function persistSessionFromSupabase(session: Session): Promise<void> {
  const next: StoredSupabaseSession = {
    access_token: session.access_token,
    refresh_token: session.refresh_token || "",
    expires_at: session.expires_at || Math.floor(Date.now() / 1000),
  };
  await persistStoredSession(next);
}

export async function clearSupabaseClientCache(): Promise<void> {
  cachedClient = null;
}

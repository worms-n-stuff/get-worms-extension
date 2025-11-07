/**
 * supabase-adapter.ts
 * -----------------------------------------------------------------------------
 * Remote storage adapter that persists worms to the Supabase Postgres database.
 * It relies on the shared Supabase client wrapper, which hydrates sessions from
 * chrome.storage.local (populated by the background auth flow).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseConnection, requireSupabaseConnection } from "../../shared/supabase-client.js";
import { readDisplayMode, type WormDisplayMode } from "../../shared/toggles.js";
import type { WormFormData, WormRecord, WormStatus } from "../types.js";
import type { StorageAdapter, WormDraft } from "./types.js";

type WormRow = {
  id: number | string;
  created_at: string;
  updated_at: string | null;
  content: string;
  status: string;
  tags: string[] | null;
  author_id: number | string | null;
  position: WormRecord["position"];
  host_url: string | null;
};

type ProfileRow = {
  id: number | string;
  auth_id: string;
};

type FriendEdgeRow = {
  a: string;
  b: string;
  state: string;
};

export function createSupabaseStorageAdapter(): StorageAdapter {
  return new SupabaseStorageAdapter();
}

class SupabaseStorageAdapter implements StorageAdapter {
  async list(url: string): Promise<WormRecord[]> {
    const connection = await getSupabaseConnection();
    if (!connection) return [];

    const mode = await safeReadDisplayMode();
    if (mode === "off") return [];

    const profile = await fetchViewerProfile(connection.client, connection.session.user.id);
    if (!profile || !profile.idNumber) return [];

    const friendProfileIds = await fetchFriendProfileIds(connection.client, profile.auth_id);
    const friendIdSet = new Set(friendProfileIds);

    const { data, error } = await connection.client
      .from("worms")
      .select("id, created_at, updated_at, content, status, tags, author_id, position, host_url")
      .eq("host_url", url)
      .order("created_at", { ascending: true });

    if (error || !data) {
      console.error("[SupabaseAdapter] Failed to list worms:", error);
      return [];
    }

    return (data as WormRow[])
      .map((row) => normalizeWorm(row))
      .filter((worm) => shouldDisplayWorm(worm, mode, profile.idNumber, friendIdSet));
  }

  async create(url: string, payload: WormDraft): Promise<WormRecord> {
    const { client, session } = await requireSupabaseConnection();
    const profile = await fetchViewerProfile(client, session.user.id);
    if (!profile?.idNumber) {
      throw new Error("Unable to resolve your profile. Please complete onboarding.");
    }
    const insertPayload = {
      content: payload.content ?? "",
      tags: payload.tags ?? [],
      status: payload.status,
      position: payload.position,
      host_url: payload.host_url,
      author_id: profile.idNumber,
    };
    const { data, error } = await client
      .from("worms")
      .insert(insertPayload)
      .select("id, created_at, updated_at, content, status, tags, author_id, position, host_url")
      .single();
    if (error || !data) {
      throw new Error(error?.message || "Failed to create worm");
    }
    return normalizeWorm(data as WormRow);
  }

  async update(url: string, wormId: number, updates: WormFormData): Promise<WormRecord> {
    const { client, session } = await requireSupabaseConnection();
    const profile = await fetchViewerProfile(client, session.user.id);
    if (!profile?.idNumber) {
      throw new Error("Unable to resolve your profile. Please complete onboarding.");
    }
    const updatePayload = {
      content: updates.content ?? "",
      tags: updates.tags ?? [],
      status: updates.status,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await client
      .from("worms")
      .update(updatePayload)
      .eq("id", wormId)
      .eq("author_id", profile.idNumber)
      .select("id, created_at, updated_at, content, status, tags, author_id, position, host_url")
      .single();

    if (error || !data) {
      throw new Error(error?.message || "Failed to update worm");
    }

    return normalizeWorm(data as WormRow);
  }

  async remove(url: string, wormId: number): Promise<void> {
    const { client, session } = await requireSupabaseConnection();
    const profile = await fetchViewerProfile(client, session.user.id);
    if (!profile?.idNumber) {
      throw new Error("Unable to resolve your profile. Please complete onboarding.");
    }
    const { error } = await client
      .from("worms")
      .delete()
      .eq("id", wormId)
      .eq("author_id", profile.idNumber);

    if (error) {
      throw new Error(error.message || "Failed to delete worm");
    }
  }
}

async function safeReadDisplayMode(): Promise<WormDisplayMode> {
  try {
    return await readDisplayMode();
  } catch {
    return "off";
  }
}

function normalizeStatus(value: unknown): WormStatus {
  if (value === "friends" || value === "public") return value;
  return "private";
}

function normalizeNumber(value: number | string | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeWorm(row: WormRow): WormRecord {
  return {
    id: Number(normalizeNumber(row.id) ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
    content: row.content || "",
    status: normalizeStatus(row.status),
    tags: row.tags && row.tags.length ? row.tags : null,
    author_id: normalizeNumber(row.author_id),
    position: row.position,
    host_url: row.host_url || "",
  };
}

function shouldDisplayWorm(
  worm: WormRecord,
  mode: WormDisplayMode,
  viewerProfileId: number | null,
  friendIds: Set<number>
): boolean {
  if (mode === "private") {
    return viewerProfileId != null && worm.author_id === viewerProfileId;
  }

  const isMine = viewerProfileId != null && worm.author_id === viewerProfileId;
  if (isMine) return true;

  if (mode === "friends") {
    if (!worm.author_id || !friendIds.has(worm.author_id)) return false;
    return worm.status === "friends" || worm.status === "public";
  }

  // public mode
  if (worm.status === "public") return true;
  if (worm.author_id && friendIds.has(worm.author_id)) {
    return worm.status === "friends";
  }
  return false;
}

async function fetchViewerProfile(
  client: SupabaseClient,
  authId: string
): Promise<(ProfileRow & { idNumber: number | null }) | null> {
  const { data, error } = await client
    .from("profiles")
    .select("id, auth_id")
    .eq("auth_id", authId)
    .maybeSingle();

  if (error) {
    console.error("[SupabaseAdapter] Failed to fetch profile:", error);
    return null;
  }
  if (!data) return null;
  return {
    ...data,
    idNumber: normalizeNumber(data.id),
  };
}

async function fetchFriendProfileIds(
  client: SupabaseClient,
  viewerAuthId: string
): Promise<number[]> {
  const { data, error } = await client
    .from("friend_edges")
    .select("a, b, state")
    .or(`a.eq.${viewerAuthId},b.eq.${viewerAuthId}`)
    .eq("state", "accepted");

  if (error || !data) {
    if (error) {
      console.error("[SupabaseAdapter] Failed to fetch friend edges:", error);
    }
    return [];
  }

  const friendAuthIds = new Set<string>();
  for (const edge of data as FriendEdgeRow[]) {
    const other =
      edge.a === viewerAuthId
        ? edge.b
        : edge.b === viewerAuthId
        ? edge.a
        : null;
    if (other) friendAuthIds.add(other);
  }
  if (!friendAuthIds.size) return [];

  const { data: profiles, error: profileError } = await client
    .from("profiles")
    .select("id, auth_id")
    .in("auth_id", Array.from(friendAuthIds));

  if (profileError || !profiles) {
    if (profileError) {
      console.error("[SupabaseAdapter] Failed to fetch friend profiles:", profileError);
    }
    return [];
  }

  return profiles
    .map((row) => normalizeNumber(row.id))
    .filter((id): id is number => typeof id === "number");
}

/**
 * Bot User Allowlist & RBAC
 *
 * Access is granted from two sources (checked in order):
 *   1. ADMIN_TELEGRAM_IDS env var — comma-separated Telegram user IDs that are
 *      permanently granted admin role without needing a DB entry. Used for
 *      bootstrapping before the bot_users table exists.
 *   2. bot_users Supabase table — individual records with role + expiry.
 *
 * The in-memory cache is invalidated after every admin mutation.
 */

import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

export type BotRole = "viewer" | "operator" | "admin";

export interface BotUser {
  telegram_user_id: number;
  username: string | null;
  role: BotRole;
  active: boolean;
  approved_by: number | null;
  expires_at: string | null;
  created_at: string;
}

// Bootstrap admin IDs — always allowed, always admin, never expire.
const ENV_ADMIN_IDS: Set<number> = new Set(
  (process.env.ADMIN_TELEGRAM_IDS ?? "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0),
);

if (ENV_ADMIN_IDS.size === 0) {
  logger.warn(
    "ADMIN_TELEGRAM_IDS not set — no bootstrap admins configured. " +
    "No one will be able to manage bot users until this is set.",
  );
}

let cache: Map<number, BotUser> | null = null;
let tableExists: boolean | null = null;   // null = unknown, false = missing

export function isEnvAdmin(userId: number): boolean {
  return ENV_ADMIN_IDS.has(userId);
}

async function loadCache(): Promise<Map<number, BotUser>> {
  const map = new Map<number, BotUser>();
  if (tableExists === false) return map;          // known missing — skip

  try {
    const { data, error } = await supabase
      .from("bot_users")
      .select("*")
      .eq("active", true);

    if (error) {
      if (error.code === "42P01") {               // undefined_table
        tableExists = false;
        logger.warn(
          "bot_users table missing — run scripts/migrate-supabase-security.sql in Supabase SQL Editor",
        );
      } else {
        logger.error({ err: error }, "Failed to load bot_users");
      }
      return map;
    }

    tableExists = true;
    for (const u of data ?? []) {
      map.set(u.telegram_user_id as number, u as BotUser);
    }
  } catch (err) {
    logger.error({ err }, "Unexpected error loading bot_users");
  }
  return map;
}

async function getCache(): Promise<Map<number, BotUser>> {
  if (!cache) cache = await loadCache();
  return cache;
}

export function invalidateCache(): void {
  cache = null;
}

/** Return the user's role, or null if they are not allowed. */
export async function getUserRole(userId: number): Promise<BotRole | null> {
  if (isEnvAdmin(userId)) return "admin";

  const c = await getCache();
  const user = c.get(userId);
  if (!user || !user.active) return null;
  if (user.expires_at && new Date(user.expires_at) < new Date()) {
    logger.info({ userId }, "Bot user access expired");
    return null;
  }
  return user.role;
}

/** Add or update a user in the allowlist. */
export async function addUser(
  telegramUserId: number,
  role: BotRole,
  approvedBy: number,
  username?: string,
): Promise<void> {
  if (tableExists === false) {
    throw new Error("bot_users table does not exist — run the security migration first");
  }
  const { error } = await supabase.from("bot_users").upsert(
    {
      telegram_user_id: telegramUserId,
      username: username ?? null,
      role,
      active: true,
      approved_by: approvedBy,
    },
    { onConflict: "telegram_user_id" },
  );
  if (error) throw new Error(error.message);
  invalidateCache();
}

/** Deactivate a user (soft-delete). */
export async function revokeUser(telegramUserId: number): Promise<boolean> {
  if (tableExists === false) return false;
  const { error, count } = await supabase
    .from("bot_users")
    .update({ active: false })
    .eq("telegram_user_id", telegramUserId);
  invalidateCache();
  return !error && (count ?? 0) > 0;
}

/** List all active users from the DB (plus env admins). */
export async function listAllUsers(): Promise<
  Array<{ id: number; username: string | null; role: string; source: string }>
> {
  invalidateCache();
  const c = await getCache();
  const dbUsers = Array.from(c.values()).map((u) => ({
    id: u.telegram_user_id,
    username: u.username,
    role: u.role,
    source: "db",
  }));
  const envAdmins = Array.from(ENV_ADMIN_IDS).map((id) => ({
    id,
    username: null,
    role: "admin" as const,
    source: "env",
  }));
  // Merge: env admins override DB entries for same ID
  const seen = new Set(envAdmins.map((u) => u.id));
  return [...envAdmins, ...dbUsers.filter((u) => !seen.has(u.id))];
}

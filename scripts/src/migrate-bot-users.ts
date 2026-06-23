/**
 * One-time migration: reads bot_users (and bot_audit_log) from Supabase,
 * writes them to the local Replit PostgreSQL database.
 *
 * Run with:
 *   pnpm --filter @workspace/scripts run migrate-bot-users
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL env vars.
 * Safe to re-run — uses ON CONFLICT DO UPDATE (upsert) for bot_users.
 */

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.DATABASE_URL;

if (!supabaseUrl || !supabaseKey) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}
if (!databaseUrl) {
  console.error("ERROR: DATABASE_URL must be set");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});
const pool = new pg.Pool({ connectionString: databaseUrl });

async function migrateTable(tableName: string): Promise<void> {
  console.log(`\nFetching ${tableName} from Supabase...`);

  let allRows: Record<string, unknown>[] = [];
  let from = 0;
  const PAGE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select("*")
      .range(from, from + PAGE - 1);

    if (error) {
      if (error.code === "42P01") {
        console.log(`  Table ${tableName} does not exist in Supabase — skipping`);
        return;
      }
      throw new Error(`Supabase error on ${tableName}: ${error.message}`);
    }

    const page = data ?? [];
    allRows = allRows.concat(page);
    if (page.length < PAGE) break;
    from += PAGE;
  }

  console.log(`  Found ${allRows.length} rows`);
  if (allRows.length === 0) return;

  if (tableName === "bot_users") {
    for (const u of allRows) {
      await pool.query(
        `INSERT INTO bot_users (telegram_user_id, username, role, active, approved_by, expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (telegram_user_id) DO UPDATE SET
           username    = EXCLUDED.username,
           role        = EXCLUDED.role,
           active      = EXCLUDED.active,
           approved_by = EXCLUDED.approved_by,
           expires_at  = EXCLUDED.expires_at`,
        [
          u.telegram_user_id,
          u.username ?? null,
          u.role ?? "viewer",
          u.active ?? true,
          u.approved_by ?? null,
          u.expires_at ?? null,
          u.created_at ?? null,
          u.updated_at ?? null,
        ],
      );
    }
    console.log(`  Migrated ${allRows.length} bot_users`);
  } else if (tableName === "bot_audit_log") {
    for (const row of allRows) {
      await pool.query(
        `INSERT INTO bot_audit_log (telegram_user_id, category, query_text, response_type, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [
          row.telegram_user_id,
          row.category ?? null,
          row.query_text ?? null,
          row.response_type ?? null,
          row.created_at ?? null,
        ],
      );
    }
    console.log(`  Migrated ${allRows.length} bot_audit_log entries`);
  }
}

async function main(): Promise<void> {
  console.log("=== Supabase → Replit PostgreSQL Migration ===");
  console.log("Migrating: bot_users, bot_audit_log");
  console.log("(cmdb / energy_dashboard / cow_movement will be re-synced from Google Sheets)");

  await migrateTable("bot_users");
  await migrateTable("bot_audit_log");

  console.log("\n✅ Migration complete");
  await pool.end();
}

main().catch((err: unknown) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

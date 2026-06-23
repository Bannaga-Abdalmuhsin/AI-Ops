---
name: DB migration to local PostgreSQL
description: Migrated all DB operations from Supabase (supabase-js) to Replit built-in PostgreSQL (pg Pool + DATABASE_URL). Covers what changed and what to watch out for.
---

## The rule
All DB queries use `pool` from `artifacts/api-server/src/lib/db.ts` (pg Pool, DATABASE_URL). Never use supabase-js for data queries at runtime.

**Why:** Supabase HTTPS adds latency; Replit's built-in PostgreSQL is local, faster, and eliminates the external dependency. Supabase port 5432 is also blocked in Replit.

## What changed
- `bot.ts`, `sync.ts`, `bot-users.ts`, `routes/data.ts`, `routes/stats.ts`, `routes/sync.ts` — all rewritten to use `pool.query()`.
- `supabase.ts` still exists but is no longer imported anywhere (kept for reference/rollback).
- Sync cron changed from `"0 2 * * *"` (daily 02:00 UTC) to `"0 */2 * * *"` (every 2 hours).

## Bot migration patterns
- Supabase paginated queries (`range(0, 999)` etc.) replaced with single `pool.query()` calls — local PG has no 1000-row cap.
- Supabase `count: "exact", head: true` replaced with `SELECT COUNT(*) FROM ...` + `parseInt(rows[0].count, 10)`.
- Supabase `.ilike()` filters replaced with `ILIKE $N` parameterized conditions using push-return index trick.
- Supabase `.or("region_from.eq.X,region_to.eq.X")` replaced with `WHERE (region_from = $1 OR region_to = $1)`.
- Supabase `.maybeSingle()` replaced with `LIMIT 1` + `rows[0] ?? null`.

## bot_users migration
- Script: `pnpm --filter @workspace/scripts run migrate-bot-users`
- Safe to re-run (upsert logic). Migrated 3 users + 26 audit log entries on first run.
- Supabase secrets still present but only used by migration script, not runtime.

## How to apply
Any future query that touches `cmdb`, `energy_dashboard`, `cow_movement`, `sync_log`, `bot_users`, or `bot_audit_log` must use `pool.query()`. Never reintroduce supabase-js imports in server code.

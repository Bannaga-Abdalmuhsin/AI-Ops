# COW OPS SYNC

A live-updating ops dashboard that syncs three Google Sheets (CMDB, Energy Dashboard, COW Movement) into a local PostgreSQL database and exposes them through a searchable React dashboard.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at `/api`)
- `pnpm --filter @workspace/sync-dashboard run dev` — run the React dashboard (port 18929, proxied at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/scripts run migrate-bot-users` — one-time migration of bot_users from Supabase to local PostgreSQL

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (`artifacts/api-server`)
- Frontend: React + Vite + shadcn/ui + Tailwind (`artifacts/sync-dashboard`)
- DB: Replit built-in PostgreSQL (via `pg` Pool, `DATABASE_URL` env var)
- Google Sheets: `googleapis` service account (portable) or `@replit/connectors-sdk` fallback (Replit-only)
- Validation: Zod (`zod/v4`), generated via Orval from OpenAPI spec
- Build: esbuild (CJS bundle for api-server)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/api-zod/src/generated/api.ts` — generated Zod schemas
- `lib/api-client-react/src/generated/api.ts` — generated React Query hooks
- `artifacts/api-server/src/lib/db.ts` — local PostgreSQL pool (pg, DATABASE_URL)
- `artifacts/api-server/src/lib/sheets.ts` — Google Sheets fetch functions
- `artifacts/api-server/src/lib/sync.ts` — sync logic (upsert to local PostgreSQL)
- `artifacts/api-server/src/routes/` — sync, data, stats routes
- `artifacts/sync-dashboard/src/pages/` — Overview, CMDB, Energy, COW Movement, Sync Logs
- `scripts/migrate-supabase.sql` — legacy schema reference (tables now in Replit DB)
- `scripts/src/migrate-bot-users.ts` — one-time Supabase → local PostgreSQL bot_users migration

## Architecture decisions

- **Local PostgreSQL via pg Pool**: All DB operations use Replit's built-in PostgreSQL via `pg` Pool and `DATABASE_URL`. No Supabase dependency at runtime.
- **No `@workspace/db`**: This project doesn't use Drizzle ORM — raw `pg` queries only.
- **Contract-first API**: All routes defined in `lib/api-spec/openapi.yaml` first; run codegen after any change.
- **CMDB/Energy use upsert on conflict**: CMDB conflicts on `cow_id`, Energy on `site`. COW Movement does full delete + re-insert on each sync.
- **Auto-sync every 2 hours**: Cron `"0 */2 * * *"` (UTC). Override with `SYNC_CRON_SCHEDULE` env var.
- **Google Sheets auth**: `sheets.ts` checks `GOOGLE_SERVICE_ACCOUNT_JSON` first (googleapis, portable). Falls back to Replit connector if unset. Set the env var to enable hosting on Railway/Render/any VPS.
- **Deployment configs**: `railway.json` and `render.yaml` at repo root for Railway/Render deploys.

## Product

- Overview dashboard: total COWs, on-air count, per-table row counts, region distribution, sync status per table, "Sync All" button
- CMDB page: searchable/paginated table of 562 COW infrastructure records
- Energy page: searchable/paginated table of 558 fueling/energy records
- COW Movement page: searchable/paginated table of 2,830 movement history records
- Sync Logs page: full audit trail of every sync run with duration, rows synced, errors

## Local PostgreSQL tables

- `cmdb` — master COW infrastructure records (UNIQUE on `cow_id`)
- `energy_dashboard` — power/fuel records (UNIQUE on `site`)
- `cow_movement` — movement history (full replace on each sync)
- `sync_log` — audit trail of every sync run
- `bot_users` — Telegram bot access control (UNIQUE on `telegram_user_id`)
- `bot_audit_log` — bot query history for compliance

## Google Sheets

- Spreadsheet 1 ID: `1uWbVwsJ6mgUl9WxJz-zbxMaiCW-dG3DI_9gvKkEca18`
  - CMDB: sheet "Mastersheet Data Base", headers at row 3
  - Energy: sheet "Energy Dashboard", headers at row 1
- Spreadsheet 2 ID: `1bzcG70TopGRRm60NbKX4o3SCE2-QRUDFnY0Z4fYSjEM`
  - COW Movement: sheet "COW Movement tracker", headers at row 1 (2,830 rows)
- Connector: `google-sheet` (Replit integration, connection ID: `conn_google-sheet_01KTTVR5X7VYQKFP26SVVTRXS3`)
- Portable auth: set `GOOGLE_SERVICE_ACCOUNT_JSON` env var (full service account JSON, single line) to bypass Replit connector on any host

## User preferences

_Populate as you build._

## Gotchas

- After changing API routes or env vars, always restart the `artifacts/api-server: API Server` workflow
- After changing the OpenAPI spec, run `pnpm --filter @workspace/api-spec run codegen` before editing frontend files
- Local PostgreSQL (DATABASE_URL) is provisioned by Replit automatically — no manual setup needed
- The migration script (`migrate-bot-users`) is safe to re-run; it uses upsert logic
- Supabase secrets (SUPABASE_SERVICE_ROLE_KEY, etc.) are still present but only used by the migration script — not by the running server

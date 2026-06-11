# COW OPS SYNC

A live-updating ops dashboard that syncs three Google Sheets (CMDB, Energy Dashboard, COW Movement) into Supabase and exposes them through a searchable React dashboard.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at `/api`)
- `pnpm --filter @workspace/sync-dashboard run dev` — run the React dashboard (port 18929, proxied at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (`artifacts/api-server`)
- Frontend: React + Vite + shadcn/ui + Tailwind (`artifacts/sync-dashboard`)
- DB: Supabase PostgreSQL (via `@supabase/supabase-js` over HTTPS)
- Google Sheets: Replit Google Sheets connector (`@replit/connectors-sdk`)
- Validation: Zod (`zod/v4`), generated via Orval from OpenAPI spec
- Build: esbuild (CJS bundle for api-server)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/api-zod/src/generated/api.ts` — generated Zod schemas
- `lib/api-client-react/src/generated/api.ts` — generated React Query hooks
- `artifacts/api-server/src/lib/supabase.ts` — Supabase client (service role)
- `artifacts/api-server/src/lib/sheets.ts` — Google Sheets fetch functions
- `artifacts/api-server/src/lib/sync.ts` — sync logic (upsert to Supabase)
- `artifacts/api-server/src/routes/` — sync, data, stats routes
- `artifacts/sync-dashboard/src/pages/` — Overview, CMDB, Energy, COW Movement, Sync Logs
- `scripts/migrate-supabase.sql` — SQL to create the 4 Supabase tables

## Architecture decisions

- **Supabase via HTTPS only**: Direct PostgreSQL (port 5432) is blocked by Replit's firewall. All DB operations use `@supabase/supabase-js` over HTTPS (PostgREST). Never use `pg` Pool for Supabase.
- **No `@workspace/db`**: This project doesn't use Drizzle ORM — raw supabase-js queries only.
- **Contract-first API**: All routes defined in `lib/api-spec/openapi.yaml` first; run codegen after any change.
- **Supabase table creation**: Tables must be created manually in the Supabase SQL Editor (https://supabase.com/dashboard/project/oawgfzgfufzyebowxlpx/sql/new) using `scripts/migrate-supabase.sql` — the Management API requires a PAT which is not stored here.
- **CMDB/Energy use upsert on conflict**: CMDB conflicts on `cow_id`, Energy on `site`. COW Movement does full delete + re-insert on each sync.

## Product

- Overview dashboard: total COWs, on-air count, per-table row counts, region distribution, sync status per table, "Sync All" button
- CMDB page: searchable/paginated table of 562 COW infrastructure records
- Energy page: searchable/paginated table of 558 fueling/energy records
- COW Movement page: searchable/paginated table of 2,533 movement history records
- Sync Logs page: full audit trail of every sync run with duration, rows synced, errors

## Supabase project

- URL: `https://oawgfzgfufzyebowxlpx.supabase.co`
- Tables: `cmdb`, `energy_dashboard`, `cow_movement`, `sync_log`
- Required secrets: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_PASSWORD` (unused — kept for reference)
- Required env var: `SUPABASE_URL`

## Google Sheets

- Spreadsheet 1 ID: `1uWbVwsJ6mgUl9WxJz-zbxMaiCW-dG3DI_9gvKkEca18`
  - CMDB: sheet "Mastersheet Data Base", headers at row 3
  - Energy: sheet "Energy Dashboard", headers at row 1
- Spreadsheet 2 ID: `1bzcG70TopGRRm60NbKX4o3SCE2-QRUDFnY0Z4fYSjEM`
  - COW Movement: sheet "Movement-Data", headers at row 1
- Connector: `google-sheet` (Replit integration, connection ID: `conn_google-sheet_01KTTVR5X7VYQKFP26SVVTRXS3`)

## User preferences

_Populate as you build._

## Gotchas

- After changing API routes or env vars, always restart the `artifacts/api-server: API Server` workflow
- After changing the OpenAPI spec, run `pnpm --filter @workspace/api-spec run codegen` before editing frontend files
- The supabase-js `count` field returns `null` on error — always use `?? 0` fallback
- Supabase tables must exist before the first sync — see `scripts/migrate-supabase.sql`

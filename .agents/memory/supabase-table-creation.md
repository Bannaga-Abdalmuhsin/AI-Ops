---
name: Supabase DDL / table creation from Replit
description: How to create Supabase tables — the Management API needs a PAT, not available in Replit secrets.
---

The Supabase Management API (`https://api.supabase.com/v1/projects/{ref}/database/query`) requires a **personal access token** (PAT), not the service role key. The service role key only works for the PostgREST data API.

**Rule:** Supabase DDL (CREATE TABLE, ALTER TABLE) must be run manually by the user in the Supabase SQL Editor (`https://supabase.com/dashboard/project/{ref}/sql/new`).

**Why:** No API endpoint is accessible from Replit that accepts the service role key for DDL. The Management API uses a separate PAT from dashboard.supabase.com/account/tokens.

**How to apply:** Save all DDL as a migration SQL file in `scripts/`. When tables are needed, present the SQL to the user and ask them to run it in the Supabase SQL Editor. After they confirm, test tables exist via `supabase.from('table').select('*', {count:'exact', head:true})` — if count is not null and no error, they exist.

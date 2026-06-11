---
name: Supabase connectivity from Replit
description: How to connect to Supabase from Replit — direct pg is blocked, use supabase-js over HTTPS.
---

Direct PostgreSQL connections to Supabase (port 5432) are blocked by Replit's network firewall. The Supabase connection pooler hostname resolves but the TCP connection is also blocked.

**Rule:** Always use `@supabase/supabase-js` (communicates via HTTPS to PostgREST) for all database operations. Never use `pg` Pool or `drizzle-orm` with a `DATABASE_URL` pointing to Supabase.

**Why:** Replit sandboxes block outbound TCP on non-HTTP ports. Only HTTPS (443) works reliably.

**How to apply:** Import `createClient` from `@supabase/supabase-js`, initialize with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. All CRUD via `.from('table').select/insert/upsert/delete`.

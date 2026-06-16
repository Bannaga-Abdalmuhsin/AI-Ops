-- ============================================================
-- STC Cybersecurity Remediation — Security Tables Migration
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/oawgfzgfufzyebowxlpx/sql/new
-- ============================================================

-- ── 1. Bot User Allowlist ─────────────────────────────────────────────────────
-- Stores approved Telegram user IDs, roles, and expiry.
-- Roles: viewer (read-only) | operator (read + sync trigger) | admin (user mgmt)

CREATE TABLE IF NOT EXISTS bot_users (
  id                 BIGSERIAL PRIMARY KEY,
  telegram_user_id   BIGINT NOT NULL UNIQUE,
  username           TEXT,                        -- Telegram @handle (optional)
  role               TEXT NOT NULL DEFAULT 'viewer'
                       CHECK (role IN ('viewer', 'operator', 'admin')),
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  approved_by        BIGINT,                      -- Telegram ID of approving admin
  expires_at         TIMESTAMPTZ,                 -- NULL = never expires
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_users_telegram_id ON bot_users (telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_bot_users_active ON bot_users (active);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bot_users_updated_at ON bot_users;
CREATE TRIGGER bot_users_updated_at
  BEFORE UPDATE ON bot_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2. Bot Audit Log ─────────────────────────────────────────────────────────
-- Permanent record of every bot interaction for compliance/forensics.

CREATE TABLE IF NOT EXISTS bot_audit_log (
  id                 BIGSERIAL PRIMARY KEY,
  telegram_user_id   BIGINT NOT NULL,
  category           TEXT,                        -- 'cmdb' | 'movement'
  query_text         TEXT,                        -- truncated to 500 chars
  response_type      TEXT,                        -- 'fast_path' | 'gpt' | 'error' | 'auth_fail' | 'admin'
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON bot_audit_log (telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON bot_audit_log (created_at DESC);

-- ── 3. Row Level Security ─────────────────────────────────────────────────────
-- Enable RLS on all tables. The service role key bypasses RLS (for sync),
-- while a future anon/restricted key would be blocked by policies.

ALTER TABLE cmdb              ENABLE ROW LEVEL SECURITY;
ALTER TABLE energy_dashboard  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cow_movement      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_audit_log     ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (service role bypasses RLS by default in Supabase,
-- but explicit policies make intent clear and allow future role-based restriction).
-- NOTE: The application uses SUPABASE_SERVICE_ROLE_KEY which bypasses all RLS
-- policies below. These policies apply to the anon key and future restricted keys.

-- Deny all access via anon key (dashboard/bot should use service role or a
-- dedicated read-only role, never the anon key directly)
CREATE POLICY "deny_anon_cmdb"             ON cmdb             FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_energy"           ON energy_dashboard FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_movement"         ON cow_movement     FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_sync_log"         ON sync_log         FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_bot_users"        ON bot_users        FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_audit_log"        ON bot_audit_log    FOR ALL TO anon USING (false);

-- ── 4. Done ───────────────────────────────────────────────────────────────────
-- After running this script, set these secrets in Replit:
--   ADMIN_TELEGRAM_IDS   = comma-separated Telegram user IDs for bootstrap admins
--   TELEGRAM_WEBHOOK_SECRET = random 32-char string (e.g. openssl rand -hex 16)
--   API_SECRET_KEY       = random 32-char string for dashboard ↔ API auth
--   VITE_API_SECRET_KEY  = same value as API_SECRET_KEY (for React dashboard)

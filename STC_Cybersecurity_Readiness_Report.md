# STC Cybersecurity Readiness Report
## ACES MSD — COW OPS SYNC Telegram Bot
**Prepared:** June 16, 2026  
**System:** ACES MSD stc COW Project Telegram Bot + REST API  
**Classification:** CONFIDENTIAL — Internal Use  
**Assessed By:** Security Architecture Review (Automated Code Analysis)

---

## Executive Summary

The ACES MSD Telegram Bot provides AI-assisted access to STC COW telecom operational data (CMDB, COW Movement History, Energy Dashboard) via Telegram. Based on the data it handles and its integration with STC operational systems, this system should be classified under **STC Cybersecurity Framework Tier 2 — Restricted Information System**.

**Overall Readiness: NOT APPROVED FOR PRODUCTION — HIGH RISK**

The assessment identified **5 Critical**, **6 High**, **5 Medium**, and **3 Low** security gaps. The most severe issue is that all REST API endpoints exposing operational infrastructure data are publicly accessible with no authentication.

---

## 1. Applicable STC Cybersecurity Compliance Tier

| Factor | Assessment | Tier Implication |
|---|---|---|
| Data type | Telecom OT-adjacent: COW locations, coordinates, site status, deployment history | Tier 2 – Restricted |
| Telegram integration | Third-party messaging platform outside STC perimeter | Requires DPA, end-to-end audit |
| AI processing (GPT-4o) | Operational data sent to external OpenAI API | Data residency / DLP review required |
| STC system connectivity | Reads live Google Sheets tied to stc COW project | Tier 2 minimum |
| User access | Any Telegram user with shared password | Tier 2 — individual identity required |
| Regulatory scope | NCA CSCC, PDPL (Saudi Arabia), ITU-T X.805 | Full compliance required |

**Required compliance frameworks:**
- NCA Essential Cybersecurity Controls (ECC-1:2018)
- NCA Cloud Cybersecurity Controls (CCC-1:2020)
- STC Internal Information Security Policy
- Saudi PDPL (Personal Data Protection Law) — if any PII is stored
- NIST SP 800-53 (recommended mapping)

---

## 2. Security Gap Assessment

### 2.1 Authentication & Authorization

#### CRITICAL — No API Authentication
**Finding:** All REST API endpoints (`/api/sync/run`, `/api/data/cmdb`, `/api/data/cow-movement`, `/api/data/energy-dashboard`, `/api/stats/overview`, `/api/sync/logs`) have **zero authentication**. Any unauthenticated user on the internet can:
- Read the full CMDB (563 COW site records with GPS coordinates)
- Read full COW movement history (2,830 records)
- Read energy/fueling data for all sites
- Trigger a full database sync operation (`POST /api/sync/run`)

**Evidence (app.ts):**
```typescript
app.use(cors());           // All origins allowed
app.use(express.json());
app.use("/api", router);   // No auth middleware before routes
```

**Risk:** CRITICAL  
**NCA Control:** ECC-2.3 (Access Control)  
**Remediation:** Add API key or Bearer token middleware before all `/api` routes. Minimum: `Authorization: Bearer <API_KEY>` header check. For internal dashboard use, consider mutual TLS or IP allowlist.

---

#### CRITICAL — No Telegram Webhook Signature Verification
**Finding:** The webhook endpoint accepts any POST request without verifying it is legitimately from Telegram. An attacker who discovers the webhook URL can inject fake Telegram messages, impersonate any user ID, and bypass the password gate.

**Evidence (telegram.ts):**
```typescript
telegramRouter.post("/telegram/webhook", async (req: Request, res: Response) => {
  res.sendStatus(200);
  const update = req.body as TelegramBot.Update;
  // No signature check — accepts any POST
  await handleUpdate(update);
});
```

**Risk:** CRITICAL  
**NCA Control:** ECC-2.5 (Communication Security)  
**Remediation:** Register a `secret_token` when calling `setWebhook`. Verify `X-Telegram-Bot-Api-Secret-Token` header on every incoming request before processing.

```typescript
// Required fix
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
telegramRouter.post("/telegram/webhook", (req, res) => {
  if (req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    return res.sendStatus(403);
  }
  // ... proceed
});
```

---

#### CRITICAL — Shared Password Auth (No Individual Identity)
**Finding:** A single `BOT_PASSWORD` environment variable is shared across all users. There is no individual user identity, no username tracking, no way to revoke a specific user's access without changing the password for everyone.

**Evidence (bot.ts line 24–31):**
```typescript
const BOT_PASSWORD = process.env.BOT_PASSWORD ?? "";
const authenticatedUsers = new Set<number>();  // In-memory only — lost on restart
```

**Additional issue:** `authenticatedUsers` is an in-memory `Set`. On every server restart/deployment, all users are logged out but there is no forced re-verification of identity — any Telegram user who knew the password can simply re-enter it.

**Risk:** CRITICAL  
**NCA Control:** ECC-2.3 (Identity & Access Management)  
**Remediation:**
- Implement a user allowlist (whitelist of approved Telegram user IDs stored in Supabase)
- Per-user access tokens with expiry
- Admin command to grant/revoke access per user ID

---

#### HIGH — No Role-Based Access Control (RBAC)
**Finding:** All authenticated users have identical permissions. There is no distinction between:
- Read-only users (view data only)
- Operators (can trigger sync)
- Administrators (manage users, view logs)

The sync trigger endpoints (`POST /api/sync/run`) are unauthenticated (see above), but even for the bot itself, any authenticated user can query any data category.

**Risk:** HIGH  
**NCA Control:** ECC-2.3.2 (Least Privilege)  
**Remediation:** Define roles (viewer / operator / admin). Store role per user ID in Supabase. Enforce in bot command handlers and API middleware.

---

#### HIGH — Supabase Service Role Key Used Everywhere
**Finding:** The application uses `SUPABASE_SERVICE_ROLE_KEY` for all database operations. This key bypasses all Row Level Security (RLS) policies and has full read/write/delete access to every table.

**Evidence (supabase.ts):**
```typescript
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});
```

**Risk:** HIGH  
**NCA Control:** ECC-2.3.3 (Database Access Control)  
**Remediation:**
- Create a read-only Supabase role/key for the bot and dashboard (SELECT only)
- Keep service role key only in the sync module that writes to Supabase
- Enable RLS policies on all tables

---

### 2.2 API Security

#### CRITICAL — Open CORS Policy
**Finding:** CORS is configured with no restrictions — any origin can make cross-origin requests to all API endpoints.

**Evidence (app.ts line 28):**
```typescript
app.use(cors());  // Allows ALL origins
```

**Risk:** CRITICAL  
**NCA Control:** ECC-2.5 (Web Application Security)  
**Remediation:**
```typescript
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(",") ?? [],
  methods: ["GET", "POST"],
}));
```

---

#### HIGH — No Rate Limiting
**Finding:** No rate limiting on any endpoint. An attacker can:
- Spam the OpenAI API via the bot (cost amplification attack)
- Flood the Supabase database with read queries
- Brute-force the bot password via repeated Telegram messages

**Risk:** HIGH  
**NCA Control:** ECC-2.6 (DoS Protection)  
**Remediation:** Add `express-rate-limit` middleware. Recommended limits:
- Bot messages per user: 20/minute
- API endpoints: 100/minute per IP
- Sync trigger: 5/hour globally

---

#### MEDIUM — No HTTP Security Headers (Missing Helmet.js)
**Finding:** No security headers are set: no `Content-Security-Policy`, no `X-Frame-Options`, no `X-Content-Type-Options`, no `Strict-Transport-Security`.

**Risk:** MEDIUM  
**NCA Control:** ECC-2.5  
**Remediation:** Add `helmet` middleware: `app.use(helmet())`.

---

#### MEDIUM — No Request Size Limit
**Finding:** No body size cap. A malicious large JSON payload can cause memory exhaustion.

**Risk:** MEDIUM  
**Remediation:** `app.use(express.json({ limit: "1mb" }))`.

---

### 2.3 Secrets & Token Management

#### MEDIUM — No Secret Rotation Mechanism
**Finding:** Secrets (`TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `BOT_PASSWORD`) are static with no rotation schedule or expiry. If any secret is compromised, there is no automated detection or rotation capability.

**Risk:** MEDIUM  
**NCA Control:** ECC-3.1 (Cryptographic Key Management)  
**Remediation:**
- Document rotation schedule: quarterly minimum for API keys
- Set up Supabase key rotation notification
- Consider Vault or AWS Secrets Manager for production

---

#### LOW — SUPABASE_DB_PASSWORD Stored but Unused
**Finding:** `SUPABASE_DB_PASSWORD` is stored as a secret per `replit.md` ("unused — kept for reference"). Storing unnecessary credentials increases the blast radius of a secret leak.

**Risk:** LOW  
**Remediation:** Remove unused secrets from the environment.

---

### 2.4 Encryption

| Control | Status | Detail |
|---|---|---|
| Data in transit (API ↔ client) | ✅ PASS | Replit proxy enforces HTTPS/TLS 1.3 |
| Data in transit (API ↔ Supabase) | ✅ PASS | Supabase HTTPS only (port 5432 blocked) |
| Data in transit (API ↔ OpenAI) | ⚠️ CONCERN | Operational data leaves STC boundary — see Section 2.6 |
| Data in transit (Telegram) | ⚠️ PARTIAL | Telegram uses MTProto but data passes through Telegram servers |
| Data at rest (Supabase) | ✅ PASS | Supabase AES-256 encryption at rest |
| Data at rest (Google Sheets) | ✅ PASS | Google workspace encryption |
| Application secrets | ✅ PASS | Stored in Replit Secrets (not in code) |

---

### 2.5 Logging & Audit Trail

#### MEDIUM — No User Action Audit Trail
**Finding:** The system logs HTTP requests and errors via pino, but there is no queryable audit trail recording **who queried what data**. The logger redacts auth headers correctly, but:
- User queries sent to OpenAI are not retained
- There is no per-user query history
- Sync operations are logged to `sync_log` table (✅ good) but no bot-query audit exists

**Evidence (telegram.ts line 13):**
```typescript
req.log.info({ userId, msgText }, "Telegram webhook update received");
// This logs to server stdout only — not persisted in Supabase
```

**Risk:** MEDIUM  
**NCA Control:** ECC-3.3 (Logging & Monitoring)  
**Remediation:** Create a `bot_audit_log` table in Supabase:
```sql
CREATE TABLE bot_audit_log (
  id BIGSERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  query_text TEXT NOT NULL,
  category TEXT,
  response_type TEXT,  -- 'fast_path' | 'gpt' | 'error'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

#### LOW — Message Content Logged to Stdout
**Finding:** `msgText` (the user's full Telegram message) is logged at INFO level to server stdout. Depending on log aggregation, this could expose operational query content in log management systems.

**Risk:** LOW  
**NCA Control:** ECC-3.3 (Data Minimization in Logs)  
**Remediation:** Truncate or hash msgText in logs, or log only the first 20 characters.

---

### 2.6 Data Residency & AI Processing (OpenAI)

#### HIGH — Operational Data Sent to External AI Service
**Finding:** The bot sends CMDB and COW Movement data — including site labels, GPS coordinates, location names, and deployment history — to OpenAI's GPT-4o API. This data leaves the STC/Saudi Arabia boundary.

**Evidence (bot.ts):**
```typescript
const openai = new OpenAI({ apiKey: openaiKey });
// ... rows from Supabase are serialized into the GPT prompt
const aiResp = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: `${tableContext}\n\nQuestion: ${query}` }],
});
```

**Data sent includes:** cow_id, location, site_status, region, latitude, longitude, deployment dates, movement_type, vendor names.

**Risk:** HIGH  
**NCA Control:** NCA CCC-1:2020 Section 3 (Cloud Data Residency), Saudi PDPL  
**Assessment:** Depending on STC's data classification policy, COW site GPS coordinates and operational status may be **Restricted** data that cannot be sent to non-approved third-party cloud services.

**Remediation Options (choose one):**
1. **Data minimization:** Strip coordinates and vendor names before sending to OpenAI. Send only aggregated/anonymized data.
2. **Azure OpenAI Service:** Deploy on Azure (Riyadh region) which keeps data within Saudi Arabia and provides enterprise data processing agreements.
3. **On-premises LLM:** Replace GPT-4o with an on-premises model (e.g., Llama 3 on internal STC infrastructure).
4. **Formal DPA:** Obtain a Data Processing Agreement with OpenAI that meets NCA and STC requirements before production go-live.

---

### 2.7 Vulnerability Protection

| Control | Status | Notes |
|---|---|---|
| Dependency audit | ⚠️ NOT RUN | No `pnpm audit` in CI pipeline |
| Prompt injection protection | ❌ MISSING | User input passed directly to GPT with operational data in context |
| SQL/NoSQL injection | ✅ PASS | Supabase-js uses parameterized queries; Zod validates all route inputs |
| XSS | N/A | No HTML rendering in API |
| SSRF | ⚠️ LOW RISK | QuickChart.io URL built from aggregated data; no user-controlled URL fetch |
| Container hardening | ✅ PARTIAL | Replit managed runtime |

#### HIGH — Prompt Injection Not Mitigated
**Finding:** User-supplied Telegram messages are embedded directly into the OpenAI system prompt alongside operational data. A malicious user could craft a query to:
- Override the system prompt and extract all data
- Make the bot respond in unexpected ways
- Attempt to exfiltrate data by framing questions as instructions

**Evidence (bot.ts):**
```typescript
messages: [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: `${tableContext}\n\nQuestion: ${query}` }
]
// tableContext contains raw Supabase rows — user controls 'query'
```

**Risk:** HIGH  
**Remediation:**
- Add a strict system prompt preamble that cannot be overridden
- Validate/sanitize the query for injection patterns before sending to GPT
- Limit GPT response format to structured JSON only (easier to validate)
- Separate the data context from the user query message

---

## 3. Findings Summary

| ID | Domain | Finding | Risk | Status |
|---|---|---|---|---|
| A-01 | Auth | No API authentication on any REST endpoint | **CRITICAL** | ❌ Not Implemented |
| A-02 | Auth | No Telegram webhook signature verification | **CRITICAL** | ❌ Not Implemented |
| A-03 | Auth | Shared password, no individual user identity | **CRITICAL** | ❌ Partial (password exists) |
| A-04 | Auth | No RBAC | **HIGH** | ❌ Not Implemented |
| A-05 | Auth | Service role key used for all DB operations | **HIGH** | ❌ Gap |
| B-01 | API | Open CORS — all origins allowed | **CRITICAL** | ❌ Not Implemented |
| B-02 | API | No rate limiting | **HIGH** | ❌ Not Implemented |
| B-03 | API | No HTTP security headers | **MEDIUM** | ❌ Not Implemented |
| B-04 | API | No request size limit | **MEDIUM** | ❌ Not Implemented |
| C-01 | Secrets | No secret rotation mechanism | **MEDIUM** | ❌ Not Implemented |
| C-02 | Secrets | Unused credential stored in env | **LOW** | ⚠️ Minor |
| D-01 | Data/AI | Operational data sent to external OpenAI API | **HIGH** | ⚠️ Requires DPA |
| E-01 | Vuln | Prompt injection not mitigated | **HIGH** | ❌ Not Implemented |
| E-02 | Audit | No persistent bot query audit trail | **MEDIUM** | ❌ Not Implemented |
| E-03 | Audit | Full message content logged to stdout | **LOW** | ⚠️ Minor |
| E-04 | Vuln | No dependency vulnerability scanning in CI | **LOW** | ❌ Not Implemented |

**Totals: 5 Critical | 6 High | 5 Medium | 3 Low**

---

## 4. STC Cybersecurity Readiness Report

### 4.1 Minimum Security Level Required for Approval

This system must meet **NCA ECC-1:2018 Tier 2 (Restricted)** before production approval because:
- It contains telecom infrastructure data (COW sites, GPS, site status)
- It integrates with third-party platforms (Telegram, OpenAI, Google)
- It is internet-accessible from any global IP

**Gate criteria — all must be met before production approval:**

| Gate | Requirement | Current |
|---|---|---|
| G-01 | API authentication on all routes | ❌ |
| G-02 | Telegram webhook signature verification | ❌ |
| G-03 | Individual user identity (no shared password) | ❌ |
| G-04 | CORS restricted to approved origins | ❌ |
| G-05 | Formal DPA with OpenAI OR data stripped before GPT | ❌ |
| G-06 | Rate limiting on bot and API | ❌ |
| G-07 | Prompt injection mitigation | ❌ |

### 4.2 Missing Controls (Prioritized Remediation Roadmap)

**Sprint 1 — Must fix before any production use (1–2 weeks)**

1. **Add webhook secret verification** — 1 hour of work
   - Generate `TELEGRAM_WEBHOOK_SECRET`, pass to `setWebhook`, verify header
2. **Restrict CORS** — 30 minutes
   - Set `ALLOWED_ORIGINS` env var to dashboard domain only
3. **Add API Bearer token** — 2–4 hours
   - Add `API_SECRET_KEY` env var; add middleware to all `/api` routes
   - Update dashboard to send `Authorization: Bearer` header
4. **Replace service role key with read-only key for bot** — 2 hours
   - Create Supabase read-only role; new anon/restricted key for data reads
   - Keep service role key only in sync module

**Sprint 2 — Required for Tier 2 compliance (2–4 weeks)**

5. **User allowlist with Telegram user IDs** — 1 day
   - Create `allowed_users` table; admin command to add/remove users
6. **Rate limiting** — 4 hours (`express-rate-limit`)
7. **Prompt injection hardening** — 1 day
   - Strict system prompt format; query length limit; instruction-injection pattern detection
8. **OpenAI data residency** — 2–5 days
   - Switch to Azure OpenAI (Riyadh region) OR strip sensitive fields before GPT
9. **HTTP security headers** — 1 hour (`helmet`)
10. **Bot audit log table** — 4 hours

**Sprint 3 — Full Tier 2 certification**

11. RBAC (viewer / operator / admin roles)
12. Secret rotation schedule and documentation
13. Dependency vulnerability scanning (`pnpm audit`) in CI
14. Penetration testing by STC-approved vendor
15. Formal data classification of CMDB/Energy/COW Movement datasets

### 4.3 Required Architecture Changes

```
Current:
  Telegram → webhook (unverified) → Express → Supabase (service role)
                                            ↘ OpenAI (raw data)
  Browser → /api/* (no auth) → Express → Supabase (service role)

Required:
  Telegram → webhook (verified + rate limited) → Auth gate (user allowlist)
                                               → Express → Supabase (read-only role)
                                               → OpenAI (data stripped / Azure region)

  Browser → /api/* → Bearer token middleware → Express → Supabase (read-only role)
  Admin    → /api/sync/* → Admin token middleware → Supabase (service role only here)
```

### 4.4 Evidence and Documents Required for STC Review

The following must be provided for formal STC cybersecurity approval:

| # | Document | Owner | Status |
|---|---|---|---|
| 1 | Data Classification Register (CMDB, Energy, COW Movement) | System Owner | ❌ Missing |
| 2 | Data Flow Diagram (DFD) — all data in/out of the system | Architect | ❌ Missing |
| 3 | Data Processing Agreement (DPA) with OpenAI or proof of data residency | Legal/IT | ❌ Missing |
| 4 | Data Processing Agreement (DPA) with Telegram | Legal/IT | ❌ Missing |
| 5 | Supabase SOC 2 Type II report (available from Supabase) | Vendor | ⚠️ Obtain |
| 6 | Penetration test report (by NCA-accredited vendor) | IT Security | ❌ Missing |
| 7 | Access Control Matrix (who can do what) | System Owner | ❌ Missing |
| 8 | Secret Management Procedure (rotation schedule) | Ops | ❌ Missing |
| 9 | Incident Response Plan for bot data breach | IT Security | ❌ Missing |
| 10 | NCA ECC-1:2018 compliance checklist (self-assessment) | IT Security | ❌ Missing |

---

## 5. What Is Working Correctly

The following controls are **already in place** and should be documented as evidence of baseline security practices:

- ✅ All secrets stored in environment variables — never hardcoded in source
- ✅ Supabase accessed via HTTPS only (direct PostgreSQL port blocked)
- ✅ Zod input validation on all API routes — prevents malformed inputs
- ✅ pino logger with `Authorization` and `Cookie` header redaction
- ✅ Parameterized queries via Supabase-js (injection-safe)
- ✅ Bot password gate present (partial protection)
- ✅ Auth gate applied to both message and callback_query handlers
- ✅ Sync audit log written to `sync_log` table in Supabase
- ✅ TypeScript strict mode (reduces class of runtime errors)
- ✅ Webhook uses POST-only — no polling in production

---

*End of Report*  
*This report is based on static code analysis of the production codebase as of June 16, 2026.*  
*It does not substitute for a formal penetration test or NCA-accredited security audit.*

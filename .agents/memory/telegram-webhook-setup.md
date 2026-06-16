---
name: Telegram webhook setup
description: How the Telegram bot webhook is registered in production and common failure modes.
---

# Telegram webhook setup

## Production domain
`sheet-sync-bannagaaltieb1.replit.app`  
Webhook URL: `https://sheet-sync-bannagaaltieb1.replit.app/api/telegram/webhook`

## How registration works
`setupBot()` in `artifacts/api-server/src/lib/bot.ts` is called on server startup (in `index.ts`).  
It only runs when `NODE_ENV=production`. It reads the domain from:
1. `TELEGRAM_WEBHOOK_DOMAIN` env var (primary — set as a shared env var)
2. `REPLIT_DOMAINS` runtime var (fallback — not reliably injected in prod containers)

## Secret token constraints
Telegram `secret_token` only allows: `A-Z a-z 0-9 _ -`  
Base64 output (`+`, `/`, `=`) will cause `400 Bad Request: secret token contains unallowed characters`.  
Always generate with `openssl rand -hex 32` (hex only).

## Manual re-registration (after secret change or domain change)
```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://sheet-sync-bannagaaltieb1.replit.app/api/telegram/webhook","secret_token":"<hex_secret>","allowed_updates":["message","callback_query"]}'
```

## Verification
```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```
`url` should be non-empty and `last_error_message` should be absent.

**Why:** REPLIT_DOMAINS in the production container may not be injected, causing setupBot to silently skip registration. TELEGRAM_WEBHOOK_DOMAIN env var was added as a reliable alternative.

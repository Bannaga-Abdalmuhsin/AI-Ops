import cron from "node-cron";
import app from "./app";
import { logger } from "./lib/logger";
import { setupBot } from "./lib/bot";
import { runFullSync, syncRunning } from "./lib/sync";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Scheduled auto-sync ─────────────────────────────────────────────────────
// Default: every 2 hours. Override with SYNC_CRON_SCHEDULE env var.
// Uses standard cron syntax: minute hour day-of-month month day-of-week
// Examples: "0 */2 * * *" = every 2 hours | "0 */6 * * *" = every 6 hours
const SYNC_SCHEDULE = process.env.SYNC_CRON_SCHEDULE ?? "0 */2 * * *";

function scheduleAutoSync(): void {
  if (!cron.validate(SYNC_SCHEDULE)) {
    logger.error({ schedule: SYNC_SCHEDULE }, "Invalid SYNC_CRON_SCHEDULE — auto-sync disabled");
    return;
  }

  cron.schedule(SYNC_SCHEDULE, async () => {
    if (syncRunning) {
      logger.warn("Auto-sync skipped — a sync is already in progress");
      return;
    }
    logger.info({ schedule: SYNC_SCHEDULE }, "Auto-sync starting (scheduled)");
    try {
      const results = await runFullSync();
      const totalRows = results.reduce((n, r) => n + r.rows_synced, 0);
      const failed = results.filter(r => !r.success);
      if (failed.length === 0) {
        logger.info({ totalRows, tables: results.map(r => r.table_name) }, "Auto-sync completed successfully");
      } else {
        logger.error({ failed: failed.map(r => ({ table: r.table_name, error: r.error })) }, "Auto-sync completed with errors");
      }
    } catch (err) {
      logger.error({ err }, "Auto-sync failed unexpectedly");
    }
  }, { timezone: "UTC" });

  logger.info({ schedule: SYNC_SCHEDULE }, "Auto-sync scheduled");
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  scheduleAutoSync();

  // In production, TELEGRAM_WEBHOOK_DOMAIN is the canonical source (set as a
  // shared env var to the deployed .replit.app domain). REPLIT_DOMAINS is a
  // runtime-managed fallback that Replit may or may not inject.
  const domain =
    process.env.TELEGRAM_WEBHOOK_DOMAIN?.trim() ||
    process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();

  setupBot(domain).catch((e) =>
    logger.error({ e }, "Telegram bot setup failed")
  );
});

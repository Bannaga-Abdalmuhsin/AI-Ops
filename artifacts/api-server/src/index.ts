import app from "./app";
import { logger } from "./lib/logger";
import { setupWebhook } from "./lib/bot";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // In production REPLIT_DOMAINS holds the public .replit.app domain.
  // In development fall back to REPLIT_DEV_DOMAIN.
  const domain =
    process.env.REPLIT_DOMAINS?.split(",")[0]?.trim() ??
    process.env.REPLIT_DEV_DOMAIN;

  if (domain) {
    setupWebhook(domain).catch((e) =>
      logger.error({ e }, "Webhook setup failed")
    );
  } else {
    logger.warn(
      "No domain available (REPLIT_DOMAINS / REPLIT_DEV_DOMAIN) — Telegram webhook not registered"
    );
  }
});

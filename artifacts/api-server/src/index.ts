import app from "./app";
import { logger } from "./lib/logger";
import { setupBot } from "./lib/bot";

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

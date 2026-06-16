import { Router } from "express";
import type { Request, Response } from "express";
import { bot, handleUpdate } from "../lib/bot.js";
import TelegramBot from "node-telegram-bot-api";

const telegramRouter = Router();

telegramRouter.post("/telegram/webhook", async (req: Request, res: Response) => {
  // ── Telegram webhook secret verification ─────────────────────────────────
  // Telegram passes the secret_token set during setWebhook in this header.
  // Reject any request that does not carry the correct value.
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    const provided = req.headers["x-telegram-bot-api-secret-token"];
    if (provided !== webhookSecret) {
      req.log.warn(
        { hasHeader: !!provided, ip: req.ip },
        "Webhook request rejected — invalid secret token",
      );
      res.sendStatus(403);
      return;
    }
  } else {
    req.log.warn("TELEGRAM_WEBHOOK_SECRET not set — webhook requests are unverified");
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Respond immediately so Telegram does not retry
  res.sendStatus(200);

  const update = req.body as TelegramBot.Update;
  const msgText =
    update.message?.text ?? update.callback_query?.data ?? "(non-text)";
  const userId =
    update.message?.from?.id ?? update.callback_query?.from?.id ?? 0;
  req.log.info({ userId, msgText: msgText.slice(0, 60) }, "Telegram webhook received");

  await handleUpdate(update);
});

export default telegramRouter;

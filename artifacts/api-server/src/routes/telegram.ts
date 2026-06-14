import { Router } from "express";
import type { Request, Response } from "express";
import { bot, handleUpdate } from "../lib/bot.js";
import TelegramBot from "node-telegram-bot-api";

const telegramRouter = Router();

telegramRouter.post("/telegram/webhook", async (req: Request, res: Response) => {
  res.sendStatus(200);
  const update = req.body as TelegramBot.Update;
  const msgText = update.message?.text ?? update.callback_query?.data ?? "(non-text)";
  const userId = update.message?.from?.id ?? update.callback_query?.from?.id ?? 0;
  req.log.info({ userId, msgText }, "Telegram webhook update received");
  await handleUpdate(update);
});

export default telegramRouter;

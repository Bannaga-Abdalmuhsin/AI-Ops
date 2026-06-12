import { Router } from "express";
import type { Request, Response } from "express";
import { bot, handleUpdate } from "../lib/bot.js";
import TelegramBot from "node-telegram-bot-api";

const telegramRouter = Router();

telegramRouter.post("/telegram/webhook", async (req: Request, res: Response) => {
  res.sendStatus(200);
  const update = req.body as TelegramBot.Update;
  await handleUpdate(update);
});

export default telegramRouter;

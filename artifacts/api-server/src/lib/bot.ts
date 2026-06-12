import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const openaiKey = process.env.OPENAI_API_KEY;

if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
if (!openaiKey) throw new Error("OPENAI_API_KEY is required");

export const bot = new TelegramBot(token);

const openai = new OpenAI({ apiKey: openaiKey });

type Category = "cmdb" | "fuel" | "movement";

interface UserSession {
  category: Category;
}

const sessions = new Map<number, UserSession>();

const GREETING = `Hi 👋 I'm *ACES MSD* — stc COW Project Assistant.

Select a database to query:`;

const CATEGORY_LABELS: Record<Category, string> = {
  cmdb: "📋 CMDB",
  fuel: "⛽ Fueling Status",
  movement: "🚛 COW Movement History",
};

const MAIN_KEYBOARD: TelegramBot.InlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: "📋 CMDB", callback_data: "cmdb" },
      { text: "⛽ Fueling Status", callback_data: "fuel" },
      { text: "🚛 COW Movement", callback_data: "movement" },
    ],
  ],
};

export async function handleUpdate(update: TelegramBot.Update): Promise<void> {
  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message);
    }
  } catch (err) {
    logger.error({ err }, "Error handling Telegram update");
  }
}

async function handleMessage(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const userId = msg.from?.id ?? chatId;
  const text = (msg.text ?? "").trim();

  const session = sessions.get(userId);

  if (session && text.length > 0) {
    await answerQuery(chatId, userId, text, session.category);
    return;
  }

  await bot.sendMessage(chatId, GREETING, {
    parse_mode: "Markdown",
    reply_markup: MAIN_KEYBOARD,
  });
}

async function handleCallbackQuery(
  query: TelegramBot.CallbackQuery
): Promise<void> {
  const chatId = query.message?.chat.id;
  const userId = query.from.id;
  const category = query.data as Category;

  await bot.answerCallbackQuery(query.id);

  if (!chatId || !["cmdb", "fuel", "movement"].includes(category)) return;

  sessions.set(userId, { category });

  const label = CATEGORY_LABELS[category];

  const examples: Record<Category, string> = {
    cmdb: "Examples:\n• `COW001 current location`\n• `COW001 status`\n• `COW001 vendor and technology`\n• `COW001 deployment date`",
    fuel: "Examples:\n• `COW001 fuel level`\n• `COW001 last fueling date`\n• `COW001 next fueling plan`\n• `COW001 power source`",
    movement: "Examples:\n• `COW001 movement history`\n• `CWN104 last 3 movements`\n• `COW001 where was it moved from`",
  };

  await bot.sendMessage(
    chatId,
    `✅ You selected *${label}*.\n\nPlease type the COW site ID and what you'd like to know.\n\n${examples[category]}`,
    { parse_mode: "Markdown" }
  );
}

async function answerQuery(
  chatId: number,
  userId: number,
  query: string,
  category: Category
): Promise<void> {
  sessions.delete(userId);

  const cowMatch = query.match(/\b(COW\d+|CWN\d+)\b/i);
  const cowId = cowMatch?.[0]?.toUpperCase();

  await bot.sendChatAction(chatId, "typing");

  let data: Record<string, unknown>[] = [];
  let tableContext = "";

  try {
    if (category === "cmdb") {
      const base = supabase.from("cmdb").select("*");
      const { data: rows } = await (cowId
        ? base.eq("cow_id", cowId).limit(5)
        : base.limit(20));
      data = rows ?? [];
      tableContext =
        "CMDB infrastructure data. Fields: cow_id, site_label, region, district, city, location, site_status, vendor, technology, latitude, longitude, first_deploying_date, last_deploying_date.";
    } else if (category === "fuel") {
      const base = supabase.from("energy_dashboard").select("*");
      const { data: rows } = await (cowId
        ? base.eq("site", cowId).limit(5)
        : base.limit(20));
      data = rows ?? [];
      tableContext =
        "Fueling and energy data. The COW ID is in the 'site' field. Fields: site, cow_status, region_name, fuel_tank_level_pct, last_fueling_date, last_fueling_qty, next_fueling_plan, tank_capacity, power_source, total_on_air_days.";
    } else {
      const base = supabase
        .from("cow_movement")
        .select("*")
        .order("moved_date", { ascending: false });
      const { data: rows } = await (cowId
        ? base.eq("cow_id", cowId).limit(10)
        : base.limit(20));
      data = rows ?? [];
      tableContext =
        "COW movement history. Fields: cow_id, site_label, moved_date, from_location, to_location, movement_type, distance_km, region_from, region_to, vendor.";
    }
  } catch (err) {
    logger.error({ err }, "Supabase query error");
  }

  if (data.length === 0) {
    await bot.sendMessage(
      chatId,
      cowId
        ? `❌ No records found for *${cowId}* in the ${CATEGORY_LABELS[category]} database.\n\nPlease check the site ID and try again.`
        : `❌ No matching records found. Please include a COW site ID (e.g. *COW001* or *CWN104*) in your query.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  let answer = "";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are ACES MSD — the stc COW Project Assistant.
Answer ONLY what the user asked. Be concise and precise.
Use emoji section headers to format your answer clearly.
You have been given ${tableContext}
Format all dates as DD-MMM-YYYY.
For fuel_tank_level_pct below 20% add ⚠️ LOW after the value. Below 10% add 🔴 CRITICAL.
Never mention Supabase, APIs, N8N, or any technical tools.
Reply in English only.`,
        },
        {
          role: "user",
          content: `Database records:\n${JSON.stringify(data, null, 2)}\n\nUser question: ${query}`,
        },
      ],
      max_tokens: 600,
    });
    answer =
      completion.choices[0]?.message?.content ?? "No response generated.";
  } catch (err) {
    logger.error({ err }, "OpenAI call error");
    answer = "⚠️ Could not generate a response. Please try again.";
  }

  await bot.sendMessage(chatId, answer, { parse_mode: "Markdown" });
}

export async function setupWebhook(domain: string): Promise<void> {
  const webhookUrl = `https://${domain}/api/telegram/webhook`;
  try {
    await bot.setWebHook(webhookUrl);
    logger.info({ webhookUrl }, "Telegram webhook registered");
  } catch (err) {
    logger.error({ err }, "Failed to set Telegram webhook");
  }
}

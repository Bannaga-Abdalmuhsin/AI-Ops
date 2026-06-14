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

type Category = "cmdb" | "movement";

interface UserSession {
  category: Category;
}

const sessions = new Map<number, UserSession>();

const GREETING = `Hi 👋 I'm *ACES MSD* — stc COW Project Assistant.

Select a database to query:`;

const CATEGORY_LABELS: Record<Category, string> = {
  cmdb: "📋 CMDB",
  movement: "🚛 COW Movement History",
};

const MAIN_KEYBOARD: TelegramBot.InlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: "📋 CMDB", callback_data: "cmdb" },
      { text: "🚛 COW Movement", callback_data: "movement" },
    ],
  ],
};

function continueKeyboard(category: Category): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: `🔄 Next question (${CATEGORY_LABELS[category]})`, callback_data: "continue" },
        { text: "🏠 Select another database", callback_data: "main_menu" },
      ],
    ],
  };
}

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
  const data = query.data;

  await bot.answerCallbackQuery(query.id);

  if (!chatId) return;

  // Handle navigation actions
  if (data === "main_menu") {
    sessions.delete(userId);
    await bot.sendMessage(chatId, GREETING, {
      parse_mode: "Markdown",
      reply_markup: MAIN_KEYBOARD,
    });
    return;
  }

  if (data === "continue") {
    const session = sessions.get(userId);
    if (!session) {
      await bot.sendMessage(chatId, GREETING, {
        parse_mode: "Markdown",
        reply_markup: MAIN_KEYBOARD,
      });
      return;
    }
    const label = CATEGORY_LABELS[session.category];
    await bot.sendMessage(
      chatId,
      `📂 *${label}* — go ahead, type your next question:`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  // Handle category selection
  const category = data as Category;
  if (!["cmdb", "movement"].includes(category)) return;

  sessions.set(userId, { category });

  const label = CATEGORY_LABELS[category];

  const examples: Record<Category, string> = {
    cmdb: "Examples:\n• `COW001 current location`\n• `COW001 status`\n• `COW001 vendor and technology`\n• `COW001 deployment date`\n• `how many on-air in Central region`",
    movement: "Examples:\n• `COW001 movement history`\n• `CWN104 last 3 movements`\n• `COW001 where was it moved from`\n• `how many movements in Western region`",
  };

  await bot.sendMessage(
    chatId,
    `✅ You selected *${label}*.\n\nPlease type the COW site ID and what you'd like to know.\n\n${examples[category]}`,
    { parse_mode: "Markdown" }
  );
}

// Extract region and status keywords from free-text queries for aggregate filtering.
function extractTextFilters(q: string): { region?: string; status?: string } {
  const lower = q.toLowerCase();

  const REGIONS = [
    "central", "western", "eastern", "northern", "southern",
    "riyadh", "makkah", "madinah", "medina", "jeddah",
    "tabuk", "qassim", "hail", "najran", "jizan", "asir", "baha",
  ];
  const region = REGIONS.find((r) => lower.includes(r));

  let status: string | undefined;
  if (lower.match(/on[\s-]?air/)) status = "On-Air";
  else if (lower.match(/off[\s-]?air/)) status = "Off-Air";

  return { region, status };
}

// Build a concise data payload for GPT: all rows when small, count + sample when large.
function buildDataPayload(
  rows: Record<string, unknown>[]
): { payload: string; totalCount: number } {
  const totalCount = rows.length;
  if (totalCount <= 50) {
    return { payload: JSON.stringify(rows, null, 2), totalCount };
  }
  const sample = rows.slice(0, 30);
  return {
    payload: `Total matching records: ${totalCount}\n\nSample (first 30 of ${totalCount}):\n${JSON.stringify(sample, null, 2)}`,
    totalCount,
  };
}

async function answerQuery(
  chatId: number,
  userId: number,
  query: string,
  category: Category
): Promise<void> {
  const cowMatch = query.match(/\b(COW\d+|CWN\d+)\b/i);
  const cowId = cowMatch?.[0]?.toUpperCase();

  await bot.sendChatAction(chatId, "typing");

  let data: Record<string, unknown>[] = [];
  let tableContext = "";

  try {
    if (category === "cmdb") {
      let q = supabase.from("cmdb").select("*");
      if (cowId) {
        q = q.eq("cow_id", cowId).limit(10) as typeof q;
      } else {
        const { region, status } = extractTextFilters(query);
        if (region) q = q.ilike("region", `%${region}%`) as typeof q;
        if (status) q = q.ilike("site_status", `%${status}%`) as typeof q;
        q = q.limit(1000) as typeof q;
      }
      const { data: rows } = await q;
      data = rows ?? [];
      tableContext =
        "CMDB infrastructure data. Fields: cow_id, site_label, region, district, city, location, site_status, vendor, technology, latitude, longitude, first_deploying_date, last_deploying_date.";
    } else {
      let q = supabase
        .from("cow_movement")
        .select("*")
        .order("moved_date", { ascending: false });
      if (cowId) {
        q = q.eq("cow_id", cowId).limit(10) as typeof q;
      } else {
        const { region } = extractTextFilters(query);
        if (region) {
          q = q.or(
            `region_from.ilike.%${region}%,region_to.ilike.%${region}%`
          ) as typeof q;
        }
        q = q.limit(500) as typeof q;
      }
      const { data: rows } = await q;
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
        : `❌ No matching records found. Try rephrasing or check the filters (region, status, etc.).`,
      { parse_mode: "Markdown", reply_markup: continueKeyboard(category) }
    );
    return;
  }

  const { payload: dataPayload, totalCount } = buildDataPayload(data);

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
The dataset provided already reflects any region/status filters applied.
When the user asks for a count, use the "Total matching records" number if provided — do NOT recount the sample.
Format all dates as DD-MMM-YYYY.
Never mention Supabase, APIs, N8N, or any technical tools.
Reply in English only.`,
        },
        {
          role: "user",
          content: `Database records (total fetched: ${totalCount}):\n${dataPayload}\n\nUser question: ${query}`,
        },
      ],
      max_tokens: 800,
    });
    answer =
      completion.choices[0]?.message?.content ?? "No response generated.";
  } catch (err) {
    logger.error({ err }, "OpenAI call error");
    answer = "⚠️ Could not generate a response. Please try again.";
  }

  await bot.sendMessage(chatId, answer, {
    parse_mode: "Markdown",
    reply_markup: continueKeyboard(category),
  });
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

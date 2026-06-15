import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import {
  type Movement,
  analyzeWarehouseIdle,
  getWarehouseAgingBuckets,
  getTopDestinations,
  getNeverMovedCows,
} from "./movement-analytics.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const openaiKey = process.env.OPENAI_API_KEY;

if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
if (!openaiKey) throw new Error("OPENAI_API_KEY is required");

export const bot = new TelegramBot(token, { polling: false });

const openai = new OpenAI({ apiKey: openaiKey });

// --- Access control ---------------------------------------------------------
const BOT_PASSWORD = process.env.BOT_PASSWORD ?? "";
if (!BOT_PASSWORD) {
  logger.warn("BOT_PASSWORD not set — bot is unprotected");
}

// Users who have successfully entered the password this server session.
const authenticatedUsers = new Set<number>();
// ---------------------------------------------------------------------------

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

  // ── Auth gate ──────────────────────────────────────────────────────────
  if (!authenticatedUsers.has(userId)) {
    if (BOT_PASSWORD && text === BOT_PASSWORD) {
      authenticatedUsers.add(userId);
      await bot.sendMessage(
        chatId,
        `✅ *Access granted!* Welcome to ACES MSD.\n\n${GREETING}`,
        { parse_mode: "Markdown", reply_markup: MAIN_KEYBOARD }
      );
    } else {
      const wrongAttempt = text.length > 0;
      await bot.sendMessage(
        chatId,
        wrongAttempt
          ? "❌ *Incorrect password.* Please try again:"
          : "🔒 *This bot is protected.*\n\nPlease enter the access password to continue:",
        { parse_mode: "Markdown" }
      );
    }
    return;
  }
  // ──────────────────────────────────────────────────────────────────────

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

  // ── Auth gate ──────────────────────────────────────────────────────────
  if (!authenticatedUsers.has(userId)) {
    await bot.sendMessage(
      chatId,
      "🔒 *This bot is protected.*\n\nPlease enter the access password to continue:",
      { parse_mode: "Markdown" }
    );
    return;
  }
  // ──────────────────────────────────────────────────────────────────────

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
    movement: "Examples:\n• `COW001 movement history`\n• `CWN104 last 3 movements`\n• `never moved COWs`\n• `warehouse aging analysis`\n• `top events breakdown`\n• `bar chart by year`\n• `how many movements in Western region`",
  };

  await bot.sendMessage(
    chatId,
    `✅ You selected *${label}*.\n\nPlease type the COW site ID and what you'd like to know.\n\n${examples[category]}`,
    { parse_mode: "Markdown" }
  );
}

// Extract region and status keywords from free-text queries for aggregate filtering.
// Region is normalised to its DB root so ilike.%root% matches WEST / Western / Western Region.
function extractTextFilters(q: string): { region?: string; status?: string } {
  const lower = q.toLowerCase();

  const REGION_MAP: [string, string][] = [
    ["western", "west"], ["west", "west"],
    ["eastern", "east"], ["east", "east"],
    ["central", "central"],
    ["northern", "north"], ["north", "north"],
    ["southern", "south"], ["south", "south"],
    ["riyadh", "riyadh"],
    ["makkah", "makkah"], ["mecca", "makkah"],
    ["madinah", "madinah"], ["medina", "madinah"],
    ["jeddah", "jeddah"], ["jedda", "jeddah"],
    ["tabuk", "tabuk"], ["qassim", "qassim"],
    ["hail", "hail"], ["najran", "najran"],
    ["jizan", "jizan"], ["asir", "asir"], ["baha", "baha"],
  ];

  let region: string | undefined;
  for (const [term, pattern] of REGION_MAP) {
    if (lower.includes(term)) { region = pattern; break; }
  }

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

// Fetch ALL movement records by paginating in parallel (Supabase caps at 1000/request).
// Lightweight version (date + id only) — used for year-chart aggregation.
async function paginateAllMovements(
  cowId?: string
): Promise<Record<string, unknown>[]> {
  const PAGE = 1000;
  const offsets = [0, 1000, 2000];
  const pages = await Promise.all(
    offsets.map((from) => {
      let q = supabase
        .from("cow_movement")
        .select("moved_date, cow_id")
        .range(from, from + PAGE - 1)
        .order("moved_date", { ascending: true });
      if (cowId) q = q.eq("cow_id", cowId) as typeof q;
      return q;
    })
  );
  return pages.flatMap((p) => (p.data ?? []) as Record<string, unknown>[]);
}

// Full movement records (all analytics fields) — used for warehouse/events analysis.
async function paginateAllMovementsFull(): Promise<Movement[]> {
  const PAGE = 1000;
  const offsets = [0, 1000, 2000];
  const pages = await Promise.all(
    offsets.map((from) =>
      supabase
        .from("cow_movement")
        .select(
          "cow_id, moved_date, from_location, to_location, movement_type, distance, region_from, region_to, vendor"
        )
        .range(from, from + PAGE - 1)
        .order("moved_date", { ascending: true })
    )
  );
  return pages.flatMap((p) => (p.data ?? []) as Movement[]);
}

// Detect if the user is asking for a chart or visual.
function detectChartRequest(query: string): boolean {
  const lower = query.toLowerCase();
  return (
    lower.includes("chart") ||
    lower.includes("graph") ||
    lower.includes("bar") ||
    lower.includes("visual") ||
    lower.includes("by year") ||
    lower.includes("per year") ||
    lower.includes("yearly") ||
    lower.includes("annually") ||
    lower.includes("each year")
  );
}

function detectOnAirDaysQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return (
    lower.includes("on-air day") ||
    lower.includes("on air day") ||
    lower.includes("days on air") ||
    lower.includes("days on-air") ||
    lower.includes("deployment duration") ||
    lower.includes("days deployed") ||
    lower.includes("how long on air") ||
    lower.includes("how long deployed") ||
    (lower.includes("total") && lower.includes("days"))
  );
}

function detectCountQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return (
    lower.includes("how many") ||
    lower.startsWith("total ") ||
    lower.includes(" total ") ||
    lower.includes("count of") ||
    lower.includes("number of")
  );
}

function detectNeverMovedQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return (
    lower.includes("never moved") ||
    lower.includes("never-moved") ||
    lower.includes("static cow") ||
    lower.includes("no movement") ||
    lower.includes("didn't move") ||
    lower.includes("did not move") ||
    lower.includes("zero movement") ||
    lower.includes("not moved") ||
    lower.includes("never deployed")
  );
}

function detectWarehouseIdleQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return (
    lower.includes("warehouse aging") ||
    lower.includes("aging analysis") ||
    lower.includes("hub time") ||
    lower.includes("idle warehouse") ||
    lower.includes("warehouse idle") ||
    (lower.includes("idle") && lower.includes("warehouse")) ||
    (lower.includes("how long") && lower.includes("warehouse")) ||
    lower.includes("off-air aging") ||
    lower.includes("offair aging")
  );
}

function detectTopEventsQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return (
    lower.includes("top event") ||
    lower.includes("which event") ||
    lower.includes("event breakdown") ||
    lower.includes("top destination") ||
    lower.includes("top location") ||
    lower.includes("most visited") ||
    lower.includes("most deployed") ||
    lower.includes("hajj") ||
    lower.includes("riyadh season") ||
    lower.includes("formula") ||
    lower.includes("national day") ||
    lower.includes("by event") ||
    lower.includes("per event")
  );
}

// Count movement records grouped by year (from moved_date).
function aggregateMovementsByYear(
  data: Record<string, unknown>[]
): { labels: string[]; values: number[] } {
  const counts: Record<string, number> = {};
  for (const row of data) {
    const dateStr = row.moved_date as string | undefined;
    if (dateStr) {
      const year = String(new Date(dateStr).getFullYear());
      if (year !== "NaN") counts[year] = (counts[year] ?? 0) + 1;
    }
  }
  const sorted = Object.keys(counts).sort();
  return { labels: sorted, values: sorted.map((y) => counts[y]!) };
}

// Build a QuickChart.io bar-chart URL that resolves to a PNG image.
function buildBarChartUrl(
  labels: string[],
  values: number[],
  title: string
): string {
  const config = {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Movements",
          data: values,
          backgroundColor: "rgba(54, 162, 235, 0.85)",
          borderColor: "rgba(54, 162, 235, 1)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: title, font: { size: 16 } },
        legend: { display: false },
      },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  };
  const encoded = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${encoded}&w=700&h=420&bkg=white`;
}

async function answerQuery(
  chatId: number,
  userId: number,
  rawQuery: string,
  category: Category
): Promise<void> {
  // Strip Telegram @mentions (e.g. "@MSDBOT2030") so the bot handle never leaks into GPT.
  const query = rawQuery.replace(/@\S+/g, "").trim();
  // Match all real COW ID patterns in the database: COW###, CW<letter>###, GAT###
  const cowMatch = query.match(/\b(COW\d+|CW[A-Z]\d+|GAT\d+)\b/i);
  const cowId = cowMatch?.[0]?.toUpperCase();

  await bot.sendChatAction(chatId, "typing");

  // ── On-air days — always from CMDB, works for never-moved COWs too ────────
  if (cowId && detectOnAirDaysQuery(query)) {
    const { data: cmdbRow } = await supabase
      .from("cmdb")
      .select("cow_id, site_label, first_deploying_date, last_deploying_date, site_status, region, city")
      .eq("cow_id", cowId)
      .maybeSingle();

    if (cmdbRow) {
      const firstRaw = cmdbRow.first_deploying_date as string | null;
      const lastRaw = cmdbRow.last_deploying_date as string | null;
      const firstDate = firstRaw ? new Date(firstRaw) : null;
      const daysOnAir = firstDate && !isNaN(firstDate.getTime())
        ? Math.floor((Date.now() - firstDate.getTime()) / 86_400_000)
        : null;

      await bot.sendMessage(
        chatId,
        `📅 *${cowId} — On-Air Duration*\n\n` +
        `• Site Label: ${cmdbRow.site_label ?? "N/A"}\n` +
        `• Status: ${cmdbRow.site_status ?? "N/A"}\n` +
        `• Region: ${cmdbRow.region ?? "N/A"} | City: ${cmdbRow.city ?? "N/A"}\n` +
        `• First Deployed: ${firstRaw ?? "N/A"}\n` +
        `• Last Deployed: ${lastRaw ?? "N/A"}\n` +
        `• Total On-Air Days: *${daysOnAir !== null ? daysOnAir.toLocaleString() : "Unknown"}*`,
        { parse_mode: "Markdown", reply_markup: continueKeyboard(category) }
      );
      return;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Analytics fast-paths (movement only — no GPT needed) ─────────────────
  if (category === "movement") {
    // 0a. Exact count for a specific COW — bypass GPT entirely
    if (cowId && detectCountQuery(query)) {
      const { count } = await supabase
        .from("cow_movement")
        .select("*", { count: "exact", head: true })
        .eq("cow_id", cowId);
      await bot.sendMessage(
        chatId,
        `📊 *${cowId}* has moved *${(count ?? 0).toLocaleString()} times*`,
        { parse_mode: "Markdown", reply_markup: continueKeyboard(category) }
      );
      return;
    }

    // 0b. Exact count for a region (no cowId) — no row fetch, no limit cap
    if (!cowId && detectCountQuery(query)) {
      const { region } = extractTextFilters(query);
      let q = supabase
        .from("cow_movement")
        .select("*", { count: "exact", head: true });
      if (region) {
        q = q.or(
          `region_from.ilike.%${region}%,region_to.ilike.%${region}%`
        ) as typeof q;
      }
      const { count } = await q;
      const regionLabel = region ? `*${region}* region` : "all regions";
      await bot.sendMessage(
        chatId,
        `📊 Total movements in ${regionLabel}: *${(count ?? 0).toLocaleString()}*`,
        { parse_mode: "Markdown", reply_markup: continueKeyboard(category) }
      );
      return;
    }

    // 1. Never-moved COWs
    if (detectNeverMovedQuery(query)) {
      const [{ data: cmdbRows }, allMoves] = await Promise.all([
        supabase.from("cmdb").select("cow_id").limit(1000),
        paginateAllMovements(),
      ]);
      const cmdbIds = (cmdbRows ?? []).map((r) => r.cow_id as string).filter(Boolean);
      const movedIds = new Set(allMoves.map((m) => m.cow_id as string).filter(Boolean));
      const neverMoved = getNeverMovedCows(cmdbIds, movedIds);
      const neverCount = neverMoved.length;
      const movedCount = cmdbIds.length - neverCount;
      const preview = neverMoved.slice(0, 20).join(", ");
      const extra = neverCount > 20 ? `\n_…and ${neverCount - 20} more_` : "";
      await bot.sendMessage(
        chatId,
        `📊 *COW Movement Status*\n\n• Total COWs in CMDB: *${cmdbIds.length}*\n• COWs with movement history: *${movedCount}*\n• COWs that never moved: *${neverCount}*\n\n${
          neverCount > 0
            ? `*Never-moved COW IDs (first 20):*\n${preview}${extra}`
            : "✅ All COWs have at least one movement record."
        }`,
        { parse_mode: "Markdown", reply_markup: continueKeyboard(category) }
      );
      return;
    }

    // 2. Warehouse idle / aging analysis
    if (detectWarehouseIdleQuery(query)) {
      const allMoves = await paginateAllMovementsFull();
      const idleResults = analyzeWarehouseIdle(allMoves);
      const agingBuckets = getWarehouseAgingBuckets(allMoves);

      const top = idleResults.slice(0, 10);
      const whLines =
        top.length > 0
          ? top.map(
              (r, i) =>
                `${i + 1}. *${r.warehouse}*\n   Avg idle: ${r.avgIdleDays} days | COWs: ${r.totalCows} | Total: ${r.totalIdleDays} days`
            )
          : ["No warehouse idle data found."];

      const bucketLines = agingBuckets
        .filter((b) => b.count > 0)
        .map((b) => `• ${b.bucket}: *${b.count}* COWs`);

      await bot.sendMessage(
        chatId,
        `🏭 *Warehouse Idle Analysis*\n_(Avg days COWs sit between movements)_\n\n${whLines.join(
          "\n"
        )}\n\n⏳ *Off-Air Aging Buckets* _(Half/Zero movement type)_\n${
          bucketLines.length > 0 ? bucketLines.join("\n") : "No off-air data."
        }`,
        { parse_mode: "Markdown", reply_markup: continueKeyboard(category) }
      );
      return;
    }

    // 3. Top events / deployment destinations
    if (detectTopEventsQuery(query)) {
      const allMoves = await paginateAllMovementsFull();
      const topDests = getTopDestinations(allMoves, 15);
      const lines = topDests.map(
        (d, i) =>
          `${i + 1}. *${d.location}*\n   Movements: ${d.movementCount} | Unique COWs: ${d.uniqueCows}`
      );
      await bot.sendMessage(
        chatId,
        `🎯 *Top Deployment Destinations*\n_(Locations receiving the most COW movements)_\n\n${lines.join(
          "\n"
        )}\n\n💡 _High-count destinations often correspond to major Saudi events — Hajj, Riyadh Season, National Day, Formula 1, Janadriyah, etc._`,
        { parse_mode: "Markdown", reply_markup: continueKeyboard(category) }
      );
      return;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  let data: Record<string, unknown>[] = [];
  let tableContext = "";

  try {
    if (category === "cmdb") {
      let q = supabase.from("cmdb").select("*");
      if (cowId) {
        q = q.eq("cow_id", cowId).limit(10) as typeof q;
      } else {
        const { region, status } = extractTextFilters(query);
        // Guard: require at least one meaningful filter — if the query has no recognisable
        // COW ID, region, or status keyword, return guidance instead of dumping all records to GPT.
        if (!region && !status) {
          await bot.sendMessage(
            chatId,
            `🔍 Please include a COW ID, region, or status in your query.\n\nExamples:\n• \`COW545 status\`\n• \`CWH186 location\`\n• \`on-air COWs in Central region\`\n• \`off-air in Western region\``,
            { parse_mode: "Markdown", reply_markup: continueKeyboard(category) }
          );
          return;
        }
        if (region) q = q.ilike("region", `%${region}%`) as typeof q;
        if (status) q = q.ilike("site_status", `%${status}%`) as typeof q;
        q = q.limit(1000) as typeof q;
      }
      const { data: rows } = await q;
      data = rows ?? [];
      tableContext =
        "CMDB infrastructure data. Fields: cow_id, site_label, region, district, city, location, site_status, vendor, technology, latitude, longitude, first_deploying_date, last_deploying_date.";
    } else {
      if (detectChartRequest(query)) {
        // Chart path: fetch ALL records via pagination so year counts are accurate.
        data = await paginateAllMovements(cowId);
      } else {
        let q = supabase
          .from("cow_movement")
          .select("*")
          .order("moved_date", { ascending: false });
        if (cowId) {
          // Fetch rows AND exact count in parallel so the header is always accurate.
          const [countResult, rowsResult] = await Promise.all([
            supabase
              .from("cow_movement")
              .select("*", { count: "exact", head: true })
              .eq("cow_id", cowId),
            q.eq("cow_id", cowId).limit(200),
          ]);
          data = rowsResult.data ?? [];
          // Use count from Supabase (not data.length) — captures rows beyond the 200 limit.
          const exactCount = countResult.count ?? data.length;
          tableContext =
            `COW movement history. Fields: cow_id, site_label, moved_date, from_location, to_location, movement_type, distance, region_from, region_to, vendor.\n\n` +
            `EXACT_TRIP_COUNT: ${exactCount}\n` +
            `⚠️ You MUST use EXACT_TRIP_COUNT (${exactCount}) as {N} in the movement header — never count the rows yourself.`;
        } else {
          const { region } = extractTextFilters(query);
          if (region) {
            q = q.or(
              `region_from.ilike.%${region}%,region_to.ilike.%${region}%`
            ) as typeof q;
          }
          q = q.limit(1000) as typeof q;
          const { data: rows } = await q;
          data = rows ?? [];
          tableContext = `COW movement history. Fields: cow_id, site_label, moved_date, from_location, to_location, movement_type, distance, region_from, region_to, vendor.

REGIONAL QUERY RULE:
When the user asks about movements in a region (e.g. "west region movement"), summarize the actual records provided:
- Total movements in the region
- Movement type breakdown (Full / Half / Zero counts)
- Top 5 destination locations by frequency
- Date range covered
Do NOT explain Saudi events unless the user explicitly asks about patterns, spikes, or reasons.

SAUDI EVENTS CONTEXT — use ONLY when the user asks about patterns, spikes, or reasons for movement peaks:
• Hajj: Annual Islamic pilgrimage (Dhul-Hijjah, shifts yearly) — WEST/CENTRAL regions.
• Umrah: Year-round — WEST region.
• Riyadh Season: Oct–Mar — CENTRAL region.
• National Day: Sep 23 | Founding Day: Feb 22 — all regions.
• Ramadan: Annual — all regions.
• Janadriyah: Feb–Mar — CENTRAL.
• Formula E/F1: Varies — Riyadh/Jeddah.`;
        }
      }
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

  // Chart fast-path: movement by year — no GPT call needed.
  if (category === "movement" && detectChartRequest(query)) {
    const { labels, values } = aggregateMovementsByYear(data);
    if (labels.length > 0) {
      const title = cowId
        ? `Movements by Year — ${cowId}`
        : "Total COW Movements by Year";
      const chartUrl = buildBarChartUrl(labels, values, title);
      const total = values.reduce((s, v) => s + v, 0);
      const lines = labels.map((l, i) => `• ${l}: *${values[i]}* movements`);
      await bot.sendPhoto(chatId, chartUrl, {
        caption:
          `📊 *${title}*\n\nTotal: *${total}* movements\n\n` +
          lines.join("\n"),
        parse_mode: "Markdown",
        reply_markup: continueKeyboard(category),
      });
      return;
    }
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
You have been given ${tableContext}
The dataset provided already reflects any region/status filters applied.
When the user asks for a count, use the "Total matching records" number if provided — do NOT recount the sample.
Format all dates as DD-MMM-YYYY.
Never mention Supabase, APIs, N8N, or any technical tools.
Never say "based on the dataset", "from the dataset provided", "from the sample", "as determined from", or any similar phrase referencing how the data was obtained. State facts directly.
Reply in English only.

MOVEMENT HISTORY FORMAT RULE:
When listing movement history for a COW, use this exact compact format — nothing else:

*<COW_ID>* — <N> movements | <first_date> → <last_date>
H: <half_count> | F: <full_count>

[1] DD-MMM-YY | <From, max 22 chars> → <To, max 22 chars> | <X>km | H/F
[2] ...

Rules:
- Abbreviate: Half=H, Full=F, Zero=Z.
- Truncate any location name longer than 22 characters with "…" (e.g. "King Fahad Sport City…").
- Omit "km" label — just the number (e.g. 30, 450).
- Sort oldest-first.
- No blank lines between rows. No extra text before or after.

CMDB SITE ID LOOKUP RULE:
When the user's message is just a site ID (e.g. "COW001" or "CWN104") with no other question, always reply with a full info card using EXACTLY this format (replace values with actual data):

### 📊 COW Information

- COW ID: <cow_id>
- Site Label: <site_label>
- Region: <region>
- District: <district>
- City: <city>
- Location: <location>
- Site Status: <site_status>
- Vendor: <vendor>
- Technology: <technology>
- Latitude: <latitude>
- Longitude: <longitude>
- First Deploying Date: <first_deploying_date>
- Last Deploying Date: <last_deploying_date>
- COW Status: <cow_status if available>

Use this same card format for every CMDB site ID lookup, every time, with no extra commentary.`,
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
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStatus = (err as Record<string, unknown>)?.status ?? "unknown";
    const errType = (err as Record<string, unknown>)?.type ?? "unknown";
    logger.error({ errMsg, errStatus, errType }, "OpenAI call error");
    answer = `⚠️ Could not generate a response (${errMsg}). Please try again.`;
  }

  await bot.sendMessage(chatId, answer, {
    parse_mode: "Markdown",
    reply_markup: continueKeyboard(category),
  });
}

// setupBot: in production registers a webhook (safe for multi-instance autoscale);
// in dev skips entirely to avoid fighting the production instance.
export async function setupBot(domain: string | undefined): Promise<void> {
  if (process.env.NODE_ENV !== "production" || !domain) {
    logger.info("Telegram bot disabled in development — webhook only in production");
    return;
  }

  const webhookUrl = `https://${domain}/api/telegram/webhook`;
  try {
    await bot.setWebHook(webhookUrl, { drop_pending_updates: false });
    logger.info({ webhookUrl }, "Telegram webhook registered");
  } catch (err) {
    logger.error({ err }, "Failed to register Telegram webhook");
  }
}

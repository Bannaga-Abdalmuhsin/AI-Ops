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
import {
  getUserRole,
  isEnvAdmin,
  addUser,
  revokeUser,
  listAllUsers,
  type BotRole,
} from "./bot-users.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const openaiKey = process.env.OPENAI_API_KEY;

if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
if (!openaiKey) throw new Error("OPENAI_API_KEY is required");

export const bot = new TelegramBot(token, { polling: false });

const openai = new OpenAI({ apiKey: openaiKey });

// ── Audit log ─────────────────────────────────────────────────────────────────
async function auditLog(
  userId: number,
  category: string | null,
  queryText: string,
  responseType: string,
): Promise<void> {
  try {
    await supabase.from("bot_audit_log").insert({
      telegram_user_id: userId,
      category,
      query_text: queryText.slice(0, 500),
      response_type: responseType,
    });
  } catch (err) {
    logger.warn({ err }, "Failed to write bot_audit_log — run security migration");
  }
}

// ── Prompt injection detection ────────────────────────────────────────────────
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|your)\s+instructions/i,
  /disregard\s+(all\s+)?(your\s+)?(instructions|rules)/i,
  /you\s+are\s+now\s+a/i,
  /forget\s+(all|what|your)/i,
  /new\s+system\s+prompt/i,
  /override\s+(your\s+)?(instructions|rules)/i,
  /<\|im_start\|>|<\|im_end\|>/,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /act\s+as\s+(a\s+)?different/i,
];

function detectPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

// ── Strip sensitive fields before sending to external AI ─────────────────────
// GPS coordinates are restricted data — never send to OpenAI.
const GPS_FIELDS = new Set([
  "latitude", "longitude",
  "from_latitude", "from_longitude",
  "to_latitude", "to_longitude",
]);

function stripSensitiveFields(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!GPS_FIELDS.has(k)) clean[k] = v;
    }
    return clean;
  });
}

type Category = "cmdb" | "movement";

interface UserSession {
  category: Category;
}

const sessions = new Map<number, UserSession>();

// Unknown users who have been shown the welcome/password prompt (self-registration).
const pendingRegistration = new Set<number>();

// Whitelisted users (found in bot_users) who have been prompted for the password gate.
const pendingVerification = new Set<number>();

// Whitelisted users who have passed the password gate this session.
// Cleared on server restart — one re-entry per restart is acceptable.
const activatedUsers = new Set<number>();

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
  const username = msg.from?.username;
  const text = (msg.text ?? "").trim();

  // ── Role-based access control + self-registration ────────────────────
  const role = await getUserRole(userId);
  if (!role) {
    const BOT_PASSWORD = (process.env.BOT_PASSWORD ?? "").trim();

    // ── Password-based self-registration ──────────────────────────────
    if (!BOT_PASSWORD) {
      // No password configured — hard deny (admin must use /adduser)
      void auditLog(userId, null, text.slice(0, 100), "auth_fail");
      await bot.sendMessage(
        chatId,
        "⛔ *Access Denied*\n\nContact your STC system administrator to request access.",
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (pendingRegistration.has(userId)) {
      // User was prompted for password — verify it now
      if (text === BOT_PASSWORD) {
        pendingRegistration.delete(userId);
        try {
          await addUser(userId, "viewer", 0, username);
          activatedUsers.add(userId); // mark as password-verified for this session
          void auditLog(userId, null, "self-registered", "admin");
          await bot.sendMessage(
            chatId,
            `✅ *Access granted!*\n\nWelcome to *ACES MSD* — stc COW Project Assistant.\nYou have been registered as a viewer.`,
            { parse_mode: "Markdown" },
          );
          await bot.sendMessage(chatId, GREETING, {
            parse_mode: "Markdown",
            reply_markup: MAIN_KEYBOARD,
          });
        } catch {
          await bot.sendMessage(
            chatId,
            "❌ Registration failed — the access table may not exist yet.\n\nContact your STC system administrator.",
            { parse_mode: "Markdown" },
          );
        }
      } else {
        await bot.sendMessage(
          chatId,
          "❌ Incorrect password. Please try again:",
          { parse_mode: "Markdown" },
        );
      }
      return;
    }

    // First contact — prompt for registration password
    pendingRegistration.add(userId);
    await bot.sendMessage(
      chatId,
      `👋 Welcome to *ACES MSD* — stc COW Project Assistant.\n\nPlease enter the team access password to register:`,
      { parse_mode: "Markdown" },
    );
    return;
  }
  // ─────────────────────────────────────────────────────────────────────

  // ── First-login password gate for whitelisted (admin-added) users ─────
  // Env admins bypass this gate entirely. All other whitelisted users must
  // enter the team password once per server session before getting access.
  {
    const BOT_PASSWORD = (process.env.BOT_PASSWORD ?? "").trim();
    if (BOT_PASSWORD && !isEnvAdmin(userId) && !activatedUsers.has(userId)) {
      if (pendingVerification.has(userId)) {
        if (text === BOT_PASSWORD) {
          pendingVerification.delete(userId);
          activatedUsers.add(userId);
          await bot.sendMessage(
            chatId,
            `✅ *Password verified!*\n\nWelcome to *ACES MSD* — stc COW Project Assistant.`,
            { parse_mode: "Markdown" },
          );
          await bot.sendMessage(chatId, GREETING, {
            parse_mode: "Markdown",
            reply_markup: MAIN_KEYBOARD,
          });
        } else {
          await bot.sendMessage(
            chatId,
            "❌ Incorrect password. Please try again:",
            { parse_mode: "Markdown" },
          );
        }
        return;
      }
      // First message from a whitelisted user — ask for password
      pendingVerification.add(userId);
      await bot.sendMessage(
        chatId,
        `🔐 You have been added to *ACES MSD* — stc COW Project Assistant.\n\nPlease enter the team access password to continue:`,
        { parse_mode: "Markdown" },
      );
      return;
    }
  }
  // ─────────────────────────────────────────────────────────────────────

  // ── Admin commands (slash commands) ───────────────────────────────────
  if (text.startsWith("/")) {
    await handleBotCommand(chatId, userId, role, text, username);
    return;
  }
  // ─────────────────────────────────────────────────────────────────────

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

  // ── Role-based access control ─────────────────────────────────────────
  const role = await getUserRole(userId);
  if (!role) {
    void auditLog(userId, null, data ?? "", "auth_fail");
    await bot.sendMessage(
      chatId,
      "⛔ *Access Denied*\n\nYou are not authorised to use this bot.",
      { parse_mode: "Markdown" },
    );
    return;
  }
  // ─────────────────────────────────────────────────────────────────────

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

// Extract region, city, and status keywords from free-text queries for aggregate filtering.
// Region is used for movement (region_from/region_to columns).
// City is used for CMDB (city/district columns) — more specific than region.
function extractTextFilters(q: string): { region?: string; regionLabel?: string; regionSearch?: string; status?: string; city?: string } {
  const lower = q.toLowerCase();

  // Maps user keywords → the exact region code stored in the DB (region_from / region_to).
  // DB uses 2-letter abbreviations: CR, WR, ER, SR.
  const REGION_MAP: [string, string][] = [
    ["western",  "WR"], ["west",    "WR"],
    ["eastern",  "ER"], ["east",    "ER"],
    ["central",  "CR"],
    ["northern", "NR"], ["north",   "NR"],
    ["southern", "SR"], ["south",   "SR"],
  ];

  // Human-readable labels for display in bot messages.
  const REGION_LABELS: Record<string, string> = {
    WR: "Western", ER: "Eastern", CR: "Central", SR: "Southern", NR: "Northern",
  };
  // ilike-friendly root words for CMDB (which stores "West", "EAST", "Central", "South").
  const REGION_SEARCH: Record<string, string> = {
    WR: "west", ER: "east", CR: "central", SR: "south", NR: "north",
  };

  let region: string | undefined;
  for (const [term, pattern] of REGION_MAP) {
    if (lower.includes(term)) { region = pattern; break; }
  }
  const regionLabel = region ? (REGION_LABELS[region] ?? region) : undefined;
  const regionSearch = region ? (REGION_SEARCH[region] ?? region.toLowerCase()) : undefined;

  // City-level filter — applied to city/district columns in CMDB.
  // Covers Saudi cities not expressible as a broad region.
  const CITY_MAP: [string, string][] = [
    ["dammam", "dammam"],
    ["khobar", "khobar"], ["al khobar", "khobar"],
    ["dhahran", "dhahran"],
    ["qatif", "qatif"],
    ["jubail", "jubail"],
    ["hofuf", "hofuf"], ["al hofuf", "hofuf"],
    ["khafji", "khafji"],
    ["abqiq", "abqiq"],
    ["hafer", "hafer"],   // Hafer al-Batin
    ["khamis", "khamis"], // Khamis Mushait
    ["abha", "abha"],
    ["yanbu", "yanbu"],
    ["taif", "taif"],
    ["muzahmiya", "muzahmiya"],
    ["turaif", "turaif"],
    ["arar", "arar"],
    ["jouf", "jouf"], ["al jouf", "jouf"],
    ["neom", "neom"],
    ["buraida", "buraida"], ["burayda", "buraida"],
    ["wadi", "wadi"],
    ["najran", "najran"],
    ["jizan", "jizan"],
    ["hail", "hail"],
    ["jeddah", "jeddah"], ["jedda", "jeddah"],
    ["makkah", "makkah"], ["mecca", "makkah"],
    ["madinah", "madinah"], ["medina", "madinah"],
    ["riyadh", "riyadh"],
    ["tabuk", "tabuk"],
  ];

  let city: string | undefined;
  for (const [term, pattern] of CITY_MAP) {
    if (lower.includes(term)) { city = pattern; break; }
  }

  let status: string | undefined;
  if (lower.match(/on[\s-]?air/)) status = "On-Air";
  else if (lower.match(/off[\s-]?air/)) status = "Off-Air";

  return { region, regionLabel, regionSearch, status, city };
}

// Build a concise data payload for GPT: all rows when small, count + sample when large.
// GPS coordinates are stripped before sending to OpenAI (data residency control).
function buildDataPayload(
  rows: Record<string, unknown>[]
): { payload: string; totalCount: number } {
  const sanitised = stripSensitiveFields(rows);
  const totalCount = sanitised.length;
  if (totalCount <= 50) {
    return { payload: JSON.stringify(sanitised, null, 2), totalCount };
  }
  const sample = sanitised.slice(0, 30);
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

// Chart dimension detection — returns which dimension to visualize, or null if not a chart request.
type ChartDimension = "year" | "month" | "region" | "warehouse" | "event_type" | "vendor" | "avg_distance";

function detectChartDimension(query: string): ChartDimension | null {
  const lower = query.toLowerCase();
  const isChart =
    lower.includes("chart") || lower.includes("graph") || lower.includes("visual") ||
    lower.includes("by year") || lower.includes("per year") || lower.includes("yearly") || lower.includes("annually") || lower.includes("each year") ||
    lower.includes("by month") || lower.includes("per month") || lower.includes("monthly") ||
    lower.includes("by region") || lower.includes("per region") ||
    lower.includes("by wh") || lower.includes("by warehouse") ||
    lower.includes("by event") || lower.includes("by events") || lower.includes("event type") || lower.includes("events type") || lower.includes("movement type") || lower.includes("by type") || lower.includes("per event") || lower.includes("category") ||
    lower.includes("by vendor") || lower.includes("per vendor") ||
    lower.includes("average distance") || lower.includes("avg distance") || lower.includes("by distance");

  if (!isChart) return null;

  // Check dimension keywords — avg_distance first to avoid clashing with "distance" in other phrases
  if (lower.includes("average distance") || lower.includes("avg distance") || lower.includes("by distance")) return "avg_distance";
  if (lower.includes("month")) return "month";
  if (lower.includes("region")) return "region";
  if (lower.includes("wh") || lower.includes("warehouse") || lower.includes("hub")) return "warehouse";
  if (lower.includes("event") || lower.includes("event type") || lower.includes("events type") || lower.includes("movement type") || lower.includes("by type") || lower.includes("category")) return "event_type";
  if (lower.includes("vendor")) return "vendor";
  return "year"; // default
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
    lower.includes("how much") ||
    lower.startsWith("total ") ||
    lower.includes(" total ") ||
    lower.includes("count of") ||
    lower.includes("count sites") ||
    lower.includes("count cows") ||
    lower.includes("site count") ||
    lower.includes("cow count") ||
    lower.includes("give me count") ||
    lower.includes("give me the count") ||
    lower.includes("tell me how many") ||
    lower.includes("number of") ||
    lower.includes("# of") ||
    /(^| )count( |$)/.test(lower)
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
    lower.includes("national day")
    // "by event" / "per event" intentionally removed — those route to the chart fast-path
  );
}

// ── Aggregation helpers ──────────────────────────────────────────────────────

function aggregateMovementsByYear(
  data: Array<{ moved_date?: unknown }>
): { labels: string[]; values: number[] } {
  const counts: Record<string, number> = {};
  for (const row of data) {
    const d = new Date(row.moved_date as string);
    const year = String(d.getFullYear());
    if (year !== "NaN") counts[year] = (counts[year] ?? 0) + 1;
  }
  const sorted = Object.keys(counts).sort();
  return { labels: sorted, values: sorted.map((y) => counts[y]!) };
}

function aggregateByMonth(
  data: Array<{ moved_date?: unknown }>
): { labels: string[]; values: number[] } {
  const counts: Record<string, number> = {};
  for (const row of data) {
    const d = new Date(row.moved_date as string);
    if (isNaN(d.getTime())) continue;
    const key = `${d.toLocaleString("en", { month: "short" })}-${String(d.getFullYear()).slice(2)}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  // Sort chronologically
  const sorted = Object.keys(counts).sort(
    (a, b) => new Date(`1 ${a}`).getTime() - new Date(`1 ${b}`).getTime()
  );
  return { labels: sorted, values: sorted.map((k) => counts[k]!) };
}

function aggregateByField(
  data: Movement[],
  field: keyof Movement,
  topN = 15
): { labels: string[]; values: number[] } {
  const counts: Record<string, number> = {};
  for (const row of data) {
    const val = String(row[field] ?? "").trim();
    if (!val || val.toUpperCase() === "#N/A" || val === "NA" || val === "null") continue;
    counts[val] = (counts[val] ?? 0) + 1;
  }
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);
  return { labels: sorted.map(([k]) => k), values: sorted.map(([, v]) => v) };
}

function aggregateByWarehouse(
  data: Movement[],
  topN = 10
): { labels: string[]; values: number[] } {
  const counts: Record<string, number> = {};
  for (const row of data) {
    const loc = (row.from_location ?? "").trim();
    const up = loc.toUpperCase();
    if (!loc || (!up.includes("WH") && !up.includes("WAREHOUSE") && !up.includes("DEPOT"))) continue;
    counts[loc] = (counts[loc] ?? 0) + 1;
  }
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);
  return { labels: sorted.map(([k]) => k), values: sorted.map(([, v]) => v) };
}

function aggregateAvgDistanceByRegion(
  data: Movement[]
): { labels: string[]; values: number[] } {
  const stats: Record<string, { sum: number; count: number }> = {};
  for (const row of data) {
    const region = (row.region_to ?? row.region_from ?? "").trim();
    const dist = typeof row.distance === "number" ? row.distance : null;
    if (!region || dist === null || isNaN(dist) || dist <= 0) continue;
    if (!stats[region]) stats[region] = { sum: 0, count: 0 };
    stats[region].sum += dist;
    stats[region].count += 1;
  }
  const entries = Object.entries(stats)
    .map(([region, s]) => ({ region, avg: Math.round(s.sum / s.count) }))
    .sort((a, b) => b.avg - a.avg);
  return { labels: entries.map((e) => e.region), values: entries.map((e) => e.avg) };
}

// Build a QuickChart.io bar-chart URL that resolves to a PNG image.
function buildBarChartUrl(
  labels: string[],
  values: number[],
  title: string,
  valueLabel = "Movements"
): string {
  const config = {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: valueLabel,
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

// ── Admin command handler ─────────────────────────────────────────────────────
async function handleBotCommand(
  chatId: number,
  userId: number,
  role: BotRole,
  text: string,
  username?: string,
): Promise<void> {
  const parts = text.trim().split(/\s+/);
  const cmd = (parts[0] ?? "").toLowerCase();

  void auditLog(userId, null, text.slice(0, 200), "admin");

  // ── /whoami — show own access level
  if (cmd === "/whoami" || cmd === "/start") {
    const isAdmin = isEnvAdmin(userId);
    await bot.sendMessage(
      chatId,
      `👤 *Your Access*\n\n• Telegram ID: \`${userId}\`\n• Username: @${username ?? "unknown"}\n• Role: *${role}*${isAdmin ? " _(env admin)_" : ""}`,
      { parse_mode: "Markdown" },
    );
    return;
  }

  // ── /adduser <telegram_id> <role> — admins only
  if (cmd === "/adduser") {
    if (role !== "admin") {
      await bot.sendMessage(chatId, "⛔ Admin access required.", { parse_mode: "Markdown" });
      return;
    }
    const targetId = parseInt(parts[1] ?? "", 10);
    const targetRole = (parts[2] ?? "viewer") as BotRole;
    if (isNaN(targetId) || targetId <= 0) {
      await bot.sendMessage(chatId, "❌ Usage: `/adduser <telegram_user_id> <viewer|operator|admin>`", { parse_mode: "Markdown" });
      return;
    }
    if (!["viewer", "operator", "admin"].includes(targetRole)) {
      await bot.sendMessage(chatId, "❌ Role must be: `viewer`, `operator`, or `admin`", { parse_mode: "Markdown" });
      return;
    }
    try {
      await addUser(targetId, targetRole, userId, parts[3]);
      await bot.sendMessage(chatId, `✅ User \`${targetId}\` added with role *${targetRole}*`, { parse_mode: "Markdown" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await bot.sendMessage(chatId, `❌ Failed: ${msg}`, { parse_mode: "Markdown" });
    }
    return;
  }

  // ── /removeuser <telegram_id> — admins only
  if (cmd === "/removeuser" || cmd === "/revokeuser") {
    if (role !== "admin") {
      await bot.sendMessage(chatId, "⛔ Admin access required.", { parse_mode: "Markdown" });
      return;
    }
    const targetId = parseInt(parts[1] ?? "", 10);
    if (isNaN(targetId) || targetId <= 0) {
      await bot.sendMessage(chatId, "❌ Usage: `/removeuser <telegram_user_id>`", { parse_mode: "Markdown" });
      return;
    }
    const ok = await revokeUser(targetId);
    await bot.sendMessage(
      chatId,
      ok ? `✅ User \`${targetId}\` revoked.` : `⚠️ User \`${targetId}\` not found or already inactive.`,
      { parse_mode: "Markdown" },
    );
    return;
  }

  // ── /listusers — admins only
  if (cmd === "/listusers") {
    if (role !== "admin") {
      await bot.sendMessage(chatId, "⛔ Admin access required.", { parse_mode: "Markdown" });
      return;
    }
    const users = await listAllUsers();
    if (users.length === 0) {
      await bot.sendMessage(chatId, "📋 No users in the allowlist yet. Use `/adduser` to add one.", { parse_mode: "Markdown" });
      return;
    }
    const lines = users.map(
      (u) => `• \`${u.id}\` @${u.username ?? "unknown"} — *${u.role}* _(${u.source})_`,
    );
    await bot.sendMessage(
      chatId,
      `📋 *Authorised Users (${users.length})*\n\n${lines.join("\n")}`,
      { parse_mode: "Markdown" },
    );
    return;
  }

  // ── Unknown command
  const adminHelp = role === "admin"
    ? "\n• `/adduser <id> <role>` — grant access\n• `/removeuser <id>` — revoke access\n• `/listusers` — list all users"
    : "";
  await bot.sendMessage(
    chatId,
    `ℹ️ *Available Commands*\n\n• \`/whoami\` — show your access level${adminHelp}`,
    { parse_mode: "Markdown" },
  );
}

async function answerQuery(
  chatId: number,
  userId: number,
  rawQuery: string,
  category: Category
): Promise<void> {
  // ── Input validation ────────────────────────────────────────────────────
  if (rawQuery.length > 500) {
    void auditLog(userId, category, rawQuery.slice(0, 200), "error");
    await bot.sendMessage(chatId, "❌ Query too long (max 500 characters). Please shorten your question.", { parse_mode: "Markdown" });
    return;
  }
  if (detectPromptInjection(rawQuery)) {
    void auditLog(userId, category, rawQuery.slice(0, 200), "injection_blocked");
    logger.warn({ userId, query: rawQuery.slice(0, 100) }, "Prompt injection attempt detected");
    await bot.sendMessage(chatId, "❌ Your query contains invalid patterns. Please rephrase.", { parse_mode: "Markdown" });
    return;
  }
  // ───────────────────────────────────────────────────────────────────────

  // Strip Telegram @mentions (e.g. "@MSDBOT2030") so the bot handle never leaks into GPT.
  // Then normalise terminology so downstream NLU works regardless of what synonym the user typed.
  const query = rawQuery
    .replace(/@\S+/g, "")       // remove @mentions
    // COW ↔ Site synonyms — users say "site", "sites", "site list"; all mean COW records
    .replace(/\bsites?\s+list\b/gi, "list COWs")
    .replace(/\bsite\s+id\b/gi, "COW ID")
    .replace(/\bsites?\b/gi, "COWs")
    // Region code aliases — users may type the DB code directly
    .replace(/\bWR\b/g, "Western")
    .replace(/\bCR\b/g, "Central")
    .replace(/\bER\b/g, "Eastern")
    .replace(/\bSR\b/g, "Southern")
    .trim();
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

  // Detect listing intent: "list", "share sites", "show all", "give me all", etc.
  function detectListQuery(q: string): boolean {
    const lower = q.toLowerCase();
    return (
      lower.includes("list") ||
      lower.includes("share site") ||
      lower.includes("share cow") ||
      lower.includes("show all") ||
      lower.includes("show me all") ||
      lower.includes("show me the") ||
      lower.includes("give me all") ||
      lower.includes("give me sites") ||
      lower.includes("give me cows") ||
      lower.includes("give me the sites") ||
      lower.includes("give me the cows") ||
      lower.includes("get sites") ||
      lower.includes("get cows") ||
      lower.includes("show sites") ||
      lower.includes("show cows") ||
      lower.includes("all sites") ||
      lower.includes("all cows") ||
      lower.includes("all records") ||
      lower.includes("cows in") ||
      lower.includes("sites in")
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── CMDB list fast-path — returns full table, no GPT, no sampling ─────────
  if (category === "cmdb" && !cowId && detectListQuery(query)) {
    const { regionSearch, status, city } = extractTextFilters(query);
    if (!city && !regionSearch && !status) {
      await bot.sendMessage(
        chatId,
        `🔍 Please specify a city, region, or status to list sites.\n\nExample: \`list on-air sites in Riyadh\``,
        { parse_mode: "Markdown", reply_markup: continueKeyboard(category) }
      );
      return;
    }
    let q = supabase
      .from("cmdb")
      .select("cow_id, site_label, location, site_status")
      .order("cow_id", { ascending: true })
      .limit(1000);
    if (city) q = q.ilike("city", `%${city}%`) as typeof q;
    else if (regionSearch) q = q.ilike("region", `%${regionSearch}%`) as typeof q;
    if (status) q = q.ilike("site_status", `%${status}%`) as typeof q;
    const { data: rows } = await q;

    if (!rows || rows.length === 0) {
      const label = city ?? regionSearch ?? status ?? "that filter";
      await bot.sendMessage(
        chatId,
        `❌ No COW sites found for *${label}*. Check the spelling or try a broader query.`,
        { parse_mode: "Markdown", reply_markup: continueKeyboard(category) }
      );
      return;
    }

    const filterLabel = city
      ? city.charAt(0).toUpperCase() + city.slice(1)
      : regionSearch
      ? regionSearch.charAt(0).toUpperCase() + regionSearch.slice(1) + " Region"
      : "";
    const statusLabel = status ? ` — ${status}` : "";
    const header = `📋 *COW Sites in ${filterLabel}${statusLabel}*\n_Total: ${rows.length} sites_\n\n`;

    // Format: "1. COW001" — one column only (cow_id is the unique site identifier)
    const lines = (rows as Array<{ cow_id?: string; site_label?: string; location?: string; site_status?: string }>).map(
      (r, i) => `${i + 1}. *${r.cow_id ?? "—"}*`
    );

    // Split into chunks to stay under Telegram's 4096-char limit
    const chunks: string[][] = [];
    let chunk: string[] = [];
    let len = 0;
    for (const line of lines) {
      if (len + line.length + 1 > 3400) {
        chunks.push(chunk);
        chunk = [];
        len = 0;
      }
      chunk.push(line);
      len += line.length + 1;
    }
    if (chunk.length > 0) chunks.push(chunk);

    for (let i = 0; i < chunks.length; i++) {
      const prefix = i === 0 ? header : `_(continued ${i + 1}/${chunks.length})_\n\n`;
      await bot.sendMessage(chatId, prefix + chunks[i].join("\n"), {
        parse_mode: "Markdown",
        reply_markup: i === chunks.length - 1 ? continueKeyboard(category) : undefined,
      });
    }
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── CMDB count fast-path — exact Supabase count, no GPT ──────────────────
  if (category === "cmdb" && !cowId && detectCountQuery(query)) {
    const { region, regionLabel, regionSearch, status, city } = extractTextFilters(query);
    let q = supabase.from("cmdb").select("*", { count: "exact", head: true });
    if (city) q = q.ilike("city", `%${city}%`) as typeof q;
    else if (regionSearch) q = q.ilike("region", `%${regionSearch}%`) as typeof q;
    if (status) q = q.ilike("site_status", `%${status}%`) as typeof q;
    const { count } = await q;
    const cityLabel = city ? `in *${city.charAt(0).toUpperCase() + city.slice(1)}*` :
      regionLabel ? `in *${regionLabel}* region` : "total";
    const statusLabel = status ? `*${status}* COWs` : "COWs";
    await bot.sendMessage(
      chatId,
      `📊 ${statusLabel} ${cityLabel}: *${(count ?? 0).toLocaleString()}*`,
      { parse_mode: "Markdown", reply_markup: continueKeyboard(category) }
    );
    return;
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
      const { region, regionLabel } = extractTextFilters(query);
      let q = supabase
        .from("cow_movement")
        .select("*", { count: "exact", head: true });
      if (region) {
        q = q.or(
          `region_from.eq.${region},region_to.eq.${region}`
        ) as typeof q;
      }
      const { count } = await q;
      const displayLabel = regionLabel ? `*${regionLabel}* region` : "all regions";
      await bot.sendMessage(
        chatId,
        `📊 Total movements in ${displayLabel}: *${(count ?? 0).toLocaleString()}*`,
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

    // 4. Bar charts — all 7 dimensions, no GPT needed
    const chartDim = detectChartDimension(query);
    if (chartDim) {
      await bot.sendChatAction(chatId, "upload_photo");
      let labels: string[] = [];
      let values: number[] = [];
      let chartTitle = "";
      let valueLabel = "Movements";

      if (chartDim === "year" || chartDim === "month") {
        const lightData = await paginateAllMovements(cowId);
        if (chartDim === "year") {
          ({ labels, values } = aggregateMovementsByYear(lightData));
          chartTitle = cowId ? `Movements by Year — ${cowId}` : "Total COW Movements by Year";
        } else {
          ({ labels, values } = aggregateByMonth(lightData));
          chartTitle = cowId ? `Movements by Month — ${cowId}` : "COW Movements by Month";
        }
      } else {
        const fullData = await paginateAllMovementsFull();
        if (chartDim === "region") {
          ({ labels, values } = aggregateByField(fullData, "region_to"));
          chartTitle = "Movements by Destination Region";
        } else if (chartDim === "warehouse") {
          ({ labels, values } = aggregateByWarehouse(fullData));
          chartTitle = "Movements by Source Warehouse (Top 10)";
        } else if (chartDim === "event_type") {
          ({ labels, values } = aggregateByField(fullData, "movement_type"));
          chartTitle = "Movements by Event / Type";
        } else if (chartDim === "vendor") {
          ({ labels, values } = aggregateByField(fullData, "vendor"));
          chartTitle = "Movements by Vendor";
        } else if (chartDim === "avg_distance") {
          ({ labels, values } = aggregateAvgDistanceByRegion(fullData));
          chartTitle = "Avg Movement Distance by Region (km)";
          valueLabel = "Avg km";
        }
      }

      if (labels.length === 0) {
        await bot.sendMessage(chatId, "⚠️ No data available to generate this chart.", {
          parse_mode: "Markdown",
          reply_markup: continueKeyboard(category),
        });
        return;
      }

      const chartUrl = buildBarChartUrl(labels, values, chartTitle, valueLabel);
      const total = valueLabel === "Movements" ? values.reduce((s, v) => s + v, 0) : null;
      const summaryLines = labels
        .map((l, i) => `• ${l}: *${values[i].toLocaleString()}*${valueLabel !== "Movements" ? " km" : ""}`)
        .join("\n");

      await bot.sendPhoto(chatId, chartUrl, {
        caption:
          `📊 *${chartTitle}*\n\n` +
          (total !== null ? `Total: *${total.toLocaleString()}* movements\n\n` : "") +
          summaryLines,
        parse_mode: "Markdown",
        reply_markup: continueKeyboard(category),
      });
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
        const { regionSearch, status, city } = extractTextFilters(query);
        // Guard: require at least one meaningful filter — if the query has no recognisable
        // COW ID, city, region, or status keyword, return guidance instead of dumping all records to GPT.
        if (!city && !regionSearch && !status) {
          await bot.sendMessage(
            chatId,
            `🔍 Please include a COW ID, city, region, or status in your query.\n\nExamples:\n• \`COW545 status\`\n• \`CWH186 location\`\n• \`on-air COWs in Dammam\`\n• \`off-air in Western region\``,
            { parse_mode: "Markdown", reply_markup: continueKeyboard(category) }
          );
          return;
        }
        if (city) q = q.ilike("city", `%${city}%`) as typeof q;
        else if (regionSearch) q = q.ilike("region", `%${regionSearch}%`) as typeof q;
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
            `region_from.eq.${region},region_to.eq.${region}`
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

  void auditLog(userId, category, query, "gpt");

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

TERMINOLOGY — always treat these as identical:
- "COW" = "Site" (users may say either; they mean the same record)
- "COW ID" = "Site ID" = "Site Code"
- "COWs" = "Sites"

REGION CODES — always translate to full names in your answers:
- WR = Western Region
- CR = Central Region
- ER = Eastern Region
- SR = Southern Region
When a field contains WR/CR/ER/SR, display the full name (e.g. "Western Region"), never the code.

MOVEMENT HISTORY FORMAT RULE:
When listing movement history for a COW/Site, use this exact compact format — nothing else:

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

SITE / COW ID LOOKUP RULE:
When the user's message is just a site/COW ID (e.g. "COW001", "CWN104") with no other question:
- If the dataset contains a record for that ID, reply with a full info card using EXACTLY this format:

### 📊 Site Information

- Site ID: <cow_id>
- Site Label: <site_label>
- Region: <region — translate WR/CR/ER/SR to full name>
- District: <district>
- City: <city>
- Location: <location>
- Site Status: <site_status>
- Vendor: <vendor>
- Technology: <technology>
- First Deploying Date: <first_deploying_date>
- Last Deploying Date: <last_deploying_date>

- If the dataset is empty or does NOT contain a record for that site ID, reply ONLY with:
❌ No Site ID found matching "*<queried_id>*". Please check the ID and try again.
Never use "Not available" placeholder cards — only show the card when real data exists.`,
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
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!secretToken) {
    logger.warn("TELEGRAM_WEBHOOK_SECRET not set — webhook will be registered WITHOUT signature verification");
  }

  try {
    await bot.setWebHook(webhookUrl, {
      secret_token: secretToken,
    });
    logger.info(
      { webhookUrl, hasSecret: !!secretToken },
      "Telegram webhook registered",
    );
  } catch (err) {
    logger.error({ err }, "Failed to register Telegram webhook");
  }
}

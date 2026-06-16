import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (ALLOWED_ORIGINS.length === 0) {
  logger.warn("ALLOWED_ORIGINS not set — CORS will allow all origins (dev mode)");
}

const app: Express = express();

// Trust the Replit reverse proxy so req.ip reflects the real client IP
app.set("trust proxy", 1);

// ── Security headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Telegram webhook: generous limit — Telegram processes one update per connection
const webhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many webhook requests" },
});

// General API limiter for the dashboard and other consumers
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please slow down" },
});

// Strict limiter on sync triggers (expensive DB operations)
const syncLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Sync rate limit exceeded — wait before triggering again" },
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ── Body parsing with size limit ─────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── Apply rate limiters before routing ───────────────────────────────────────
app.use("/api/telegram/webhook", webhookLimiter);
app.use("/api/sync/run", syncLimiter);
app.use("/api", apiLimiter);

app.use("/api", router);

export default app;

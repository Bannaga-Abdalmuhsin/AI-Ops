import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";

const API_SECRET_KEY = process.env.API_SECRET_KEY;

if (!API_SECRET_KEY) {
  logger.warn("API_SECRET_KEY not set — REST API routes are publicly accessible");
}

/**
 * Bearer-token middleware protecting all /api/* routes.
 * Skipped for /api/healthz (public liveness probe) and
 * /api/telegram/webhook (has its own TELEGRAM_WEBHOOK_SECRET check).
 */
export function apiAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!API_SECRET_KEY) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized — Authorization: Bearer <key> required" });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== API_SECRET_KEY) {
    logger.warn({ ip: req.ip, path: req.path }, "API auth rejected — invalid key");
    res.status(403).json({ error: "Forbidden — invalid API key" });
    return;
  }

  next();
}

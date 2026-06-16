import { Router, type IRouter } from "express";
import { apiAuth } from "../middleware/auth.js";
import healthRouter from "./health";
import syncRouter from "./sync";
import dataRouter from "./data";
import statsRouter from "./stats";
import telegramRouter from "./telegram";

const router: IRouter = Router();

// ── API Authentication ─────────────────────────────────────────────────────
// Apply Bearer token auth to all routes EXCEPT:
//   /healthz  — public liveness probe (load balancers, monitoring)
//   /telegram/webhook  — has its own TELEGRAM_WEBHOOK_SECRET verification
router.use((req, res, next) => {
  if (req.path === "/healthz" || req.path.startsWith("/telegram/webhook")) {
    return next();
  }
  return apiAuth(req, res, next);
});
// ─────────────────────────────────────────────────────────────────────────────

router.use(healthRouter);
router.use(syncRouter);
router.use(dataRouter);
router.use(statsRouter);
router.use(telegramRouter);

export default router;

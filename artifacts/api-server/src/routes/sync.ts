import { Router, type IRouter } from "express";
import { pool } from "../lib/db.js";
import { runFullSync, runSingleSync, syncRunning } from "../lib/sync.js";
import {
  GetSyncStatusResponse,
  GetSyncLogsQueryParams,
  GetSyncLogsResponse,
  RunTableSyncParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/sync/status", async (req, res): Promise<void> => {
  const tables = ["cmdb", "energy_dashboard", "cow_movement"] as const;

  const results = await Promise.all(
    tables.map(async (table) => {
      const [countRes, syncedRes, logRes] = await Promise.all([
        pool.query(`SELECT COUNT(*) FROM ${table}`),
        pool.query(
          `SELECT synced_at FROM ${table} ORDER BY synced_at DESC LIMIT 1`,
        ),
        pool.query(
          `SELECT status, error_message FROM sync_log
           WHERE table_name = $1 ORDER BY synced_at DESC LIMIT 1`,
          [table],
        ),
      ]);

      const logRow = logRes.rows[0] ?? null;
      return {
        table_name: table,
        row_count: parseInt(countRes.rows[0].count, 10),
        last_synced_at: syncedRes.rows[0]?.synced_at ?? null,
        status: logRow
          ? (logRow.status === "ok" ? "ok" : "error")
          : "never_synced",
        last_error: logRow?.error_message ?? null,
      };
    }),
  );

  res.json(GetSyncStatusResponse.parse(results));
});

router.get("/sync/logs", async (req, res): Promise<void> => {
  const parsed = GetSyncLogsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { limit = 50, table } = parsed.data;

  const params: unknown[] = [limit];
  const tableFilter = table ? `WHERE table_name = $${params.push(table)}` : "";

  const { rows } = await pool.query(
    `SELECT id, table_name, rows_synced, status, error_message, duration_ms, synced_at
     FROM sync_log
     ${tableFilter}
     ORDER BY synced_at DESC
     LIMIT $1`,
    params,
  );

  res.json(GetSyncLogsResponse.parse(rows));
});

router.post("/sync/run", async (req, res): Promise<void> => {
  if (syncRunning) {
    res.status(409).json({ error: "Sync already in progress" });
    return;
  }
  req.log.info("Full sync triggered");
  const tables = await runFullSync();
  res.json({ success: tables.every((t) => t.success), tables });
});

router.post("/sync/run/:table", async (req, res): Promise<void> => {
  const parsed = RunTableSyncParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (syncRunning) {
    res.status(409).json({ error: "Sync already in progress" });
    return;
  }
  req.log.info({ table: parsed.data.table }, "Table sync triggered");
  const result = await runSingleSync(parsed.data.table);
  res.json({ success: result.success, tables: [result] });
});

export default router;

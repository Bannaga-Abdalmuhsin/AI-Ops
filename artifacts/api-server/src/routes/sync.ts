import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
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
      const { count } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });

      const { data: syncedRow } = await supabase
        .from(table)
        .select("synced_at")
        .order("synced_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: logRow } = await supabase
        .from("sync_log")
        .select("status, error_message")
        .eq("table_name", table)
        .order("synced_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return {
        table_name: table,
        row_count: count ?? 0,
        last_synced_at: syncedRow?.synced_at ?? null,
        status: logRow ? (logRow.status === "ok" ? "ok" : "error") : "never_synced",
        last_error: logRow?.error_message ?? null,
      };
    })
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

  let query = supabase
    .from("sync_log")
    .select("id, table_name, rows_synced, status, error_message, duration_ms, synced_at")
    .order("synced_at", { ascending: false })
    .limit(limit);

  if (table) {
    query = query.eq("table_name", table);
  }

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json(GetSyncLogsResponse.parse(data ?? []));
});

router.post("/sync/run", async (req, res): Promise<void> => {
  if (syncRunning) {
    res.status(409).json({ error: "Sync already in progress" });
    return;
  }
  req.log.info("Full sync triggered");
  const tables = await runFullSync();
  res.json({ success: tables.every(t => t.success), tables });
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

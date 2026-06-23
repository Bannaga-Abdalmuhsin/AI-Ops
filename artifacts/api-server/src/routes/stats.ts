import { Router, type IRouter } from "express";
import { pool } from "../lib/db.js";
import { syncRunning } from "../lib/sync.js";

const router: IRouter = Router();

router.get("/stats/overview", async (req, res): Promise<void> => {
  const [cmdbRes, energyRes, cowRes, lastSyncRes, onAirRes, regionRes] =
    await Promise.all([
      pool.query("SELECT COUNT(*) FROM cmdb"),
      pool.query("SELECT COUNT(*) FROM energy_dashboard"),
      pool.query("SELECT COUNT(*) FROM cow_movement"),
      pool.query(
        "SELECT synced_at FROM sync_log WHERE status = 'ok' ORDER BY synced_at DESC LIMIT 1",
      ),
      pool.query("SELECT COUNT(*) FROM cmdb WHERE site_status ILIKE '%ON-AIR%'"),
      pool.query("SELECT region FROM cmdb WHERE region IS NOT NULL"),
    ]);

  const regionCounts: Record<string, number> = {};
  for (const row of regionRes.rows) {
    const r = row.region as string;
    if (r) regionCounts[r] = (regionCounts[r] ?? 0) + 1;
  }
  const regions = Object.entries(regionCounts)
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  res.json({
    cmdb_count: parseInt(cmdbRes.rows[0].count, 10),
    energy_count: parseInt(energyRes.rows[0].count, 10),
    cow_movement_count: parseInt(cowRes.rows[0].count, 10),
    last_full_sync: lastSyncRes.rows[0]?.synced_at ?? null,
    sync_running: syncRunning,
    on_air_count: parseInt(onAirRes.rows[0].count, 10),
    regions,
  });
});

export default router;

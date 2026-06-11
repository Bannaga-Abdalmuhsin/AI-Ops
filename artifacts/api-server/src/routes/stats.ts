import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { syncRunning } from "../lib/sync.js";

const router: IRouter = Router();

router.get("/stats/overview", async (req, res): Promise<void> => {
  const [cmdbRes, energyRes, cowRes, lastSyncRes, onAirRes, regionRows] = await Promise.all([
    supabase.from("cmdb").select("*", { count: "exact", head: true }),
    supabase.from("energy_dashboard").select("*", { count: "exact", head: true }),
    supabase.from("cow_movement").select("*", { count: "exact", head: true }),
    supabase
      .from("sync_log")
      .select("synced_at")
      .eq("status", "ok")
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("cmdb")
      .select("*", { count: "exact", head: true })
      .ilike("site_status", "%ON-AIR%"),
    supabase.from("cmdb").select("region").not("region", "is", null),
  ]);

  // Compute region breakdown from raw rows
  const regionCounts: Record<string, number> = {};
  for (const row of regionRows.data ?? []) {
    const r = row.region as string;
    if (r) regionCounts[r] = (regionCounts[r] ?? 0) + 1;
  }
  const regions = Object.entries(regionCounts)
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  res.json({
    cmdb_count: cmdbRes.count ?? 0,
    energy_count: energyRes.count ?? 0,
    cow_movement_count: cowRes.count ?? 0,
    last_full_sync: lastSyncRes.data?.synced_at ?? null,
    sync_running: syncRunning,
    on_air_count: onAirRes.count ?? 0,
    regions,
  });
});

export default router;

import { supabase } from "./supabase.js";
import { fetchCmdbRows, fetchEnergyRows, fetchCowMovementRows } from "./sheets.js";
import { logger } from "./logger.js";

export let syncRunning = false;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function logSync(
  tableName: string,
  status: "ok" | "error",
  rowsSynced: number | null,
  errorMessage: string | null,
  durationMs: number
): Promise<void> {
  await supabase.from("sync_log").insert({
    table_name: tableName,
    rows_synced: rowsSynced,
    status,
    error_message: errorMessage,
    duration_ms: durationMs,
  });
}

export interface TableSyncResult {
  table_name: string;
  rows_synced: number;
  success: boolean;
  error: string | null;
  duration_ms: number;
}

export async function syncCmdb(): Promise<TableSyncResult> {
  const start = Date.now();
  try {
    logger.info("Syncing CMDB...");
    const rows = await fetchCmdbRows();

    if (rows.length === 0) {
      const duration = Date.now() - start;
      await logSync("cmdb", "ok", 0, null, duration);
      return { table_name: "cmdb", rows_synced: 0, success: true, error: null, duration_ms: duration };
    }

    const upsertRows = rows
      .filter(r => r.cow_id)
      .map(r => ({
        row_num: r.row_num,
        cow_id: r.cow_id,
        site_label: r.site_label,
        ebu_royal: r.ebu_royal,
        region: r.region,
        district: r.district,
        city: r.city,
        location: r.location,
        latitude: r.latitude,
        longitude: r.longitude,
        site_status: r.site_status,
        vendor: r.vendor,
        last_deploying_date: r.last_deploying_date,
        first_deploying_date: r.first_deploying_date,
        cow_old_new: r.cow_old_new,
        technology: r.technology,
        raw_data: r.raw_data,
        synced_at: new Date().toISOString(),
      }));

    let upserted = 0;
    for (const batch of chunk(upsertRows, 100)) {
      const { error } = await supabase.from("cmdb").upsert(batch, { onConflict: "cow_id" });
      if (error) throw new Error(error.message);
      upserted += batch.length;
    }

    const duration = Date.now() - start;
    await logSync("cmdb", "ok", upserted, null, duration);
    logger.info({ rows: upserted }, "CMDB sync complete");
    return { table_name: "cmdb", rows_synced: upserted, success: true, error: null, duration_ms: duration };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const duration = Date.now() - start;
    await logSync("cmdb", "error", null, msg, duration);
    logger.error({ err }, "CMDB sync failed");
    return { table_name: "cmdb", rows_synced: 0, success: false, error: msg, duration_ms: duration };
  }
}

export async function syncEnergyDashboard(): Promise<TableSyncResult> {
  const start = Date.now();
  try {
    logger.info("Syncing Energy Dashboard...");
    const rows = await fetchEnergyRows();

    if (rows.length === 0) {
      const duration = Date.now() - start;
      await logSync("energy_dashboard", "ok", 0, null, duration);
      return { table_name: "energy_dashboard", rows_synced: 0, success: true, error: null, duration_ms: duration };
    }

    const upsertRows = rows
      .filter(r => r.site)
      .map(r => ({
        row_num: r.row_num,
        site: r.site,
        vendor: r.vendor,
        region_name: r.region_name,
        district_name: r.district_name,
        city_name: r.city_name,
        power_source: r.power_source,
        generator_capacity: r.generator_capacity,
        technology: r.technology,
        cow_status: r.cow_status,
        total_on_air_days: r.total_on_air_days,
        latitude: r.latitude,
        longitude: r.longitude,
        tank_capacity: r.tank_capacity,
        fuel_tank_level_pct: r.fuel_tank_level_pct,
        last_fueling_date: r.last_fueling_date,
        last_fueling_qty: r.last_fueling_qty,
        next_fueling_plan: r.next_fueling_plan,
        raw_data: r.raw_data,
        synced_at: new Date().toISOString(),
      }));

    let upserted = 0;
    for (const batch of chunk(upsertRows, 100)) {
      const { error } = await supabase.from("energy_dashboard").upsert(batch, { onConflict: "site" });
      if (error) throw new Error(error.message);
      upserted += batch.length;
    }

    const duration = Date.now() - start;
    await logSync("energy_dashboard", "ok", upserted, null, duration);
    logger.info({ rows: upserted }, "Energy Dashboard sync complete");
    return { table_name: "energy_dashboard", rows_synced: upserted, success: true, error: null, duration_ms: duration };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const duration = Date.now() - start;
    await logSync("energy_dashboard", "error", null, msg, duration);
    logger.error({ err }, "Energy Dashboard sync failed");
    return { table_name: "energy_dashboard", rows_synced: 0, success: false, error: msg, duration_ms: duration };
  }
}

export async function syncCowMovement(): Promise<TableSyncResult> {
  const start = Date.now();
  try {
    logger.info("Syncing COW Movement History...");
    const rows = await fetchCowMovementRows();

    if (rows.length === 0) {
      const duration = Date.now() - start;
      await logSync("cow_movement", "ok", 0, null, duration);
      return { table_name: "cow_movement", rows_synced: 0, success: true, error: null, duration_ms: duration };
    }

    // Delete all existing and re-insert (movement history)
    const { error: delErr } = await supabase.from("cow_movement").delete().neq("id", 0);
    if (delErr) throw new Error(delErr.message);

    const insertRows = rows
      .filter(r => r.cow_id)
      .map(r => ({
        cow_id: r.cow_id,
        site_label: r.site_label,
        moved_date: r.moved_date,
        moved_month_year: r.moved_month_year,
        from_location: r.from_location,
        to_location: r.to_location,
        from_latitude: r.from_latitude,
        from_longitude: r.from_longitude,
        to_latitude: r.to_latitude,
        to_longitude: r.to_longitude,
        distance: r.distance,
        movement_type: r.movement_type,
        region_from: r.region_from,
        region_to: r.region_to,
        vendor: r.vendor,
        raw_data: r.raw_data,
        synced_at: new Date().toISOString(),
      }));

    let inserted = 0;
    for (const batch of chunk(insertRows, 200)) {
      const { error } = await supabase.from("cow_movement").insert(batch);
      if (error) throw new Error(error.message);
      inserted += batch.length;
    }

    const duration = Date.now() - start;
    await logSync("cow_movement", "ok", inserted, null, duration);
    logger.info({ rows: inserted }, "COW Movement sync complete");
    return { table_name: "cow_movement", rows_synced: inserted, success: true, error: null, duration_ms: duration };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const duration = Date.now() - start;
    await logSync("cow_movement", "error", null, msg, duration);
    logger.error({ err }, "COW Movement sync failed");
    return { table_name: "cow_movement", rows_synced: 0, success: false, error: msg, duration_ms: duration };
  }
}

export async function runFullSync(): Promise<TableSyncResult[]> {
  if (syncRunning) throw new Error("Sync already in progress");
  syncRunning = true;
  try {
    const results = await Promise.all([syncCmdb(), syncEnergyDashboard(), syncCowMovement()]);
    return results;
  } finally {
    syncRunning = false;
  }
}

export async function runSingleSync(table: string): Promise<TableSyncResult> {
  if (syncRunning) throw new Error("Sync already in progress");
  syncRunning = true;
  try {
    switch (table) {
      case "cmdb": return await syncCmdb();
      case "energy_dashboard": return await syncEnergyDashboard();
      case "cow_movement": return await syncCowMovement();
      default: throw new Error(`Unknown table: ${table}`);
    }
  } finally {
    syncRunning = false;
  }
}

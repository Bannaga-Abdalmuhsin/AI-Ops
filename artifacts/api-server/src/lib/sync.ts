import { pool } from "./db.js";
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

/**
 * Build a multi-row INSERT with sequential $N placeholders.
 * Returns the SQL fragment "(col1, col2, ...) VALUES ($1,$2,...),($3,$4,...)" and params array.
 */
function buildMultiInsert(
  columns: string[],
  rows: Record<string, unknown>[],
): { valueSql: string; params: unknown[] } {
  const params: unknown[] = [];
  const valueSets = rows.map((row) => {
    const placeholders = columns.map((col) => {
      params.push(row[col] ?? null);
      return `$${params.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  return {
    valueSql: `(${columns.join(", ")}) VALUES ${valueSets.join(", ")}`,
    params,
  };
}

async function logSync(
  tableName: string,
  status: "ok" | "error",
  rowsSynced: number | null,
  errorMessage: string | null,
  durationMs: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO sync_log (table_name, rows_synced, status, error_message, duration_ms)
     VALUES ($1, $2, $3, $4, $5)`,
    [tableName, rowsSynced, status, errorMessage, durationMs],
  );
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

    const CMDB_COLS = [
      "row_num", "cow_id", "site_label", "ebu_royal", "region", "district",
      "city", "location", "latitude", "longitude", "site_status", "vendor",
      "last_deploying_date", "first_deploying_date", "cow_old_new", "technology",
      "raw_data", "synced_at",
    ];

    const upsertRows = rows
      .filter((r) => r.cow_id)
      .map((r) => ({ ...r, synced_at: new Date().toISOString() }));

    let upserted = 0;
    for (const batch of chunk(upsertRows, 100)) {
      const { valueSql, params } = buildMultiInsert(CMDB_COLS, batch);
      const updateSet = CMDB_COLS.filter((c) => c !== "cow_id")
        .map((c) => `${c} = EXCLUDED.${c}`)
        .join(", ");
      await pool.query(
        `INSERT INTO cmdb ${valueSql} ON CONFLICT (cow_id) DO UPDATE SET ${updateSet}`,
        params,
      );
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

    const ENERGY_COLS = [
      "row_num", "site", "vendor", "region_name", "district_name", "city_name",
      "power_source", "generator_capacity", "technology", "cow_status",
      "total_on_air_days", "latitude", "longitude", "tank_capacity",
      "fuel_tank_level_pct", "last_fueling_date", "last_fueling_qty",
      "next_fueling_plan", "raw_data", "synced_at",
    ];

    const upsertRows = rows
      .filter((r) => r.site)
      .map((r) => ({ ...r, synced_at: new Date().toISOString() }));

    let upserted = 0;
    for (const batch of chunk(upsertRows, 100)) {
      const { valueSql, params } = buildMultiInsert(ENERGY_COLS, batch);
      const updateSet = ENERGY_COLS.filter((c) => c !== "site")
        .map((c) => `${c} = EXCLUDED.${c}`)
        .join(", ");
      await pool.query(
        `INSERT INTO energy_dashboard ${valueSql} ON CONFLICT (site) DO UPDATE SET ${updateSet}`,
        params,
      );
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
  const client = await pool.connect();
  try {
    logger.info("Syncing COW Movement History...");
    const rows = await fetchCowMovementRows();

    if (rows.length === 0) {
      const duration = Date.now() - start;
      await client.query(
        `INSERT INTO sync_log (table_name, rows_synced, status, error_message, duration_ms) VALUES ($1,$2,$3,$4,$5)`,
        ["cow_movement", 0, "ok", null, duration],
      );
      return { table_name: "cow_movement", rows_synced: 0, success: true, error: null, duration_ms: duration };
    }

    const MOVEMENT_COLS = [
      "cow_id", "site_label", "moved_date", "moved_month_year", "from_location",
      "to_location", "from_latitude", "from_longitude", "to_latitude", "to_longitude",
      "distance", "movement_type", "region_from", "region_to", "vendor",
      "raw_data", "synced_at",
    ];

    // Use a single client for DELETE + INSERT + logSync so the connection
    // never goes idle between steps (prevents "connection terminated" on large datasets)
    await client.query("BEGIN");
    await client.query("DELETE FROM cow_movement");

    const insertRows = rows
      .filter((r) => r.cow_id)
      .map((r) => ({ ...r, synced_at: new Date().toISOString() }));

    let inserted = 0;
    for (const batch of chunk(insertRows, 200)) {
      const { valueSql, params } = buildMultiInsert(MOVEMENT_COLS, batch);
      await client.query(`INSERT INTO cow_movement ${valueSql}`, params);
      inserted += batch.length;
    }

    await client.query("COMMIT");

    const duration = Date.now() - start;
    await client.query(
      `INSERT INTO sync_log (table_name, rows_synced, status, error_message, duration_ms) VALUES ($1,$2,$3,$4,$5)`,
      ["cow_movement", inserted, "ok", null, duration],
    );
    logger.info({ rows: inserted }, "COW Movement sync complete");
    return { table_name: "cow_movement", rows_synced: inserted, success: true, error: null, duration_ms: duration };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    const duration = Date.now() - start;
    await client.query(
      `INSERT INTO sync_log (table_name, rows_synced, status, error_message, duration_ms) VALUES ($1,$2,$3,$4,$5)`,
      ["cow_movement", null, "error", msg, duration],
    ).catch(() => {});
    logger.error({ err }, "COW Movement sync failed");
    return { table_name: "cow_movement", rows_synced: 0, success: false, error: msg, duration_ms: duration };
  } finally {
    client.release();
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

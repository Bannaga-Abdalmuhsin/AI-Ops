import { Router, type IRouter } from "express";
import { pool } from "../lib/db.js";
import {
  GetCmdbDataQueryParams,
  GetEnergyDashboardDataQueryParams,
  GetCowMovementDataQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/data/cmdb", async (req, res): Promise<void> => {
  const parsed = GetCmdbDataQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page = 1, limit = 50, search, region, status } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (search) {
    const p = `$${params.length + 1}`;
    conditions.push(
      `(cow_id ILIKE ${p} OR site_label ILIKE ${p} OR location ILIKE ${p} OR city ILIKE ${p})`,
    );
    params.push(`%${search}%`);
  }
  if (region) {
    params.push(region);
    conditions.push(`region = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`site_status = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const { rows } = await pool.query(
    `SELECT id, row_num, cow_id, site_label, ebu_royal, region, district, city, location,
            latitude, longitude, site_status, vendor, last_deploying_date, first_deploying_date,
            cow_old_new, technology, synced_at,
            COUNT(*) OVER() AS _total
     FROM cmdb
     ${where}
     ORDER BY row_num ASC NULLS LAST
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params,
  );

  const total = rows.length > 0 ? parseInt(rows[0]._total as string, 10) : 0;
  const data = rows.map(({ _total: _, ...r }) => r);
  res.json({ data, total, page, limit });
});

router.get("/data/energy-dashboard", async (req, res): Promise<void> => {
  const parsed = GetEnergyDashboardDataQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page = 1, limit = 50, search, status } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (search) {
    const p = `$${params.length + 1}`;
    conditions.push(`(site ILIKE ${p} OR region_name ILIKE ${p} OR city_name ILIKE ${p})`);
    params.push(`%${search}%`);
  }
  if (status) {
    params.push(status);
    conditions.push(`cow_status = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const { rows } = await pool.query(
    `SELECT id, row_num, site, vendor, region_name, district_name, city_name, power_source,
            generator_capacity, technology, cow_status, total_on_air_days, latitude, longitude,
            tank_capacity, fuel_tank_level_pct, last_fueling_date, last_fueling_qty,
            next_fueling_plan, synced_at,
            COUNT(*) OVER() AS _total
     FROM energy_dashboard
     ${where}
     ORDER BY row_num ASC NULLS LAST
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params,
  );

  const total = rows.length > 0 ? parseInt(rows[0]._total as string, 10) : 0;
  const data = rows.map(({ _total: _, ...r }) => r);
  res.json({ data, total, page, limit });
});

router.get("/data/cow-movement", async (req, res): Promise<void> => {
  const parsed = GetCowMovementDataQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page = 1, limit = 50, search, cow_id } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (search) {
    const p = `$${params.length + 1}`;
    conditions.push(
      `(cow_id ILIKE ${p} OR from_location ILIKE ${p} OR to_location ILIKE ${p})`,
    );
    params.push(`%${search}%`);
  }
  if (cow_id) {
    params.push(cow_id);
    conditions.push(`cow_id = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const { rows } = await pool.query(
    `SELECT id, cow_id, site_label, moved_date, moved_month_year, from_location, to_location,
            from_latitude, from_longitude, to_latitude, to_longitude, distance, movement_type,
            region_from, region_to, vendor, synced_at,
            COUNT(*) OVER() AS _total
     FROM cow_movement
     ${where}
     ORDER BY id DESC
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params,
  );

  const total = rows.length > 0 ? parseInt(rows[0]._total as string, 10) : 0;
  const data = rows.map(({ _total: _, ...r }) => r);
  res.json({ data, total, page, limit });
});

export default router;

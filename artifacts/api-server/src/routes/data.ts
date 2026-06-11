import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
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
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from("cmdb")
    .select(
      "id, row_num, cow_id, site_label, ebu_royal, region, district, city, location, latitude, longitude, site_status, vendor, last_deploying_date, first_deploying_date, cow_old_new, technology, synced_at",
      { count: "exact" }
    )
    .order("row_num", { ascending: true, nullsFirst: false });

  if (search) {
    query = query.or(
      `cow_id.ilike.%${search}%,site_label.ilike.%${search}%,location.ilike.%${search}%,city.ilike.%${search}%`
    );
  }
  if (region) query = query.eq("region", region);
  if (status) query = query.eq("site_status", status);

  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ data: data ?? [], total: count ?? 0, page, limit });
});

router.get("/data/energy-dashboard", async (req, res): Promise<void> => {
  const parsed = GetEnergyDashboardDataQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page = 1, limit = 50, search, status } = parsed.data;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from("energy_dashboard")
    .select(
      "id, row_num, site, vendor, region_name, district_name, city_name, power_source, generator_capacity, technology, cow_status, total_on_air_days, latitude, longitude, tank_capacity, fuel_tank_level_pct, last_fueling_date, last_fueling_qty, next_fueling_plan, synced_at",
      { count: "exact" }
    )
    .order("row_num", { ascending: true, nullsFirst: false });

  if (search) {
    query = query.or(
      `site.ilike.%${search}%,region_name.ilike.%${search}%,city_name.ilike.%${search}%`
    );
  }
  if (status) query = query.eq("cow_status", status);

  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ data: data ?? [], total: count ?? 0, page, limit });
});

router.get("/data/cow-movement", async (req, res): Promise<void> => {
  const parsed = GetCowMovementDataQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page = 1, limit = 50, search, cow_id } = parsed.data;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from("cow_movement")
    .select(
      "id, cow_id, site_label, moved_date, moved_month_year, from_location, to_location, from_latitude, from_longitude, to_latitude, to_longitude, distance, movement_type, region_from, region_to, vendor, synced_at",
      { count: "exact" }
    )
    .order("id", { ascending: false });

  if (search) {
    query = query.or(
      `cow_id.ilike.%${search}%,from_location.ilike.%${search}%,to_location.ilike.%${search}%`
    );
  }
  if (cow_id) query = query.eq("cow_id", cow_id);

  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ data: data ?? [], total: count ?? 0, page, limit });
});

export default router;

-- Run this in your Supabase project's SQL Editor
-- Dashboard: https://supabase.com/dashboard/project/oawgfzgfufzyebowxlpx/sql

CREATE TABLE IF NOT EXISTS cmdb (
  id BIGSERIAL PRIMARY KEY,
  row_num INT,
  cow_id TEXT,
  site_label TEXT,
  ebu_royal TEXT,
  region TEXT,
  district TEXT,
  city TEXT,
  location TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  site_status TEXT,
  vendor TEXT,
  last_deploying_date TEXT,
  first_deploying_date TEXT,
  cow_old_new TEXT,
  technology TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cow_id)
);

CREATE TABLE IF NOT EXISTS energy_dashboard (
  id BIGSERIAL PRIMARY KEY,
  row_num INT,
  site TEXT,
  vendor TEXT,
  region_name TEXT,
  district_name TEXT,
  city_name TEXT,
  power_source TEXT,
  generator_capacity TEXT,
  technology TEXT,
  cow_status TEXT,
  total_on_air_days NUMERIC,
  latitude NUMERIC,
  longitude NUMERIC,
  tank_capacity NUMERIC,
  fuel_tank_level_pct TEXT,
  last_fueling_date TEXT,
  last_fueling_qty NUMERIC,
  next_fueling_plan TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(site)
);

CREATE TABLE IF NOT EXISTS cow_movement (
  id BIGSERIAL PRIMARY KEY,
  cow_id TEXT,
  site_label TEXT,
  moved_date TEXT,
  moved_month_year TEXT,
  from_location TEXT,
  to_location TEXT,
  from_latitude NUMERIC,
  from_longitude NUMERIC,
  to_latitude NUMERIC,
  to_longitude NUMERIC,
  distance NUMERIC,
  movement_type TEXT,
  region_from TEXT,
  region_to TEXT,
  vendor TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  rows_synced INT,
  status TEXT NOT NULL,
  error_message TEXT,
  duration_ms INT,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

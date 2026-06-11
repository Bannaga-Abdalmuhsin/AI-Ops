import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

const SHEET1_ID = "1uWbVwsJ6mgUl9WxJz-zbxMaiCW-dG3DI_9gvKkEca18";
const SHEET2_ID = "1bzcG70TopGRRm60NbKX4o3SCE2-QRUDFnY0Z4fYSjEM";

async function readRange(spreadsheetId: string, range: string): Promise<string[][]> {
  const res = await connectors.proxy(
    "google-sheet",
    `/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { method: "GET" }
  );
  const data = (await res.json()) as { values?: string[][] };
  return data.values ?? [];
}

function toFloat(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v.replace(/[,%]/g, ""));
  return isNaN(n) ? null : n;
}

function toInt(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

export interface CmdbRow {
  row_num: number | null;
  cow_id: string | null;
  site_label: string | null;
  ebu_royal: string | null;
  region: string | null;
  district: string | null;
  city: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  site_status: string | null;
  vendor: string | null;
  last_deploying_date: string | null;
  first_deploying_date: string | null;
  cow_old_new: string | null;
  technology: string | null;
  raw_data: Record<string, string>;
}

export interface EnergyRow {
  row_num: number | null;
  site: string | null;
  vendor: string | null;
  region_name: string | null;
  district_name: string | null;
  city_name: string | null;
  power_source: string | null;
  generator_capacity: string | null;
  technology: string | null;
  cow_status: string | null;
  total_on_air_days: number | null;
  latitude: number | null;
  longitude: number | null;
  tank_capacity: number | null;
  fuel_tank_level_pct: string | null;
  last_fueling_date: string | null;
  last_fueling_qty: number | null;
  next_fueling_plan: string | null;
  raw_data: Record<string, string>;
}

export interface CowMovementRow {
  cow_id: string | null;
  site_label: string | null;
  moved_date: string | null;
  moved_month_year: string | null;
  from_location: string | null;
  to_location: string | null;
  from_latitude: number | null;
  from_longitude: number | null;
  to_latitude: number | null;
  to_longitude: number | null;
  distance: number | null;
  movement_type: string | null;
  region_from: string | null;
  region_to: string | null;
  vendor: string | null;
  raw_data: Record<string, string>;
}

export async function fetchCmdbRows(): Promise<CmdbRow[]> {
  // Row 3 = headers, Row 4+ = data (up to 704 rows)
  const data = await readRange(SHEET1_ID, "Mastersheet Data Base!A3:DQ704");
  if (data.length < 2) return [];

  const headers = data[0];
  const rows = data.slice(1);

  return rows
    .filter(row => row[1]) // must have COW ID
    .map((row, i) => {
      const raw: Record<string, string> = {};
      headers.forEach((h, idx) => {
        if (h && row[idx]) raw[h] = row[idx];
      });
      return {
        row_num: toInt(row[0]),
        cow_id: row[1] || null,
        site_label: row[2] || null,
        ebu_royal: row[3] || null,
        region: row[4] || null,
        district: row[5] || null,
        city: row[6] || null,
        location: row[8] || null,
        latitude: toFloat(row[9]),
        longitude: toFloat(row[10]),
        site_status: row[11] || null,
        last_deploying_date: row[12] || null,
        first_deploying_date: row[14] || null,
        cow_old_new: row[15] || null,
        vendor: row[16] || null,
        technology: row[26] || null,
        raw_data: raw,
      };
    });
}

export async function fetchEnergyRows(): Promise<EnergyRow[]> {
  // Row 1 = headers, Row 2+ = data (up to 984 rows)
  const data = await readRange(SHEET1_ID, "Energy Dashboard!A1:AK984");
  if (data.length < 2) return [];

  const headers = data[0];
  const rows = data.slice(1);

  return rows
    .filter(row => row[1]) // must have Site
    .map(row => {
      const raw: Record<string, string> = {};
      headers.forEach((h, idx) => {
        if (h && row[idx]) raw[h] = row[idx];
      });
      return {
        row_num: toInt(row[0]),
        site: row[1] || null,
        vendor: row[2] || null,
        region_name: row[3] || null,
        district_name: row[4] || null,
        city_name: row[5] || null,
        power_source: row[6] || null,
        generator_capacity: row[7] || null,
        technology: row[8] || null,
        cow_status: row[9] || null,
        total_on_air_days: toFloat(row[10]),
        latitude: toFloat(row[11]),
        longitude: toFloat(row[12]),
        tank_capacity: toFloat(row[16]),
        fuel_tank_level_pct: row[24] || null,
        last_fueling_date: row[30] || null,
        last_fueling_qty: toFloat(row[31]),
        next_fueling_plan: row[35] || null,
        raw_data: raw,
      };
    });
}

export async function fetchCowMovementRows(): Promise<CowMovementRow[]> {
  // Row 1 = headers, Row 2+ = data (up to 2534 rows)
  const data = await readRange(SHEET2_ID, "Movement-Data!A1:AE2534");
  if (data.length < 2) return [];

  const headers = data[0];
  const rows = data.slice(1);

  return rows
    .filter(row => row[0]) // must have COW ID
    .map(row => {
      const raw: Record<string, string> = {};
      headers.forEach((h, idx) => {
        if (h && row[idx]) raw[h] = row[idx];
      });
      return {
        cow_id: row[0] || null,
        site_label: row[1] || null,
        moved_date: row[12] || null,
        moved_month_year: row[13] || null,
        from_location: row[16] || null,
        to_location: row[20] || null,
        from_latitude: toFloat(row[18]),
        from_longitude: toFloat(row[19]),
        to_latitude: toFloat(row[22]),
        to_longitude: toFloat(row[23]),
        distance: toFloat(row[24]),
        movement_type: row[25] || null,
        region_from: row[26] || null,
        region_to: row[27] || null,
        vendor: row[28] || null,
        raw_data: raw,
      };
    });
}

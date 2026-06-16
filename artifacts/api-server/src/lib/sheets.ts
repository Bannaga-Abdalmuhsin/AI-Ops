import { google, type sheets_v4 } from "googleapis";
import { ReplitConnectors } from "@replit/connectors-sdk";

const SHEET1_ID = "1uWbVwsJ6mgUl9WxJz-zbxMaiCW-dG3DI_9gvKkEca18";
const SHEET2_ID = "1bzcG70TopGRRm60NbKX4o3SCE2-QRUDFnY0Z4fYSjEM";

// ── Auth selection ────────────────────────────────────────────────────────────
// Priority: GOOGLE_SERVICE_ACCOUNT_JSON env var
//   → Works everywhere: Railway, Render, any VPS, and Replit.
//   → Set this and the connector path becomes inactive.
// Fallback: @replit/connectors-sdk OAuth proxy
//   → Replit-hosted deployments only (no service account key needed there).
// ─────────────────────────────────────────────────────────────────────────────

// undefined = not yet initialised; null = no service account configured
let _sheetsClient: sheets_v4.Sheets | null | undefined = undefined;

function getSheetsClient(): sheets_v4.Sheets | null {
  if (_sheetsClient !== undefined) return _sheetsClient;
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    _sheetsClient = null;
    return null;
  }
  const credentials = JSON.parse(saJson) as object;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  _sheetsClient = google.sheets({ version: "v4", auth });
  return _sheetsClient;
}

// Lazy Replit connector — only instantiated when service account is absent
let _connectors: ReplitConnectors | null = null;

async function readRange(spreadsheetId: string, range: string): Promise<string[][]> {
  const client = getSheetsClient();

  if (client) {
    // googleapis path — portable, works on any host
    const res = await client.spreadsheets.values.get({ spreadsheetId, range });
    return (res.data.values as string[][] | null | undefined) ?? [];
  }

  // Replit connector OAuth proxy — fallback for Replit-hosted deployments
  if (!_connectors) _connectors = new ReplitConnectors();
  const res = await _connectors.proxy(
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
    .map((row) => {
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
  // "COW Movement tracker" sheet — row 1 = headers, row 2+ = data (up to 2756 rows)
  // Column mapping (0-indexed):
  //  A=0  COWs ID         B=1  Planned          C=2  Moved Date/Time
  //  D=3  Reached Date    E=4  From Location    F=5  From Latitude
  //  G=6  From Longitude  H=7  Category         I=8  To Location
  //  J=9  Event name      K=10 Sub location     L=11 To Latitude
  //  M=12 To Longitude    N=13 Admin Region     O=14 Distance
  //  P=15 Radius          Q=16 Movement type    R=17 Region from
  //  S=18 Region to       T=19 City/District    U=20 Vendor
  //  V=21 Priority        W=22 Cancelled        X=23 Month
  //
  // Fetch in two batches to stay under response-body limits.
  // Sheet currently has ~2918 rows; upper bound set to 3100 for headroom.
  const [part1, part2] = await Promise.all([
    readRange(SHEET2_ID, "COW Movement tracker!A1:X1400"),   // header + rows 1–1399
    readRange(SHEET2_ID, "COW Movement tracker!A1401:X3100"), // rows 1400–3100 (no header)
  ]);
  if (part1.length < 2) return [];

  const headers = part1[0];
  const rows = [...part1.slice(1), ...part2];

  return rows
    .filter(row => row[0]) // must have COW ID
    .map(row => {
      const raw: Record<string, string> = {};
      headers.forEach((h, idx) => {
        if (h && row[idx]) raw[h] = row[idx];
      });
      return {
        cow_id: row[0] || null,
        site_label: null,              // not present in new sheet
        moved_date: row[2] || null,    // C: Moved Date/Time
        moved_month_year: row[23] || null, // X: Month
        from_location: row[4] || null, // E: From Location
        to_location: row[8] || null,   // I: To Location
        from_latitude: toFloat(row[5]),  // F
        from_longitude: toFloat(row[6]), // G
        to_latitude: toFloat(row[11]),   // L
        to_longitude: toFloat(row[12]),  // M
        distance: toFloat(row[14]),      // O: Distance
        movement_type: row[16] || null,  // Q: Movement type
        region_from: row[17] || null,    // R: Region from
        region_to: row[18] || null,      // S: Region to
        vendor: row[20] || null,         // U: Vendor
        raw_data: raw,
      };
    });
}

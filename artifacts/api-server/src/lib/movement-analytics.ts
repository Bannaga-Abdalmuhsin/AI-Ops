// Pure analytics functions for COW movement data.
// Adapted from stc-cow/movement-analysis — uses our snake_case Supabase schema.

export interface Movement {
  cow_id: string;
  moved_date: string;
  from_location?: string;
  to_location?: string;
  movement_type?: string;
  distance?: number;
  region_from?: string;
  region_to?: string;
  vendor?: string;
}

export interface WarehouseIdleResult {
  warehouse: string;
  totalCows: number;
  totalIdleDays: number;
  avgIdleDays: number;
}

export interface AgingBucket {
  bucket: string;
  count: number;
  cows: string[];
}

export interface TopDestination {
  location: string;
  movementCount: number;
  uniqueCows: number;
}

function isWarehouse(location: string): boolean {
  const u = location.toUpperCase();
  return u.includes("WH") || u.includes("WAREHOUSE") || u.includes("DEPOT");
}

// Average days COWs sit idle at each warehouse between consecutive movements.
export function analyzeWarehouseIdle(
  movements: Movement[]
): WarehouseIdleResult[] {
  const byCow = new Map<string, Movement[]>();
  for (const m of movements) {
    if (!byCow.has(m.cow_id)) byCow.set(m.cow_id, []);
    byCow.get(m.cow_id)!.push(m);
  }

  const stats = new Map<string, { totalIdleDays: number; cows: Set<string> }>();

  byCow.forEach((cowMoves, cowId) => {
    const sorted = [...cowMoves].sort(
      (a, b) =>
        new Date(a.moved_date).getTime() - new Date(b.moved_date).getTime()
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      const wh = sorted[i].to_location ?? "";
      if (!isWarehouse(wh)) continue;
      const idleDays =
        (new Date(sorted[i + 1].moved_date).getTime() -
          new Date(sorted[i].moved_date).getTime()) /
        86_400_000;
      if (idleDays <= 0) continue;
      if (!stats.has(wh)) stats.set(wh, { totalIdleDays: 0, cows: new Set() });
      const s = stats.get(wh)!;
      s.totalIdleDays += idleDays;
      s.cows.add(cowId);
    }
  });

  return Array.from(stats.entries())
    .map(([warehouse, s]) => ({
      warehouse,
      totalCows: s.cows.size,
      totalIdleDays: Math.round(s.totalIdleDays),
      avgIdleDays:
        s.cows.size > 0 ? Math.round(s.totalIdleDays / s.cows.size) : 0,
    }))
    .sort((a, b) => b.avgIdleDays - a.avgIdleDays);
}

// Bucket COWs by total warehouse idle time (Half/Zero movement types only).
export function getWarehouseAgingBuckets(movements: Movement[]): AgingBucket[] {
  const offAir = movements.filter(
    (m) => m.movement_type === "Half" || m.movement_type === "Zero"
  );

  const byCow = new Map<string, Movement[]>();
  for (const m of offAir) {
    if (!byCow.has(m.cow_id)) byCow.set(m.cow_id, []);
    byCow.get(m.cow_id)!.push(m);
  }

  const cowIdleMonths = new Map<string, number>();
  byCow.forEach((cowMoves, cowId) => {
    const sorted = [...cowMoves].sort(
      (a, b) =>
        new Date(a.moved_date).getTime() - new Date(b.moved_date).getTime()
    );
    let totalIdleDays = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (!isWarehouse(sorted[i].to_location ?? "")) continue;
      const d =
        (new Date(sorted[i + 1].moved_date).getTime() -
          new Date(sorted[i].moved_date).getTime()) /
        86_400_000;
      if (d > 0) totalIdleDays += d;
    }
    const months = totalIdleDays / 30;
    if (months > 0) cowIdleMonths.set(cowId, months);
  });

  const buckets: AgingBucket[] = [
    { bucket: "0–3 Months", count: 0, cows: [] },
    { bucket: "4–6 Months", count: 0, cows: [] },
    { bucket: "7–9 Months", count: 0, cows: [] },
    { bucket: "10–12 Months", count: 0, cows: [] },
    { bucket: "More than 12 Months", count: 0, cows: [] },
  ];

  cowIdleMonths.forEach((months, cowId) => {
    const idx =
      months <= 3 ? 0 : months <= 6 ? 1 : months <= 9 ? 2 : months <= 12 ? 3 : 4;
    buckets[idx].cows.push(cowId);
  });
  buckets.forEach((b) => (b.count = b.cows.length));
  return buckets;
}

// Top deployment destination locations ranked by movement count.
export function getTopDestinations(
  movements: Movement[],
  limit = 15
): TopDestination[] {
  const stats = new Map<string, { count: number; cows: Set<string> }>();
  for (const m of movements) {
    const loc = (m.to_location ?? "").trim();
    if (!loc || loc.toUpperCase() === "#N/A") continue;
    if (!stats.has(loc)) stats.set(loc, { count: 0, cows: new Set() });
    const s = stats.get(loc)!;
    s.count++;
    s.cows.add(m.cow_id);
  }
  return Array.from(stats.entries())
    .map(([location, s]) => ({
      location,
      movementCount: s.count,
      uniqueCows: s.cows.size,
    }))
    .sort((a, b) => b.movementCount - a.movementCount)
    .slice(0, limit);
}

// COWs present in CMDB that have no movement records at all.
export function getNeverMovedCows(
  cmdbCowIds: string[],
  movedCowIds: Set<string>
): string[] {
  return cmdbCowIds.filter((id) => !movedCowIds.has(id));
}

import { useState, useMemo } from "react";
import { useGetCmdbData } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, ChevronLeft, ChevronRight, Filter, X, XCircle } from "lucide-react";

type CmdbRow = {
  id?: number | string;
  cow_id?: string;
  site_status?: string;
  site_label?: string;
  region?: string;
  district?: string;
  city?: string;
  location?: string;
  vendor?: string;
  technology?: string;
  latitude?: number | string;
  longitude?: number | string;
  first_deploying_date?: string;
  last_deploying_date?: string;
};

type FilterKey = "site_status" | "region" | "vendor" | "site_label";

const FILTER_COLS: { key: FilterKey; label: string }[] = [
  { key: "site_status", label: "Status" },
  { key: "site_label",  label: "Site Label" },
  { key: "region",      label: "Region" },
  { key: "vendor",      label: "Vendor" },
];

const PAGE_SIZE = 20;

function statusClass(status?: string) {
  const s = status?.toLowerCase().replace(/[\s-]/g, "") ?? "";
  if (s === "onair")       return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
  if (s === "dismantled")  return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
  return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
}

function ColFilter({
  col,
  label,
  values,
  active,
  onSet,
  onClear,
}: {
  col: FilterKey;
  label: string;
  values: string[];
  active?: string;
  onSet: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <TableHead className="p-0 font-mono text-xs whitespace-nowrap">
      <Popover>
        <PopoverTrigger asChild>
          <button
            className={`flex items-center gap-1.5 px-3 py-3 w-full h-full hover:bg-muted/70 transition-colors ${active ? "text-primary" : ""}`}
          >
            <span>{label}</span>
            <Filter className={`h-3 w-3 flex-shrink-0 ${active ? "fill-primary text-primary" : "text-muted-foreground"}`} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-52 p-1.5" align="start">
          <div className="mb-1 px-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
          </div>
          {active && (
            <button
              onClick={onClear}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 w-full rounded hover:bg-muted"
            >
              <XCircle className="h-3.5 w-3.5" /> Clear filter
            </button>
          )}
          <div className="max-h-64 overflow-y-auto space-y-0.5 mt-1">
            {values.map((v) => (
              <button
                key={v}
                onClick={() => onSet(v)}
                className={`text-xs font-mono w-full text-left px-2 py-1.5 rounded transition-colors ${
                  active === v
                    ? "bg-primary/10 text-primary font-semibold"
                    : "hover:bg-muted text-foreground"
                }`}
              >
                {v}
              </button>
            ))}
            {values.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-1">No values</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </TableHead>
  );
}

export default function Cmdb() {
  const [search, setSearch]               = useState("");
  const [filters, setFilters]             = useState<Partial<Record<FilterKey, string>>>({});
  const [page, setPage]                   = useState(1);

  const { data, isLoading } = useGetCmdbData(
    { page: 1, limit: 1000 },
    { query: { staleTime: 5 * 60 * 1000, placeholderData: (previousData) => previousData } }
  );

  const allRows = (data?.data ?? []) as CmdbRow[];

  const uniqueValues = useMemo(() => {
    const out = {} as Record<FilterKey, string[]>;
    for (const col of FILTER_COLS) {
      out[col.key] = [...new Set(allRows.map((r) => r[col.key]).filter(Boolean) as string[])].sort();
    }
    return out;
  }, [allRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (q) {
        const hit = [row.cow_id, row.site_label, row.vendor, row.location, row.region, row.city, row.district]
          .some((v) => v?.toLowerCase().includes(q));
        if (!hit) return false;
      }
      for (const [key, val] of Object.entries(filters) as [FilterKey, string][]) {
        if (val && row[key] !== val) return false;
      }
      return true;
    });
  }, [allRows, search, filters]);

  const pageCount  = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage   = Math.min(page, pageCount);
  const pagedRows  = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const setFilter = (col: FilterKey, val: string) => {
    setFilters((f) => f[col] === val ? (() => { const n = { ...f }; delete n[col]; return n; })() : { ...f, [col]: val });
    setPage(1);
  };

  const clearFilter = (col: FilterKey) => {
    setFilters((f) => { const n = { ...f }; delete n[col]; return n; });
    setPage(1);
  };

  const clearAll = () => { setFilters({}); setSearch(""); setPage(1); };

  const activeCount = Object.keys(filters).length;

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">CMDB Repository</h1>
        <span className="text-sm text-muted-foreground font-mono">
          {filteredRows.length} / {allRows.length} rows
        </span>
      </div>

      <Card className="border-border">
        <CardHeader className="py-3 border-b border-border bg-card">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="relative w-full sm:w-72 flex-shrink-0">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search COW ID, Label, Location…"
                className="pl-9 font-mono text-sm"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>

            {activeCount > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center">
                {(Object.entries(filters) as [FilterKey, string][]).map(([col, val]) => (
                  <Badge key={col} variant="secondary" className="font-mono text-xs gap-1 pr-1">
                    <span className="text-muted-foreground capitalize">{col.replace("_", " ")}:</span>
                    <span>{val}</span>
                    <button onClick={() => clearFilter(col)} className="ml-0.5 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground underline">
                  Clear all
                </button>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-mono text-xs whitespace-nowrap px-3">COW ID</TableHead>
                  {FILTER_COLS.map(({ key, label }) => (
                    <ColFilter
                      key={key}
                      col={key}
                      label={label}
                      values={uniqueValues[key] ?? []}
                      active={filters[key]}
                      onSet={(v) => setFilter(key, v)}
                      onClear={() => clearFilter(key)}
                    />
                  ))}
                  <TableHead className="font-mono text-xs whitespace-nowrap px-3">Location</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && !data ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center font-mono text-muted-foreground">
                      Loading data…
                    </TableCell>
                  </TableRow>
                ) : pagedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center font-mono text-muted-foreground">
                      No records match.{" "}
                      {(activeCount > 0 || search) && (
                        <button onClick={clearAll} className="underline hover:text-foreground">Clear filters</button>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedRows.map((row, i) => (
                    <TableRow key={row.id ?? i} className="font-mono text-sm">
                      <TableCell className="font-medium px-3">{row.cow_id || "-"}</TableCell>

                      <TableCell className="px-3">
                        <button
                          title="Click to filter by this status"
                          onClick={() => row.site_status && setFilter("site_status", row.site_status)}
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium hover:ring-1 hover:ring-ring cursor-pointer ${statusClass(row.site_status)}`}
                        >
                          {row.site_status || "UNKNOWN"}
                        </button>
                      </TableCell>

                      <TableCell
                        className="px-3 cursor-pointer hover:text-primary transition-colors"
                        title="Click to filter by this label"
                        onClick={() => row.site_label && setFilter("site_label", row.site_label)}
                      >
                        {row.site_label || "-"}
                      </TableCell>

                      <TableCell
                        className="px-3 cursor-pointer hover:text-primary transition-colors"
                        title="Click to filter by this region"
                        onClick={() => row.region && setFilter("region", row.region)}
                      >
                        {row.region || "-"}
                      </TableCell>

                      <TableCell
                        className="px-3 cursor-pointer hover:text-primary transition-colors"
                        title="Click to filter by this vendor"
                        onClick={() => row.vendor && setFilter("vendor", row.vendor)}
                      >
                        {row.vendor || "-"}
                      </TableCell>

                      <TableCell className="px-3 max-w-[220px] truncate" title={row.location || ""}>
                        {row.location || "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <div className="text-xs text-muted-foreground font-mono">
              {filteredRows.length > 0
                ? `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filteredRows.length)} of ${filteredRows.length}`
                : "0 results"}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline" size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1 || isLoading}
                className="font-mono text-xs h-8"
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> PREV
              </Button>
              <span className="text-xs font-mono text-muted-foreground">
                {safePage} / {pageCount}
              </span>
              <Button
                variant="outline" size="sm"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={safePage >= pageCount || isLoading}
                className="font-mono text-xs h-8"
              >
                NEXT <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

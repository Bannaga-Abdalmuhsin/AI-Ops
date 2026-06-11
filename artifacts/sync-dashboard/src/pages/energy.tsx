import { useState } from "react";
import { useGetEnergyDashboardData, getGetEnergyDashboardDataQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";

export default function Energy() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);

  const { data, isLoading } = useGetEnergyDashboardData(
    { page, limit: 20, search: debouncedSearch || undefined },
    { query: { queryKey: getGetEnergyDashboardDataQueryKey({ page, limit: 20, search: debouncedSearch || undefined }), keepPreviousData: true } }
  );

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Energy Dashboard</h1>
      </div>

      <Card className="border-border">
        <CardHeader className="py-4 border-b border-border bg-card">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search Site, Region, Vendor..."
                className="pl-9 font-mono text-sm"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-mono text-xs whitespace-nowrap">Site</TableHead>
                  <TableHead className="font-mono text-xs whitespace-nowrap">Status</TableHead>
                  <TableHead className="font-mono text-xs whitespace-nowrap">Region</TableHead>
                  <TableHead className="font-mono text-xs whitespace-nowrap">Tank Level %</TableHead>
                  <TableHead className="font-mono text-xs whitespace-nowrap">Last Fueling</TableHead>
                  <TableHead className="font-mono text-xs whitespace-nowrap">Next Plan</TableHead>
                  <TableHead className="font-mono text-xs whitespace-nowrap">Vendor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && !data ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center font-mono text-muted-foreground">
                      Loading data...
                    </TableCell>
                  </TableRow>
                ) : data?.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center font-mono text-muted-foreground">
                      No records found.
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.data.map((row) => (
                    <TableRow key={row.id} className="font-mono text-sm">
                      <TableCell className="font-medium">{row.site || '-'}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground">
                          {row.cow_status || 'UNKNOWN'}
                        </span>
                      </TableCell>
                      <TableCell>{row.region_name || '-'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${
                            Number(row.fuel_tank_level_pct?.replace('%', '')) < 30 ? 'text-destructive' : ''
                          }`}>
                            {row.fuel_tank_level_pct || '-'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{row.last_fueling_date || '-'}</TableCell>
                      <TableCell>{row.next_fueling_plan || '-'}</TableCell>
                      <TableCell>{row.vendor || '-'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <div className="text-xs text-muted-foreground font-mono">
              {data ? `Showing ${(page - 1) * 20 + 1} to ${Math.min(page * 20, data.total)} of ${data.total}` : '---'}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1 || isLoading}
                className="font-mono text-xs h-8"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                PREV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={!data || page >= Math.ceil(data.total / 20) || isLoading}
                className="font-mono text-xs h-8"
              >
                NEXT
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

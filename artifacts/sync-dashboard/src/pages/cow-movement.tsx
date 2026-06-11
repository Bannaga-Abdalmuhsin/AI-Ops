import { useState } from "react";
import { useGetCowMovementData, getGetCowMovementDataQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";

export default function CowMovement() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);

  const { data, isLoading } = useGetCowMovementData(
    { page, limit: 20, search: debouncedSearch || undefined },
    { query: { queryKey: getGetCowMovementDataQueryKey({ page, limit: 20, search: debouncedSearch || undefined }), keepPreviousData: true } }
  );

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Movement History</h1>
      </div>

      <Card className="border-border">
        <CardHeader className="py-4 border-b border-border bg-card">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search COW ID, Location..."
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
                  <TableHead className="font-mono text-xs whitespace-nowrap">COW ID</TableHead>
                  <TableHead className="font-mono text-xs whitespace-nowrap">Date</TableHead>
                  <TableHead className="font-mono text-xs whitespace-nowrap">Route</TableHead>
                  <TableHead className="font-mono text-xs whitespace-nowrap">Type</TableHead>
                  <TableHead className="font-mono text-xs whitespace-nowrap">Dist (km)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && !data ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center font-mono text-muted-foreground">
                      Loading data...
                    </TableCell>
                  </TableRow>
                ) : data?.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center font-mono text-muted-foreground">
                      No records found.
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.data.map((row) => (
                    <TableRow key={row.id} className="font-mono text-sm">
                      <TableCell className="font-medium">{row.cow_id || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.moved_date || '-'}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground w-8">From:</span>
                            <span className="font-medium truncate max-w-[200px]" title={row.from_location || ''}>{row.from_location || '-'}</span>
                            <span className="text-muted-foreground">({row.region_from || '-'})</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground w-8">To:</span>
                            <span className="font-medium truncate max-w-[200px]" title={row.to_location || ''}>{row.to_location || '-'}</span>
                            <span className="text-muted-foreground">({row.region_to || '-'})</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground border border-border">
                          {row.movement_type || 'UNKNOWN'}
                        </span>
                      </TableCell>
                      <TableCell>{row.distance ? row.distance.toFixed(1) : '-'}</TableCell>
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

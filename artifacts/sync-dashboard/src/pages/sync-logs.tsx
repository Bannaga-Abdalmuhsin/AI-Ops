import { useState } from "react";
import { useGetSyncLogs, getGetSyncLogsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { format } from "date-fns";

export default function SyncLogs() {
  const [tableFilter, setTableFilter] = useState<string>("all");

  const { data: logs, isLoading } = useGetSyncLogs(
    { limit: 100, table: tableFilter !== "all" ? tableFilter : undefined },
    { query: { queryKey: getGetSyncLogsQueryKey({ limit: 100, table: tableFilter !== "all" ? tableFilter : undefined }) } }
  );

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Sync Execution Logs</h1>
      </div>

      <Card className="border-border">
        <CardHeader className="py-4 border-b border-border bg-card">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
            <div className="w-full sm:w-64">
              <Select value={tableFilter} onValueChange={setTableFilter}>
                <SelectTrigger className="font-mono text-sm">
                  <SelectValue placeholder="Filter by Table" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ALL TABLES</SelectItem>
                  <SelectItem value="cmdb">CMDB</SelectItem>
                  <SelectItem value="energy_dashboard">ENERGY DASHBOARD</SelectItem>
                  <SelectItem value="cow_movement">COW MOVEMENT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              Showing last 100 executions
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-mono text-xs whitespace-nowrap">Timestamp</TableHead>
                  <TableHead className="font-mono text-xs whitespace-nowrap">Table</TableHead>
                  <TableHead className="font-mono text-xs whitespace-nowrap">Status</TableHead>
                  <TableHead className="font-mono text-xs whitespace-nowrap">Rows</TableHead>
                  <TableHead className="font-mono text-xs whitespace-nowrap">Duration</TableHead>
                  <TableHead className="font-mono text-xs whitespace-nowrap w-1/3">Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center font-mono text-muted-foreground">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
                      Loading logs...
                    </TableCell>
                  </TableRow>
                ) : !logs || logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center font-mono text-muted-foreground">
                      No logs found.
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id} className="font-mono text-sm">
                      <TableCell className="whitespace-nowrap">
                        {format(new Date(log.synced_at), "yyyy-MM-dd HH:mm:ss")}
                      </TableCell>
                      <TableCell className="font-medium">{log.table_name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {log.status === 'ok' ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-destructive" />
                          )}
                          <span className={log.status === 'error' ? 'text-destructive font-bold' : ''}>
                            {log.status.toUpperCase()}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{log.rows_synced !== null ? log.rows_synced : '-'}</TableCell>
                      <TableCell>{log.duration_ms ? `${(log.duration_ms / 1000).toFixed(2)}s` : '-'}</TableCell>
                      <TableCell className="max-w-[400px]">
                        {log.error_message ? (
                          <span className="text-destructive truncate block" title={log.error_message}>
                            {log.error_message}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Success</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { useGetOverviewStats, getGetOverviewStatsQueryKey, useRunSync, useGetSyncStatus, getGetSyncStatusQueryKey, getGetSyncLogsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Database, RefreshCw, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { data: stats, isLoading: statsLoading } = useGetOverviewStats({
    query: { queryKey: getGetOverviewStatsQueryKey() }
  });
  
  const { data: syncStatuses, isLoading: statusLoading } = useGetSyncStatus({
    query: { queryKey: getGetSyncStatusQueryKey() }
  });

  const { mutate: runSync, isPending: isSyncing } = useRunSync({
    mutation: {
      onSuccess: () => {
        toast.success("Sync completed successfully");
        queryClient.invalidateQueries({ queryKey: getGetOverviewStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSyncStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSyncLogsQueryKey() });
      },
      onError: (err: any) => {
        toast.error(`Sync failed: ${err.message || "Unknown error"}`);
      }
    }
  });

  if (statsLoading || statusLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System Overview</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1">
            Last full sync: {stats?.last_full_sync ? formatDistanceToNow(new Date(stats.last_full_sync), { addSuffix: true }) : 'Never'}
          </p>
        </div>
        <Button 
          onClick={() => runSync()} 
          disabled={isSyncing || stats?.sync_running}
          className="font-mono"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing || stats?.sync_running ? 'animate-spin' : ''}`} />
          {isSyncing || stats?.sync_running ? 'SYNCING...' : 'SYNC ALL DATA'}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider font-mono">
              Total COWs
            </CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">{stats?.cmdb_count || 0}</div>
          </CardContent>
        </Card>
        <Card className="border-border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider font-mono">
              On Air
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-green-600">{stats?.on_air_count || 0}</div>
          </CardContent>
        </Card>
        <Card className="border-border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider font-mono">
              Energy Records
            </CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">{stats?.energy_count || 0}</div>
          </CardContent>
        </Card>
        <Card className="border-border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider font-mono">
              Movements
            </CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">{stats?.cow_movement_count || 0}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-mono">Sync Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {syncStatuses?.map((status) => (
              <div key={status.table_name} className="flex items-center justify-between border-b border-border pb-4 last:border-0 last:pb-0">
                <div className="flex items-center gap-3">
                  {status.status === 'ok' ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : status.status === 'error' ? (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  ) : (
                    <Clock className="h-5 w-5 text-muted-foreground" />
                  )}
                  <div>
                    <p className="font-mono font-medium text-sm">{status.table_name}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {status.row_count} rows • {status.last_synced_at ? formatDistanceToNow(new Date(status.last_synced_at), { addSuffix: true }) : 'Never synced'}
                    </p>
                  </div>
                </div>
                {status.status === 'error' && status.last_error && (
                  <div className="text-xs text-destructive max-w-[200px] truncate" title={status.last_error}>
                    {status.last_error}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-mono">Region Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats?.regions?.map((region) => (
                <div key={region.region} className="flex items-center justify-between">
                  <span className="text-sm font-mono">{region.region || 'Unknown'}</span>
                  <div className="flex items-center gap-2">
                    <div className="h-2 bg-primary/20 rounded-full overflow-hidden w-32">
                      <div 
                        className="h-full bg-primary" 
                        style={{ width: `${(region.count / (stats.cmdb_count || 1)) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono font-medium w-8 text-right">{region.count}</span>
                  </div>
                </div>
              ))}
              {(!stats?.regions || stats.regions.length === 0) && (
                <p className="text-sm text-muted-foreground italic font-mono">No regional data available</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

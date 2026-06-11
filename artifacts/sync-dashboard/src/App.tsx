import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Cmdb from "@/pages/cmdb";
import Energy from "@/pages/energy";
import CowMovement from "@/pages/cow-movement";
import SyncLogs from "@/pages/sync-logs";

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/cmdb" component={Cmdb} />
        <Route path="/energy" component={Energy} />
        <Route path="/cow-movement" component={CowMovement} />
        <Route path="/sync-logs" component={SyncLogs} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

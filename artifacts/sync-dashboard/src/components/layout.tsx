import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "@/components/ui/sidebar";
import { Activity, Database, History, LayoutDashboard, Zap } from "lucide-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/cmdb", label: "CMDB", icon: Database },
    { href: "/energy", label: "Energy", icon: Zap },
    { href: "/cow-movement", label: "COW Movement", icon: Activity },
    { href: "/sync-logs", label: "Sync Logs", icon: History },
  ];

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background font-mono text-sm">
        <Sidebar className="border-r border-border bg-sidebar text-sidebar-foreground">
          <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
            <div className="flex items-center gap-2 font-bold tracking-tight text-sidebar-primary">
              <Database className="h-4 w-4" />
              <span>COW OPS SYNC</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel className="px-4 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 mt-4 mb-2">
                Dashboards
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = location === item.href;
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={item.label}
                          className={`flex items-center gap-3 px-4 py-2 ${
                            isActive
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground transition-colors"
                          }`}
                        >
                          <Link href={item.href} className="flex items-center gap-3 w-full">
                            <Icon className="h-4 w-4" />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <main className="flex-1 flex flex-col min-w-0">
          <header className="flex h-12 items-center border-b border-border bg-card px-4 shrink-0">
            <SidebarTrigger />
            <div className="ml-4 font-mono text-xs text-muted-foreground flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              SYSTEM ONLINE
            </div>
          </header>
          <div className="flex-1 overflow-auto p-4 md:p-6 bg-muted/20">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

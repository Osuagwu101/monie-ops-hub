import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bot,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  FileStack,
  LayoutDashboard,
  ListTodo,
  Store,
  Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { loadAssistantProfile } from "@/lib/assistant-data";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

const overviewItem = { title: "Overview", url: "/", icon: LayoutDashboard } as const;
const dailyTasksItem = { title: "Daily Tasks", url: "/daily-tasks", icon: ListTodo } as const;
const merchantsItem = { title: "Merchants", url: "/merchant-list", icon: Store } as const;
const reportsItem = { title: "Official Reports", url: "/report-imports", icon: FileStack } as const;
const automationItem = { title: "Automation", url: "/automation", icon: Workflow } as const;
const readinessItem = { title: "Readiness", url: "/readiness", icon: CheckSquare2 } as const;
const operationsTeamItem = { title: "Operations Team", url: "/ai-logs", icon: Bot } as const;

const assistantMenuItems = [overviewItem, dailyTasksItem, merchantsItem, operationsTeamItem];
const directorMenuItems = [
  overviewItem,
  dailyTasksItem,
  merchantsItem,
  reportsItem,
  automationItem,
  readinessItem,
  operationsTeamItem,
];

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const { session, user } = useAuth();
  const collapsed = state === "collapsed";
  const currentPath = useRouterState({
    select: (router) => router.location.pathname,
  });
  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => loadAssistantProfile(user!.id, session!.access_token),
    enabled: Boolean(user?.id && session?.access_token),
  });

  const menuItems = profileQuery.data?.role === "director" ? directorMenuItems : assistantMenuItems;
  const isActive = (path: string) => currentPath === path;

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="flex h-16 items-center justify-between border-b px-4">
        <div
          className={cn("flex items-center gap-2 overflow-hidden", collapsed && "justify-center")}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <span className="text-sm font-bold">M</span>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-sidebar-foreground">
                Monie Ops Hub
              </div>
              <div className="truncate text-[10px] text-muted-foreground">
                77% operating standard
              </div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-4">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    {...(collapsed ? { tooltip: item.title } : {})}
                  >
                    <Link
                      to={item.url}
                      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <div className="mt-auto border-t p-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="h-8 w-8"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
    </Sidebar>
  );
}

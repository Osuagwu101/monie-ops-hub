import { Bell, Search, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-card px-4 shadow-sm">
      <SidebarTrigger className="h-8 w-8" />

      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <span className="text-sm font-bold">M</span>
        </div>
        <span className="hidden text-lg font-bold text-foreground sm:inline">
          Moniepoint Operations
        </span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="relative hidden w-64 sm:block">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search merchants, TIDs..."
            className="h-9 pl-9 text-sm"
          />
        </div>

        <Button variant="ghost" size="icon" className="relative h-8 w-8" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
        </Button>

        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Profile">
          <User className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}

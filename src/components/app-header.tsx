import { ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-card px-4 shadow-sm">
      <SidebarTrigger className="h-8 w-8" />

      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <span className="text-sm font-bold">M</span>
        </div>
        <div>
          <span className="hidden text-base font-bold text-foreground sm:inline">
            Monie Ops Hub
          </span>
          <div className="hidden text-[11px] text-muted-foreground md:block">
            Secure BRM operations mirror
          </div>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Badge variant="outline" className="gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" />
          Phase 1
        </Badge>
      </div>
    </header>
  );
}

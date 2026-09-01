import { Download, LogOut, ShieldCheck, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { MonieBrmMark } from "@/components/monie-brm-mark";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth-context";

export function AppHeader() {
  const { user, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-card px-4 shadow-sm">
      <SidebarTrigger className="h-8 w-8" />

      <div className="flex items-center gap-2">
        <MonieBrmMark compact />
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
        <Badge variant="outline" className="hidden gap-1.5 sm:flex">
          <ShieldCheck className="h-3.5 w-3.5" />
          Phase 2
        </Badge>
        <div className="hidden items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground md:flex">
          <UserRound className="h-3.5 w-3.5" />
          <span className="max-w-48 truncate">{user?.email ?? "Team member"}</span>
        </div>
        <Button variant="outline" size="sm" className="gap-2 px-2 sm:px-3" asChild>
          <a
            href="https://github.com/Osuagwu101/monie-ops-hub/releases/download/android-v1.1.0-full-portal/monie-ops-hub-android-v1.1.0-full-portal.apk"
            aria-label="Download Moniepoint BRM app"
          >
            <Download className="h-4 w-4" />
            <span className="hidden lg:inline">Download App</span>
          </a>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Sign out"
          onClick={() => void signOut()}
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}

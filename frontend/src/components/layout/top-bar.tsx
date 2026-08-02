import { Menu } from "lucide-react";

import { AccountMenu } from "@/components/account/account-menu";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/stores/ui-store";

type TopBarProps = {
  title: string;
  subtitle: string;
  onMenuClick: () => void;
};

export function TopBar({ title, subtitle, onMenuClick }: TopBarProps) {
  const isSidebarOpen = useUiStore((state) => state.isSidebarOpen);

  return (
    <header className="relative z-20 rounded-2xl border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--card)/0.85)] p-4 shadow-sm backdrop-blur md:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            variant="outline"
            size="sm"
            className="mt-0.5 md:hidden"
            onClick={onMenuClick}
            aria-label="Toggle navigation"
            aria-expanded={isSidebarOpen}
            aria-controls="workspace-navigation"
          >
            <Menu className="size-4" />
          </Button>

          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[hsl(var(--muted-foreground))]">
              Telegram Saved Organizer
            </p>
            <h1 tabIndex={-1} className="mt-1 text-xl font-semibold text-[hsl(var(--foreground))] md:text-2xl">
              {title}
            </h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{subtitle}</p>
          </div>
        </div>

        <AccountMenu />
      </div>
    </header>
  );
}

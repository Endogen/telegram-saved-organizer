import { AnimatePresence, motion } from "framer-motion";
import { Menu, MessageSquareMore, PlugZap, Rows3 } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

const navigation = [
  { to: "/", label: "Dashboard", icon: Rows3 },
  { to: "/messages", label: "Messages", icon: MessageSquareMore },
  { to: "/connect", label: "Connect", icon: PlugZap },
];

export function AppLayout() {
  const location = useLocation();
  const isSidebarOpen = useUiStore((state) => state.isSidebarOpen);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  return (
    <div className="min-h-screen px-4 py-5 md:px-6 md:py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 md:gap-6">
        <header className="rounded-2xl border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--card)/0.85)] p-4 shadow-sm backdrop-blur md:p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[hsl(var(--muted-foreground))]">
                Telegram Saved Organizer
              </p>
              <h1 className="mt-1 text-xl font-semibold text-[hsl(var(--foreground))] md:text-2xl">
                Tooling Baseline
              </h1>
            </div>
            <Button
              variant="outline"
              className="md:hidden"
              onClick={toggleSidebar}
              aria-label="Toggle navigation"
            >
              <Menu className="size-4" />
            </Button>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-[220px_1fr] md:gap-6">
          <aside
            className={cn(
              "rounded-2xl border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--card)/0.82)] p-3 shadow-sm backdrop-blur",
              isSidebarOpen ? "block" : "hidden md:block",
            )}
          >
            <nav className="space-y-1">
              {navigation.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                        : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]",
                    )
                  }
                  onClick={() => useUiStore.getState().setSidebarOpen(false)}
                >
                  <Icon className="size-4" />
                  {label}
                </NavLink>
              ))}
            </nav>
          </aside>

          <main className="rounded-2xl border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--card)/0.8)] p-4 shadow-sm backdrop-blur md:p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </div>
  );
}

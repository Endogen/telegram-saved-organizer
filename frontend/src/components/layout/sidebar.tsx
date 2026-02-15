import type { LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

import { cn } from "@/lib/utils";

export type SidebarItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
};

type SidebarProps = {
  items: SidebarItem[];
  isOpen: boolean;
  onClose: () => void;
};

export function Sidebar({ items, isOpen, onClose }: SidebarProps) {
  return (
    <>
      <AnimatePresence>
        {isOpen ? (
          <motion.button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-30 bg-slate-950/40 md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
        ) : null}
      </AnimatePresence>

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 -translate-x-full flex-col border-r border-[hsl(var(--border)/0.8)] bg-[hsl(var(--card)/0.95)] transition-transform duration-300 md:static md:z-0 md:w-64 md:translate-x-0 md:rounded-2xl md:border md:bg-[hsl(var(--card)/0.82)] md:shadow-sm md:backdrop-blur",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="border-b border-[hsl(var(--border)/0.75)] px-4 py-4 md:px-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[hsl(var(--muted-foreground))]">
            Workspace
          </p>
          <h2 className="mt-1 text-base font-semibold text-[hsl(var(--foreground))]">Saved Messages</h2>
        </div>

        <nav className="flex-1 space-y-1 p-3 md:p-4">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                    : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]",
                )
              }
              onClick={onClose}
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}

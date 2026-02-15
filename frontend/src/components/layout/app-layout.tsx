import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquareMore, PlugZap, Rows3 } from "lucide-react";
import { Outlet, useLocation } from "react-router-dom";

import { Sidebar, type SidebarItem } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { useUiStore } from "@/stores/ui-store";

const navigation: SidebarItem[] = [
  { to: "/", label: "Dashboard", icon: Rows3, end: true },
  { to: "/messages", label: "Messages", icon: MessageSquareMore },
  { to: "/connect", label: "Connect", icon: PlugZap },
];

const routeMeta = [
  {
    matcher: (pathname: string) => pathname === "/",
    title: "Dashboard",
    subtitle: "Overview of your Saved Messages workspace and category activity.",
  },
  {
    matcher: (pathname: string) => pathname.startsWith("/messages"),
    title: "Messages",
    subtitle: "Search, filter, and manage imported Saved Messages.",
  },
  {
    matcher: (pathname: string) => pathname.startsWith("/connect"),
    title: "Connect Telegram",
    subtitle: "Link your Telegram account to scan and organize Saved Messages.",
  },
];

export function AppLayout() {
  const location = useLocation();
  const isSidebarOpen = useUiStore((state) => state.isSidebarOpen);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname, setSidebarOpen]);

  const activeRoute =
    routeMeta.find((item) => item.matcher(location.pathname)) ??
    routeMeta[0];

  return (
    <div className="min-h-screen px-4 py-5 md:px-6 md:py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 md:gap-6">
        <TopBar title={activeRoute.title} subtitle={activeRoute.subtitle} onMenuClick={toggleSidebar} />

        <div className="flex gap-4 md:gap-6">
          <Sidebar items={navigation} isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />

          <main className="min-h-[calc(100vh-11.5rem)] min-w-0 flex-1 rounded-2xl border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--card)/0.8)] p-4 shadow-sm backdrop-blur md:p-6">
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

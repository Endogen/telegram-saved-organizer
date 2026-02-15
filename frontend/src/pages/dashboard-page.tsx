import { motion } from "framer-motion";
import { CheckCircle2, Sparkles, Workflow } from "lucide-react";

import { ScanProgress } from "@/components/scan/scan-progress";

const items = [
  {
    title: "React Router 7",
    description: "Routes and layout shell are wired for dashboard, messages, and connection flow.",
    icon: Workflow,
  },
  {
    title: "Zustand 5",
    description: "Shared UI store powers navigation state and message search query.",
    icon: Sparkles,
  },
  {
    title: "Framer Motion 12",
    description: "Route and message card transitions are active with enter, exit, and hover motion.",
    icon: CheckCircle2,
  },
];

export function DashboardPage() {
  return (
    <section>
      <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Dashboard</h2>
      <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted-foreground))] md:text-base">
        Telegram connection, scan lifecycle controls, and motion-ready message tooling are now wired into the frontend
        shell.
      </p>

      <div className="mt-6">
        <ScanProgress />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, index) => (
          <motion.article
            key={item.title}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05, duration: 0.22, ease: "easeOut" }}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.95)] p-4"
          >
            <item.icon className="size-5 text-[hsl(var(--primary))]" />
            <h3 className="mt-3 text-base font-semibold text-[hsl(var(--foreground))]">{item.title}</h3>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{item.description}</p>
          </motion.article>
        ))}
      </div>
    </section>
  );
}

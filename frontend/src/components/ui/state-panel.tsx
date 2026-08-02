import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

type StateTone = "default" | "success" | "warning" | "error";

type StatePanelProps = {
  title: string;
  description?: string;
  tone?: StateTone;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
};

const toneClasses: Record<StateTone, string> = {
  default: "border-[hsl(var(--border))] bg-[hsl(var(--background)/0.74)] text-[hsl(var(--muted-foreground))]",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
};

const toneIcons: Record<StateTone, LucideIcon> = {
  default: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
};

export function StatePanel({ title, description, tone = "default", icon, action, className }: StatePanelProps) {
  const Icon = icon ?? toneIcons[tone];

  return (
    <div
      className={cn("rounded-lg border px-3 py-2 text-sm", toneClasses[tone], className)}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
    >
      <p className="flex items-start gap-2 font-medium">
        <Icon className="mt-0.5 size-4 shrink-0" />
        <span>{title}</span>
      </p>
      {description ? <p className="mt-1">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

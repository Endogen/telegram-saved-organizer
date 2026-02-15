import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

type StateTone = "default" | "warning" | "error";

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
  warning: "border-amber-300/80 bg-amber-50/80 text-amber-800",
  error: "border-red-300/70 bg-red-50/80 text-red-800",
};

const toneIcons: Record<StateTone, LucideIcon> = {
  default: Info,
  warning: TriangleAlert,
  error: CircleAlert,
};

export function StatePanel({ title, description, tone = "default", icon, action, className }: StatePanelProps) {
  const Icon = icon ?? toneIcons[tone];

  return (
    <div className={cn("rounded-lg border px-3 py-2 text-sm", toneClasses[tone], className)}>
      <p className="flex items-start gap-2 font-medium">
        <Icon className="mt-0.5 size-4 shrink-0" />
        <span>{title}</span>
      </p>
      {description ? <p className="mt-1">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

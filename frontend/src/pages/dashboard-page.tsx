import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Archive,
  Code2,
  FileText,
  FolderKanban,
  ImageIcon,
  Link2,
  MessageSquareText,
  Music2,
  type LucideIcon,
  Video,
} from "lucide-react";
import { Link } from "react-router-dom";

import { ScanProgress } from "@/components/scan/scan-progress";
import { useCategories } from "@/hooks/use-categories";

const categoryIconMap: Record<string, LucideIcon> = {
  video: Video,
  music: Music2,
  link: Link2,
  code: Code2,
  image: ImageIcon,
  "file-text": FileText,
  "message-square": MessageSquareText,
  archive: Archive,
};

function resolveCategoryIcon(iconName: string): LucideIcon {
  return categoryIconMap[iconName.toLowerCase()] ?? FolderKanban;
}

export function DashboardPage() {
  const { categories, isLoading } = useCategories();

  const totalMessages = useMemo(
    () => categories.reduce((sum, cat) => sum + cat.message_count, 0),
    [categories],
  );

  return (
    <section>
      <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Dashboard</h2>
      <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted-foreground))] md:text-base">
        {totalMessages > 0
          ? `${totalMessages.toLocaleString()} messages organized across ${categories.length} categories.`
          : "Connect Telegram and run a scan to get started."}
      </p>

      <div className="mt-6">
        <ScanProgress />
      </div>

      {!isLoading && totalMessages > 0 ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((category, index) => {
            const Icon = resolveCategoryIcon(category.icon);
            return (
              <Link
                key={category.id}
                to={`/messages?category=${encodeURIComponent(category.slug)}`}
              >
                <motion.article
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03, duration: 0.22, ease: "easeOut" }}
                  className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.95)] p-4 transition-colors hover:border-[hsl(var(--primary)/0.4)] hover:bg-[hsl(var(--card))]"
                >
                  <div className="flex items-center justify-between">
                    <Icon className="size-5" style={{ color: category.color }} />
                    <span className="text-2xl font-bold text-[hsl(var(--foreground))]">
                      {category.message_count.toLocaleString()}
                    </span>
                  </div>
                  <h3 className="mt-2 text-sm font-medium text-[hsl(var(--muted-foreground))]">
                    {category.name}
                  </h3>
                </motion.article>
              </Link>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

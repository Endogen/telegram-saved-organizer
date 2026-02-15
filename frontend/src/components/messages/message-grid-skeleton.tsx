import { Skeleton } from "@/components/ui/skeleton";

type MessageGridSkeletonProps = {
  count?: number;
};

export function MessageGridSkeleton({ count = 8 }: MessageGridSkeletonProps) {
  return (
    <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <article
          // Using index is fine here because this list is static placeholder content.
          key={index}
          className="rounded-2xl border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--card)/0.88)] p-4 shadow-sm"
        >
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="mt-4 space-y-2">
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-9/12" />
            <Skeleton className="h-4 w-7/12" />
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
        </article>
      ))}
    </div>
  );
}

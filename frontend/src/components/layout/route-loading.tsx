export function RouteLoading() {
  return (
    <div className="animate-pulse" role="status" aria-label="Loading page">
      <div className="h-7 w-40 rounded-lg bg-[hsl(var(--muted))]" />
      <div className="mt-3 h-4 w-full max-w-md rounded bg-[hsl(var(--muted))]" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-40 rounded-2xl border border-[hsl(var(--border)/0.65)] bg-[hsl(var(--muted)/0.7)]" />
        ))}
      </div>
      <span className="sr-only">Loading page…</span>
    </div>
  );
}

import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.9)] p-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[hsl(var(--muted-foreground))]">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-[hsl(var(--foreground))]">Page Not Found</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          This route is not configured yet in the organizer dashboard.
        </p>
        <Link
          to="/"
          className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-[hsl(var(--primary))] px-4 text-sm font-semibold text-[hsl(var(--primary-foreground))] transition hover:bg-[hsl(var(--primary)/0.92)]"
        >
          Back to Dashboard
        </Link>
      </div>
    </main>
  );
}

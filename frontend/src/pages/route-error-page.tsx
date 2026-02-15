import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";

import { StatePanel } from "@/components/ui/state-panel";

function toRouteErrorMessage(error: unknown): string {
  if (isRouteErrorResponse(error)) {
    if (typeof error.data === "string" && error.data.trim().length > 0) {
      return error.data;
    }
    return `${error.status} ${error.statusText}`;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "An unexpected routing error occurred.";
}

export function RouteErrorPage() {
  const error = useRouteError();
  const message = toRouteErrorMessage(error);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center px-4">
      <div className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.92)] p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-[hsl(var(--foreground))]">Something went wrong</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          This view hit an unexpected error. You can go back to a safe route and continue working.
        </p>

        <StatePanel tone="error" title="Route error" description={message} className="mt-4" />

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            to="/"
            className="inline-flex h-10 items-center justify-center rounded-md bg-[hsl(var(--primary))] px-4 text-sm font-semibold text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary)/0.92)]"
          >
            Back to Dashboard
          </Link>
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 text-sm font-semibold text-[hsl(var(--card-foreground))] transition-colors hover:bg-[hsl(var(--muted))]"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload app
          </button>
        </div>
      </div>
    </main>
  );
}

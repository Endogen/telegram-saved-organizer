import { LoaderCircle, RefreshCw } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";

type LocationLike = {
  pathname?: unknown;
  search?: unknown;
  hash?: unknown;
};

function isSafeInternalPath(value: string): boolean {
  if (
    !value.startsWith("/")
    || value.startsWith("//")
    || /[\\\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  const baseOrigin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  try {
    if (new URL(value, baseOrigin).origin !== baseOrigin) {
      return false;
    }
  } catch {
    return false;
  }
  const pathname = value.split(/[?#]/, 1)[0];
  return pathname !== "/login" && pathname !== "/register";
}

export function getSafeReturnTo(state: unknown): string | null {
  if (!state || typeof state !== "object") {
    return null;
  }

  const candidateState = state as { returnTo?: unknown; from?: unknown };
  if (typeof candidateState.returnTo === "string" && isSafeInternalPath(candidateState.returnTo)) {
    return candidateState.returnTo;
  }

  if (typeof candidateState.from === "string") {
    return isSafeInternalPath(candidateState.from) ? candidateState.from : null;
  }

  if (candidateState.from && typeof candidateState.from === "object") {
    const from = candidateState.from as LocationLike;
    if (typeof from.pathname !== "string") {
      return null;
    }
    const target = `${from.pathname}${typeof from.search === "string" ? from.search : ""}${typeof from.hash === "string" ? from.hash : ""}`;
    return isSafeInternalPath(target) ? target : null;
  }

  return null;
}

function SessionLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4" role="status" aria-live="polite">
      <div className="text-center">
        <LoaderCircle className="mx-auto size-7 animate-spin text-[hsl(var(--primary))] motion-reduce:animate-none" />
        <p className="mt-3 text-sm font-medium text-[hsl(var(--foreground))]">Checking your session…</p>
      </div>
    </main>
  );
}

function SessionUnavailable() {
  const { refreshSession } = useAuth();

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-amber-500/30 bg-[hsl(var(--card)/0.96)] p-6 shadow-xl sm:p-8" role="alert">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">Connection problem</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]">The server is unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
          We could not check your account session. Your sign-in state has not been changed.
        </p>
        <Button className="mt-5 min-h-11 gap-2" variant="outline" onClick={() => void refreshSession()}>
          <RefreshCw className="size-4" />
          Try again
        </Button>
      </section>
    </main>
  );
}

function CurrentSessionBoundary({ publicOnly }: { publicOnly: boolean }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return <SessionLoading />;
  }
  if (status === "unavailable") {
    return <SessionUnavailable />;
  }

  if (publicOnly) {
    if (status === "authenticated") {
      if (location.pathname === "/register") {
        return <Navigate to="/onboarding/telegram" replace />;
      }
      return <Navigate to={getSafeReturnTo(location.state) ?? "/"} replace />;
    }
    return <Outlet />;
  }

  if (status === "anonymous") {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from: location, returnTo }} />;
  }

  return <Outlet />;
}

export function RequireAuth() {
  return <CurrentSessionBoundary publicOnly={false} />;
}

export function PublicOnly() {
  return <CurrentSessionBoundary publicOnly />;
}

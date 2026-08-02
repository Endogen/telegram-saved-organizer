import { createContext, type FormEvent, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, TerminalSquare } from "lucide-react";

import { API_UNAUTHORIZED_EVENT, ApiRequestError } from "@/api/client";
import { fetchApiSession, lockApiSession, unlockApiSession } from "@/api/session";
import { Button } from "@/components/ui/button";

type GateState = "checking" | "locked" | "unlocked" | "unavailable";

type ApiSessionGateProps = {
  children: ReactNode;
};

type ApiSessionContextValue = {
  lockWorkspace: () => Promise<void>;
};

const ApiSessionContext = createContext<ApiSessionContextValue | null>(null);

export function useApiSession(): ApiSessionContextValue | null {
  return useContext(ApiSessionContext);
}

function toStatusError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Could not reach the local API.";
}

export function ApiSessionGate({ children }: ApiSessionGateProps) {
  const [gateState, setGateState] = useState<GateState>("checking");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const checkSession = useCallback(async (signal?: AbortSignal) => {
    setGateState("checking");
    setError(null);
    try {
      const status = await fetchApiSession(signal);
      setGateState(status.authenticated ? "unlocked" : "locked");
    } catch (requestError) {
      if (signal?.aborted) {
        return;
      }
      setError(toStatusError(requestError));
      setGateState("unavailable");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkSession(controller.signal);
    return () => controller.abort();
  }, [checkSession]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setToken("");
      setError("Your local API session expired. Enter the token to unlock it again.");
      setGateState("locked");
    };
    window.addEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedToken = token.trim();
    if (normalizedToken.length === 0) {
      setError("Enter the local API token.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const status = await unlockApiSession(normalizedToken);
      if (!status.authenticated) {
        throw new Error("The API did not create a session.");
      }
      setToken("");
      setGateState("unlocked");
    } catch (requestError) {
      if (requestError instanceof ApiRequestError && requestError.status === 401) {
        setError("That token is not valid. Copy the current token from the backend and try again.");
      } else if (requestError instanceof ApiRequestError && requestError.detail === "cross_origin_request_blocked") {
        setError("The backend rejected this browser origin. Open the app through its configured frontend address.");
      } else {
        setError(toStatusError(requestError));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const sessionContext = useMemo<ApiSessionContextValue>(() => ({
    lockWorkspace: async () => {
      try {
        await lockApiSession();
        setToken("");
        setError(null);
        setGateState("locked");
      } catch (requestError) {
        setError(toStatusError(requestError));
        setGateState("unavailable");
      }
    },
  }), []);

  if (gateState === "unlocked") {
    return <ApiSessionContext.Provider value={sessionContext}>{children}</ApiSessionContext.Provider>;
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-lg overflow-hidden rounded-3xl border border-[hsl(var(--border)/0.85)] bg-[hsl(var(--card)/0.96)] shadow-[0_28px_80px_-38px_rgba(15,23,42,0.55)] backdrop-blur">
        <div className="border-b border-[hsl(var(--border)/0.75)] bg-[linear-gradient(135deg,hsl(var(--primary)/0.16),transparent_70%)] px-6 py-6 sm:px-8">
          <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-lg shadow-teal-950/15">
            <ShieldCheck className="size-5" />
          </span>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--primary))]">
            Local workspace protection
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
            Unlock Saved Organizer
          </h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-[hsl(var(--muted-foreground))]">
            The backend now protects messages, Telegram credentials, and write actions with a private local token.
          </p>
        </div>

        <div className="px-6 py-6 sm:px-8">
          {gateState === "checking" ? (
            <div className="flex min-h-36 flex-col items-center justify-center text-center" role="status">
              <LoaderCircle className="size-6 animate-spin text-[hsl(var(--primary))]" />
              <p className="mt-3 text-sm font-medium text-[hsl(var(--foreground))]">Checking local API session…</p>
            </div>
          ) : gateState === "unavailable" ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-sm font-semibold text-[hsl(var(--foreground))]">The backend is not available</p>
              <p className="mt-1 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{error}</p>
              <Button type="button" variant="outline" className="mt-4 gap-2" onClick={() => void checkSession()}>
                <RefreshCw className="size-4" />
                Try again
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label htmlFor="api-token" className="text-sm font-semibold text-[hsl(var(--foreground))]">
                Local API token
              </label>
              <div className="relative mt-2">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                <input
                  id="api-token"
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  spellCheck={false}
                  className="h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/0.72)] pl-10 pr-11 text-sm text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary)/0.7)] focus:ring-4 focus:ring-[hsl(var(--primary)/0.12)]"
                  aria-describedby="api-token-help api-token-error"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((visible) => !visible)}
                  className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                  aria-label={showToken ? "Hide API token" : "Show API token"}
                >
                  {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p id="api-token-help" className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">
                The token is exchanged for an HttpOnly, same-site browser session and is not stored in frontend code.
              </p>
              {error ? (
                <p id="api-token-error" role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-300">
                  {error}
                </p>
              ) : null}
              <Button type="submit" className="mt-5 h-11 w-full gap-2" disabled={isSubmitting}>
                {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                {isSubmitting ? "Unlocking…" : "Unlock workspace"}
              </Button>
            </form>
          )}

          <div className="mt-5 rounded-2xl border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--muted)/0.62)] p-4">
            <div className="flex items-start gap-3">
              <TerminalSquare className="mt-0.5 size-4 shrink-0 text-[hsl(var(--primary))]" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[hsl(var(--foreground))]">Get the token from the backend</p>
                <code className="mt-2 block overflow-x-auto rounded-lg bg-slate-950 px-3 py-2 text-xs text-slate-100">
                  cd backend &amp;&amp; uv run python -m app.api_access
                </code>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

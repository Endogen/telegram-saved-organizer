import { useCallback, useEffect, useState } from "react";
import { Clock3, Globe2, LoaderCircle, MonitorSmartphone, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

import { fetchActiveSessions, revokeSession } from "@/api/session";
import { Button } from "@/components/ui/button";
import { StatePanel } from "@/components/ui/state-panel";
import type { ActiveSession } from "@/types/account";

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function sessionLabel(session: ActiveSession): string {
  if (session.current) {
    return "This device";
  }
  if (session.user_agent && session.user_agent.trim().length > 0) {
    return session.user_agent;
  }
  return "Unknown device";
}

export function SessionsPage() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadSessions = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setSessions(await fetchActiveSessions(signal));
    } catch (error) {
      if (!signal?.aborted) {
        setLoadError(toErrorMessage(error, "Could not load active sessions."));
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadSessions(controller.signal);
    return () => controller.abort();
  }, [loadSessions]);

  async function handleRevoke(session: ActiveSession) {
    if (session.current) {
      return;
    }

    setActionError(null);
    setRevokingId(session.id);
    try {
      await revokeSession(session.id);
      setSessions((currentSessions) => currentSessions.filter((item) => item.id !== session.id));
    } catch (error) {
      setActionError(toErrorMessage(error, "Could not revoke that session."));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section className="mx-auto w-full max-w-4xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Active sessions</h2>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))] md:text-base">
            Review browsers signed in to your account and revoke access you no longer recognize.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadSessions()}
          disabled={isLoading || revokingId !== null}
          className="shrink-0 gap-2"
        >
          <RefreshCw className={isLoading ? "size-4 animate-spin" : "size-4"} />
          Refresh
        </Button>
      </div>

      {actionError ? (
        <StatePanel tone="error" title="Session could not be revoked" description={actionError} className="mt-5" />
      ) : null}

      {isLoading ? (
        <div className="mt-6 flex min-h-40 items-center justify-center gap-2 text-sm text-[hsl(var(--muted-foreground))]" role="status">
          <LoaderCircle className="size-5 animate-spin" />
          Loading active sessions…
        </div>
      ) : loadError ? (
        <StatePanel
          tone="error"
          title="Could not load active sessions"
          description={loadError}
          className="mt-6"
          action={
            <Button variant="outline" size="sm" onClick={() => void loadSessions()}>
              Try again
            </Button>
          }
        />
      ) : sessions.length === 0 ? (
        <StatePanel
          title="No active sessions found"
          description="Sign in again to create a new session."
          icon={MonitorSmartphone}
          className="mt-6"
        />
      ) : (
        <ul className="mt-6 space-y-3" aria-label="Active sessions">
          {sessions.map((session) => {
            const isRevoking = revokingId === session.id;
            return (
              <li
                key={session.id}
                className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.92)] p-4 md:p-5"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <MonitorSmartphone className="size-5 shrink-0 text-[hsl(var(--primary))]" />
                      <h3 className="break-words text-base font-semibold text-[hsl(var(--foreground))]">
                        {sessionLabel(session)}
                      </h3>
                      {session.current ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                          <ShieldCheck className="size-3.5" />
                          Current session
                        </span>
                      ) : null}
                    </div>

                    <dl className="mt-3 grid gap-2 text-sm text-[hsl(var(--muted-foreground))] md:grid-cols-2">
                      <div className="flex items-start gap-2">
                        <Clock3 className="mt-0.5 size-4 shrink-0" />
                        <div>
                          <dt className="font-medium text-[hsl(var(--foreground))]">Last active</dt>
                          <dd>{formatDateTime(session.last_seen_at)}</dd>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Globe2 className="mt-0.5 size-4 shrink-0" />
                        <div>
                          <dt className="font-medium text-[hsl(var(--foreground))]">IP address</dt>
                          <dd>{session.ip_address ?? "Not available"}</dd>
                        </div>
                      </div>
                      <div>
                        <dt className="font-medium text-[hsl(var(--foreground))]">Signed in</dt>
                        <dd>{formatDateTime(session.created_at)}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-[hsl(var(--foreground))]">Expires</dt>
                        <dd>{formatDateTime(session.expires_at)}</dd>
                      </div>
                    </dl>
                  </div>

                  {!session.current ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-2 border-red-500/30 text-red-700 hover:bg-red-500/10 dark:text-red-300"
                      onClick={() => void handleRevoke(session)}
                      disabled={revokingId !== null}
                      aria-label={`Revoke session: ${sessionLabel(session)}`}
                    >
                      {isRevoking ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                      {isRevoking ? "Revoking…" : "Revoke"}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

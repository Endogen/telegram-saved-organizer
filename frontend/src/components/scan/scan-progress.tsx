import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, CircleAlert, LoaderCircle, Play, RefreshCw, RotateCcw, Square } from "lucide-react";

import { fetchScanStatus, startScan, stopScan, subscribeToScanStatus } from "@/api/scan";
import { Button } from "@/components/ui/button";
import { notifyCategoriesChanged } from "@/hooks/use-categories";
import type { ScanStatus } from "@/types/scan";

const POLL_INTERVAL_ACTIVE_MS = 1500;
const POLL_INTERVAL_IDLE_MS = 8000;
const POLL_INTERVAL_STREAM_BACKSTOP_MS = 12000;

const INITIAL_SCAN_STATUS: ScanStatus = {
  job_id: null,
  state: "idle",
  stop_requested: false,
  messages_scanned: 0,
  pages_scanned: 0,
  page_size: 100,
  max_messages: null,
  max_runtime_seconds: null,
  last_message_id: null,
  started_at: null,
  finished_at: null,
  error: null,
  completion_reason: null,
};

type RefreshMode = "initial" | "manual" | "poll";
type StreamConnectionState = "unsupported" | "connecting" | "connected" | "fallback";

function isActiveScan(status: ScanStatus): boolean {
  return status.state === "pending" || status.state === "running" || status.state === "stopping";
}

function completionReasonLabel(status: ScanStatus): string | null {
  if (status.completion_reason === "source_exhausted") {
    return "All available Saved Messages were imported.";
  }
  if (status.completion_reason === "message_limit_reached") {
    return `The server message limit${status.max_messages === null ? "" : ` of ${status.max_messages}`} was reached.`;
  }
  if (status.completion_reason === "runtime_limit_reached") {
    return `The server runtime limit${status.max_runtime_seconds === null ? "" : ` of ${status.max_runtime_seconds} seconds`} was reached.`;
  }
  if (status.completion_reason === "stopped_by_user") {
    return "The scan was stopped by request.";
  }
  return null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Scan request failed. Check backend logs and try again.";
}

function clampPageSize(rawValue: number): number {
  if (!Number.isFinite(rawValue)) {
    return 100;
  }
  return Math.min(1000, Math.max(1, Math.trunc(rawValue)));
}

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function formatDuration(startedAt: string | null, finishedAt: string | null, now: number): string {
  if (startedAt === null) {
    return "—";
  }

  const startedMs = new Date(startedAt).getTime();
  if (Number.isNaN(startedMs)) {
    return "—";
  }

  const finishedMs = finishedAt === null ? now : new Date(finishedAt).getTime();
  if (Number.isNaN(finishedMs)) {
    return "—";
  }

  const elapsedSeconds = Math.max(0, Math.floor((finishedMs - startedMs) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

export function ScanProgress() {
  const [status, setStatus] = useState<ScanStatus>(INITIAL_SCAN_STATUS);
  const [pageSizeInput, setPageSizeInput] = useState("100");
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [streamConnectionState, setStreamConnectionState] = useState<StreamConnectionState>(() => {
    if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
      return "unsupported";
    }
    return "connecting";
  });
  const inFlightRef = useRef(false);

  const refreshStatus = useCallback(async (mode: RefreshMode) => {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    if (mode === "initial") {
      setIsInitialLoading(true);
    }
    if (mode === "manual") {
      setIsRefreshing(true);
    }

    try {
      const nextStatus = await fetchScanStatus();
      setStatus(nextStatus);
      if (isActiveScan(nextStatus) || mode === "initial" || mode === "manual") {
        setPageSizeInput(String(nextStatus.page_size));
      }
      setNow(Date.now());
      setRequestError(null);
    } catch (error) {
      if (mode !== "poll") {
        setRequestError(toErrorMessage(error));
      }
    } finally {
      inFlightRef.current = false;
      if (mode === "initial") {
        setIsInitialLoading(false);
      }
      if (mode === "manual") {
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshStatus("initial");
  }, [refreshStatus]);

  useEffect(() => {
    const subscription = subscribeToScanStatus({
      onOpen: () => {
        setStreamConnectionState("connected");
      },
      onStatus: (nextStatus) => {
        setStatus((prev) => {
          // Only sync page size from server when scan is active (input is disabled anyway)
          // or on the very first status update — avoid overwriting user input while idle.
          if (isActiveScan(nextStatus) || prev === INITIAL_SCAN_STATUS) {
            setPageSizeInput(String(nextStatus.page_size));
          }
          return nextStatus;
        });
        setNow(Date.now());
        setRequestError(null);
        setIsInitialLoading(false);
        setStreamConnectionState("connected");
        if (nextStatus.state === "completed") {
          notifyCategoriesChanged();
        }
      },
      onError: () => {
        setStreamConnectionState((current) => {
          if (current === "unsupported") {
            return current;
          }
          return "fallback";
        });
      },
    });

    return () => {
      subscription.close();
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;
    let timeoutId: number | undefined;

    const scheduleNext = () => {
      if (isCancelled) {
        return;
      }

      const delay =
        streamConnectionState === "connected"
          ? POLL_INTERVAL_STREAM_BACKSTOP_MS
          : isActiveScan(status)
            ? POLL_INTERVAL_ACTIVE_MS
            : POLL_INTERVAL_IDLE_MS;
      timeoutId = window.setTimeout(async () => {
        await refreshStatus("poll");
        scheduleNext();
      }, delay);
    };

    scheduleNext();

    return () => {
      isCancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [refreshStatus, status, streamConnectionState]);

  useEffect(() => {
    if (!isActiveScan(status)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [status]);

  const handleStartScan = useCallback(async () => {
    setRequestError(null);
    setIsStarting(true);

    const normalizedPageSize = clampPageSize(Number.parseInt(pageSizeInput, 10));
    setPageSizeInput(String(normalizedPageSize));

    try {
      const nextStatus = await startScan(normalizedPageSize);
      setStatus(nextStatus);
      setNow(Date.now());
    } catch (error) {
      setRequestError(toErrorMessage(error));
      try {
        const syncedStatus = await fetchScanStatus();
        setStatus(syncedStatus);
      } catch {
        // Keep the existing status when the sync request fails.
      }
    } finally {
      setIsStarting(false);
    }
  }, [pageSizeInput]);

  const handleStopScan = useCallback(async () => {
    setRequestError(null);
    setIsStopping(true);

    try {
      const nextStatus = await stopScan();
      setStatus(nextStatus);
      setNow(Date.now());
    } catch (error) {
      setRequestError(toErrorMessage(error));
    } finally {
      setIsStopping(false);
    }
  }, []);

  const [isClearing, setIsClearing] = useState(false);

  const handleClearAndRescan = useCallback(async () => {
    const confirmed = window.confirm(
      "This will delete all imported messages from the organizer and start a fresh scan. Messages in Telegram are not affected. Continue?",
    );
    if (!confirmed) {
      return;
    }

    setRequestError(null);
    setIsClearing(true);

    try {
      const normalizedPageSize = clampPageSize(Number.parseInt(pageSizeInput, 10));
      setPageSizeInput(String(normalizedPageSize));

      const nextStatus = await startScan(normalizedPageSize, true);
      setStatus(nextStatus);
      notifyCategoriesChanged();
      setPageSizeInput(String(nextStatus.page_size));
      setNow(Date.now());
    } catch (error) {
      setRequestError(toErrorMessage(error));
    } finally {
      setIsClearing(false);
    }
  }, [pageSizeInput]);

  const statusTone = useMemo(() => {
    if (status.error) {
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    }
    if (isActiveScan(status)) {
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    }
    if (status.state === "completed") {
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    }
    return "border-[hsl(var(--border))] bg-[hsl(var(--background)/0.75)] text-[hsl(var(--muted-foreground))]";
  }, [status]);

  const statusLabel = useMemo(() => {
    if (status.error) {
      return "Scan failed";
    }
    if (status.state === "stopping" || (isActiveScan(status) && status.stop_requested)) {
      return "Stopping scan";
    }
    if (isActiveScan(status)) {
      return "Scanning Saved Messages";
    }
    if (status.state === "completed") {
      return "Scan complete";
    }
    if (status.state === "cancelled") {
      return "Scan stopped";
    }
    return "Ready to scan";
  }, [status]);

  const streamStatusLabel = useMemo(() => {
    if (streamConnectionState === "connected") {
      return "Live updates connected";
    }
    if (streamConnectionState === "connecting") {
      return "Connecting live updates";
    }
    if (streamConnectionState === "unsupported") {
      return "Polling mode";
    }
    return "Live stream fallback";
  }, [streamConnectionState]);

  const streamStatusTone = useMemo(() => {
    if (streamConnectionState === "connected") {
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    }
    if (streamConnectionState === "connecting") {
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    }
    return "border-[hsl(var(--border))] bg-[hsl(var(--background)/0.72)] text-[hsl(var(--muted-foreground))]";
  }, [streamConnectionState]);

  const duration = formatDuration(status.started_at, status.finished_at, now);
  const completionMessage = completionReasonLabel(status);
  const scanIsActive = isActiveScan(status);
  const isBusy = isInitialLoading || isStarting || isStopping || isClearing || isRefreshing;
  const canStart = !isBusy && !scanIsActive;
  const canStop = !isBusy && scanIsActive && !status.stop_requested;

  return (
    <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.94)] p-4 shadow-sm md:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            Scanner
          </p>
          <h3 className="mt-1 text-lg font-semibold text-[hsl(var(--foreground))]">Saved Messages Scan Progress</h3>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            Live status stream with automatic polling fallback from Telegram scanner endpoints.
          </p>
          <p
            className={`mt-2 inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${streamStatusTone}`}
          >
            {streamStatusLabel}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background)/0.72)] px-2.5 py-1.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
            Page size
            <input
              type="number"
              min={1}
              max={1000}
              value={pageSizeInput}
              onChange={(event) => setPageSizeInput(event.target.value)}
              onBlur={() => setPageSizeInput((current) => String(clampPageSize(Number.parseInt(current, 10))))}
              disabled={scanIsActive || isStarting}
              className="h-7 w-24 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 text-sm text-[hsl(var(--foreground))] outline-none ring-[hsl(var(--ring))] transition focus:ring-2"
            />
          </label>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void refreshStatus("manual")}
            disabled={isBusy || isRefreshing}
            className="gap-1.5"
          >
            <RefreshCw className={isRefreshing ? "size-4 animate-spin" : "size-4"} />
            Refresh
          </Button>

          <Button size="sm" onClick={() => void handleStartScan()} disabled={!canStart} className="gap-1.5">
            {isStarting ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
            {isStarting ? "Starting..." : "Start"}
          </Button>

          <Button variant="outline" size="sm" onClick={() => void handleStopScan()} disabled={!canStop} className="gap-1.5">
            {isStopping ? <LoaderCircle className="size-4 animate-spin" /> : <Square className="size-4" />}
            {isStopping ? "Stopping..." : "Stop"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleClearAndRescan()}
            disabled={scanIsActive || isStarting || isStopping || isClearing}
            className="gap-1.5"
          >
            {isClearing ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
            {isClearing ? "Clearing..." : "Clear & Rescan"}
          </Button>
        </div>
      </div>

      {isInitialLoading ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background)/0.6)] px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">
          <LoaderCircle className="size-4 animate-spin" />
          Loading scan status...
        </div>
      ) : (
        <>
          <div className={`mt-4 rounded-lg border px-3 py-2 text-sm font-medium ${statusTone}`}>{statusLabel}</div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
            {scanIsActive ? (
              <motion.div
                className="h-full w-1/3 rounded-full bg-[hsl(var(--primary))]"
                initial={{ x: "-30%" }}
                animate={{ x: ["-30%", "240%"] }}
                transition={{ duration: 1.2, ease: "linear", repeat: Infinity }}
              />
            ) : status.error ? (
              <motion.div initial={{ width: 0 }} animate={{ width: "100%" }} className="h-full bg-amber-400" />
            ) : status.state === "completed" ? (
              <div className="h-full w-full bg-emerald-500" />
            ) : (
              <div className="h-full w-0" />
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <article className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.7)] px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                Messages Scanned
              </p>
              <p className="mt-1 text-lg font-semibold text-[hsl(var(--foreground))]">{status.messages_scanned}</p>
            </article>

            <article className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.7)] px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                Pages Processed
              </p>
              <p className="mt-1 text-lg font-semibold text-[hsl(var(--foreground))]">{status.pages_scanned}</p>
            </article>

            <article className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.7)] px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">Duration</p>
              <p className="mt-1 text-lg font-semibold text-[hsl(var(--foreground))]">{duration}</p>
            </article>

            <article className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.7)] px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">Started</p>
              <p className="mt-1 text-sm font-medium text-[hsl(var(--foreground))]">{formatTimestamp(status.started_at)}</p>
            </article>

            <article className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.7)] px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">Finished</p>
              <p className="mt-1 text-sm font-medium text-[hsl(var(--foreground))]">{formatTimestamp(status.finished_at)}</p>
            </article>

            <article className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.7)] px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                Last Message ID
              </p>
              <p className="mt-1 text-lg font-semibold text-[hsl(var(--foreground))]">{status.last_message_id ?? "—"}</p>
            </article>

            <article className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.7)] px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                Message Limit
              </p>
              <p className="mt-1 text-lg font-semibold text-[hsl(var(--foreground))]">{status.max_messages ?? "—"}</p>
            </article>

            <article className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.7)] px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                Runtime Limit
              </p>
              <p className="mt-1 text-lg font-semibold text-[hsl(var(--foreground))]">
                {status.max_runtime_seconds === null ? "—" : `${status.max_runtime_seconds}s`}
              </p>
            </article>
          </div>
        </>
      )}

      <AnimatePresence>
        {status.error || requestError ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
          >
            <p className="flex items-center gap-2 font-medium">
              <CircleAlert className="size-4" />
              {status.error ? "Scanner reported an error." : "Request failed."}
            </p>
            <p className="mt-1">{status.error ?? requestError}</p>
            {requestError === "Connect Telegram before starting a scan." ? (
              <a
                href="/settings/telegram"
                className="mt-2 inline-flex rounded-md border border-current/30 px-2.5 py-1.5 text-xs font-semibold hover:bg-amber-500/10"
              >
                Connect Telegram
              </a>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {!status.error && !requestError && completionMessage ? (
        <div className="mt-4 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-3.5" />
          {completionMessage}
        </div>
      ) : null}
    </section>
  );
}

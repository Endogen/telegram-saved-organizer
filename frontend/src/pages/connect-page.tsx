import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck, Smartphone, Unplug } from "lucide-react";
import { Link } from "react-router";

import {
  connectTelegram,
  disconnectTelegram,
  fetchTelegramConnection,
  verifyTelegram,
} from "@/api/auth";
import { ApiRequestError } from "@/api/client";
import { ConnectForm } from "@/components/auth/connect-form";
import { VerifyCode } from "@/components/auth/verify-code";
import { Button } from "@/components/ui/button";
import type { ConnectTelegramPayload, TelegramConnection, VerifyTelegramPayload } from "@/types/auth";

type Operation = "loading" | "refreshing" | "connecting" | "verifying" | "disconnecting";

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 429) {
      return "Too many Telegram sign-in attempts. Wait a moment and try again.";
    }
    if (error.detail === "telegram_account_already_connected") {
      return "This Telegram account is already connected to another organizer account.";
    }
    if (error.detail === "telegram_connection_failed") {
      return "Telegram could not start the connection. Check the phone number and try again.";
    }
    if (error.detail === "telegram_verification_failed") {
      return "Telegram could not verify those credentials. Check the code or password and try again.";
    }
    if (error.detail === "telegram_challenge_expired") {
      return "This Telegram sign-in attempt expired. Start again with your phone number.";
    }
    if (error.detail === "telegram_challenge_missing") {
      return "No active Telegram sign-in attempt was found. Start again with your phone number.";
    }
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Request failed. Check your connection and try again.";
}

function stateTitle(connection: TelegramConnection): string {
  switch (connection.state) {
    case "code_required":
      return "Verification code required";
    case "password_required":
      return "Two-step verification required";
    case "connected":
      return "Telegram connected";
    case "disconnected":
      return "Not connected";
  }
}

function challengePhone(connection: Extract<TelegramConnection, { state: "code_required" | "password_required" }>) {
  return connection.phone_masked?.trim() || "your Telegram account";
}

export function ConnectPage() {
  const [connection, setConnection] = useState<TelegramConnection | null>(null);
  const [operation, setOperation] = useState<Operation | null>("loading");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const activeRequestRef = useRef(true);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const shouldReduceMotion = useReducedMotion();

  const loadConnection = useCallback(async (initial = false) => {
    if (activeRequestRef.current && !initial) {
      return;
    }

    activeRequestRef.current = true;
    const requestId = ++requestIdRef.current;
    setStatusError(null);
    setFormError(null);
    setOperation(initial ? "loading" : "refreshing");

    try {
      const nextConnection = await fetchTelegramConnection();
      if (mountedRef.current && requestId === requestIdRef.current) {
        setConnection(nextConnection);
      }
    } catch (error) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setStatusError(toErrorMessage(error));
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        activeRequestRef.current = false;
        setOperation(null);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadConnection(true);

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      activeRequestRef.current = false;
    };
  }, [loadConnection]);

  const handleConnect = useCallback(async (payload: ConnectTelegramPayload) => {
    if (activeRequestRef.current) {
      return;
    }

    activeRequestRef.current = true;
    const requestId = ++requestIdRef.current;
    setFormError(null);
    setStatusError(null);
    setOperation("connecting");

    try {
      const nextConnection = await connectTelegram(payload);
      if (mountedRef.current && requestId === requestIdRef.current) {
        setConnection(nextConnection);
      }
    } catch (error) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setFormError(toErrorMessage(error));
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        activeRequestRef.current = false;
        setOperation(null);
      }
    }
  }, []);

  const handleVerify = useCallback(async (payload: VerifyTelegramPayload) => {
    if (activeRequestRef.current) {
      return;
    }

    activeRequestRef.current = true;
    const requestId = ++requestIdRef.current;
    setFormError(null);
    setStatusError(null);
    setOperation("verifying");

    try {
      const nextConnection = await verifyTelegram(payload);
      if (mountedRef.current && requestId === requestIdRef.current) {
        setConnection(nextConnection);
      }
    } catch (error) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setFormError(toErrorMessage(error));
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        activeRequestRef.current = false;
        setOperation(null);
      }
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (activeRequestRef.current || connection === null || connection.state === "disconnected") {
      return;
    }

    const isConnected = connection.state === "connected";
    const confirmed = window.confirm(
      isConnected
        ? "Disconnect Telegram? Future scans will stop, but messages already imported into the organizer will remain."
        : "Cancel this Telegram sign-in attempt and use a different phone number?",
    );
    if (!confirmed) {
      return;
    }

    activeRequestRef.current = true;
    const requestId = ++requestIdRef.current;
    setFormError(null);
    setStatusError(null);
    setOperation("disconnecting");

    try {
      const nextConnection = await disconnectTelegram();
      if (mountedRef.current && requestId === requestIdRef.current) {
        setConnection(nextConnection);
      }
    } catch (error) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setStatusError(toErrorMessage(error));
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        activeRequestRef.current = false;
        setOperation(null);
      }
    }
  }, [connection]);

  const isBusy = operation !== null;
  const activeStep = !connection || connection.state === "disconnected" ? 1 : connection.state === "connected" ? 3 : 2;

  return (
    <section className="mx-auto w-full max-w-3xl" aria-labelledby="telegram-connection-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-600 dark:text-sky-400">
            Account connection
          </p>
          <h2 id="telegram-connection-title" className="mt-1 text-2xl font-semibold text-[hsl(var(--foreground))]">
            Telegram connection
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-[hsl(var(--muted-foreground))] md:text-base">
            Connect the Telegram account that contains the Saved Messages you want to organize. API credentials are
            configured securely by the server and are never requested here.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadConnection(false)}
          disabled={isBusy}
          className="min-h-11 shrink-0 gap-1.5 self-start"
        >
          <RefreshCw className={operation === "refreshing" ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
          {operation === "refreshing" ? "Refreshing..." : "Refresh status"}
        </Button>
      </div>

      <ol className="mt-6 grid grid-cols-3 gap-2" aria-label="Telegram connection progress">
        {["Phone", "Verify", "Connected"].map((label, index) => {
          const step = index + 1;
          const isCurrent = activeStep === step;
          const isComplete = activeStep > step;
          return (
            <li
              key={label}
              aria-current={isCurrent ? "step" : undefined}
              className={
                isCurrent || isComplete
                  ? "rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-2 text-center text-xs font-semibold text-sky-700 sm:text-sm dark:text-sky-300"
                  : "rounded-lg border border-[hsl(var(--border))] px-2 py-2 text-center text-xs text-[hsl(var(--muted-foreground))] sm:text-sm"
              }
            >
              {isComplete ? <span className="sr-only">Completed: </span> : null}
              {label}
            </li>
          );
        })}
      </ol>

      <div className="mt-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.9)] p-4 shadow-sm md:p-6">
        {connection ? (
          <div className="flex flex-col gap-3 border-b border-[hsl(var(--border))] pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400">
                <Smartphone className="size-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
                  Current status
                </p>
                <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">{stateTitle(connection)}</h3>
              </div>
            </div>

            {connection.state !== "disconnected" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleDisconnect()}
                disabled={isBusy}
                className="min-h-11 gap-1.5 sm:self-center"
              >
                <Unplug className="size-4" aria-hidden="true" />
                {operation === "disconnecting"
                  ? connection.state === "connected"
                    ? "Disconnecting..."
                    : "Cancelling..."
                  : connection.state === "connected"
                    ? "Disconnect Telegram"
                    : "Use a different number"}
              </Button>
            ) : null}
          </div>
        ) : null}

        {statusError ? (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200" role="alert">
            <p>{statusError}</p>
            {!connection ? (
              <Button variant="outline" size="sm" className="mt-3 min-h-11" onClick={() => void loadConnection(false)} disabled={isBusy}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5" aria-live="polite">
          {operation === "loading" && !connection ? (
            <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-[hsl(var(--muted-foreground))]" role="status">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Loading Telegram connection...
            </div>
          ) : null}

          {connection ? (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={connection.state}
                initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
                transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }}
              >
                {connection.state === "disconnected" ? (
                  <div className="space-y-5">
                    <div>
                      <h3 className="text-xl font-semibold text-[hsl(var(--foreground))]">Connect your account</h3>
                      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
                        Enter your Telegram phone number. You will confirm the connection using a code from Telegram
                        and, if enabled, your two-step verification password.
                      </p>
                    </div>
                    <ConnectForm isSubmitting={operation === "connecting"} error={formError} onSubmit={handleConnect} />
                  </div>
                ) : null}

                {connection.state === "code_required" || connection.state === "password_required" ? (
                  <div className="space-y-5">
                    <div>
                      <h3 className="text-xl font-semibold text-[hsl(var(--foreground))]">
                        {connection.state === "password_required" ? "Enter your Telegram password" : "Enter the sign-in code"}
                      </h3>
                      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
                        {connection.state === "password_required"
                          ? `Telegram accepted the code for ${challengePhone(connection)}. Enter the two-step verification password to finish.`
                          : `Telegram sent a sign-in code for ${challengePhone(connection)}. Enter it below to continue.`}
                      </p>
                    </div>
                    <VerifyCode
                      passwordRequired={connection.state === "password_required"}
                      isSubmitting={operation === "verifying"}
                      error={formError}
                      onSubmit={handleVerify}
                    />
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      Having trouble? Check Telegram on your signed-in devices, or use a different number to restart.
                    </p>
                  </div>
                ) : null}

                {connection.state === "connected" ? (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 md:p-5">
                    <div className="flex items-start gap-3 text-emerald-800 dark:text-emerald-200">
                      <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                      <div>
                        <h3 className="text-base font-semibold">
                          {connection.account?.display_name?.trim() || "Your Telegram account"} is ready
                        </h3>
                        {connection.account?.username || connection.account?.phone_masked ? (
                          <p className="mt-1 text-sm">
                            {connection.account.username ? `@${connection.account.username.replace(/^@/, "")}` : null}
                            {connection.account.username && connection.account.phone_masked ? " · " : null}
                            {connection.account.phone_masked}
                          </p>
                        ) : null}
                        <p className="mt-2 text-sm">
                          You can now scan and organize Saved Messages. Disconnecting later stops future scans but does
                          not remove messages already imported into the organizer.
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                        <CheckCircle2 className="size-3.5" aria-hidden="true" />
                        Ready to scan
                      </div>
                      <Link
                        to="/"
                        className="inline-flex min-h-11 items-center justify-center rounded-md bg-[hsl(var(--primary))] px-4 text-sm font-semibold text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary)/0.92)]"
                      >
                        Open scanner dashboard
                      </Link>
                    </div>
                  </div>
                ) : null}
              </motion.div>
            </AnimatePresence>
          ) : null}
        </div>
      </div>
    </section>
  );
}

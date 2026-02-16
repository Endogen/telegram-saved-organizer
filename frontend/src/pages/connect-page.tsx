import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck, Unplug } from "lucide-react";

import { connectTelegram, disconnectTelegram, fetchTelegramAuthStatus, verifyTelegram } from "@/api/auth";
import { ConnectForm } from "@/components/auth/connect-form";
import { VerifyCode } from "@/components/auth/verify-code";
import { Button } from "@/components/ui/button";
import type { ConnectTelegramPayload, TelegramAuthStatus, VerifyTelegramPayload } from "@/types/auth";

const INITIAL_AUTH_STATUS: TelegramAuthStatus = {
  connected: false,
  authorized: false,
  has_session: false,
  verification_required: false,
  password_required: false,
};

type FlowStep = "connect" | "verify" | "authorized";

type StatusChipProps = {
  label: string;
  active: boolean;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Request failed. Check backend logs and try again.";
}

function getFlowStep(status: TelegramAuthStatus): FlowStep {
  if (status.authorized) {
    return "authorized";
  }
  if (status.verification_required) {
    return "verify";
  }
  return "connect";
}

function StatusChip({ label, active }: StatusChipProps) {
  return (
    <div
      className={
        active
          ? "rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300"
          : "rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background)/0.8)] px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]"
      }
    >
      {label}
    </div>
  );
}

export function ConnectPage() {
  const [status, setStatus] = useState<TelegramAuthStatus>(INITIAL_AUTH_STATUS);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const refreshStatus = useCallback(async (isInitial = false) => {
    setStatusError(null);
    if (isInitial) {
      setIsInitialLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const currentStatus = await fetchTelegramAuthStatus();
      setStatus(currentStatus);
    } catch (error) {
      setStatusError(toErrorMessage(error));
    } finally {
      if (isInitial) {
        setIsInitialLoading(false);
      } else {
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshStatus(true);
  }, [refreshStatus]);

  const handleConnect = useCallback(async (payload: ConnectTelegramPayload) => {
    setConnectError(null);
    setVerifyError(null);
    setStatusError(null);
    setIsConnecting(true);

    try {
      const nextStatus = await connectTelegram(payload);
      setStatus(nextStatus);
    } catch (error) {
      setConnectError(toErrorMessage(error));
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const handleVerify = useCallback(async (payload: VerifyTelegramPayload) => {
    setVerifyError(null);
    setStatusError(null);
    setIsVerifying(true);

    try {
      const nextStatus = await verifyTelegram(payload);
      setStatus(nextStatus);
    } catch (error) {
      setVerifyError(toErrorMessage(error));
      try {
        const currentStatus = await fetchTelegramAuthStatus();
        setStatus(currentStatus);
      } catch {
        // Keep existing state when status refresh fails after a verify error.
      }
    } finally {
      setIsVerifying(false);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    setStatusError(null);
    setConnectError(null);
    setVerifyError(null);
    setIsDisconnecting(true);

    try {
      const disconnectedStatus = await disconnectTelegram();
      setStatus(disconnectedStatus);
    } catch (error) {
      setStatusError(toErrorMessage(error));
    } finally {
      setIsDisconnecting(false);
    }
  }, []);

  const flowStep = getFlowStep(status);
  const canDisconnect =
    status.connected || status.has_session || status.verification_required || status.authorized;
  const isRefreshDisabled = isInitialLoading || isConnecting || isVerifying || isDisconnecting || isRefreshing;

  return (
    <section className="mx-auto w-full max-w-2xl">
      <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Connect Telegram</h2>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))] md:text-base">
        Start with API credentials and phone number, then verify the code (or 2FA password) to authorize Saved
        Messages access. Get your API ID and hash from{" "}
        <a
          href="https://my.telegram.org/apps"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-sky-600 underline decoration-sky-600/30 underline-offset-2 transition hover:text-sky-500 hover:decoration-sky-500/50 dark:text-sky-400 dark:decoration-sky-400/30 dark:hover:text-sky-300"
        >
          my.telegram.org/apps
        </a>
        .
      </p>

      <div className="mt-6 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.9)] p-4 md:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
              Session State
            </p>
            <h3 className="mt-1 text-lg font-semibold text-[hsl(var(--foreground))]">
              {status.authorized ? "Authorized" : status.verification_required ? "Verification Required" : "Not Connected"}
            </h3>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshStatus(false)}
              disabled={isRefreshDisabled}
              className="gap-1.5"
            >
              <RefreshCw className={isRefreshing ? "size-4 animate-spin" : "size-4"} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleDisconnect()}
              disabled={!canDisconnect || isDisconnecting}
              className="gap-1.5"
            >
              <Unplug className="size-4" />
              {isDisconnecting ? "Disconnecting..." : "Disconnect"}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <StatusChip label={status.connected ? "Connected to Telegram" : "Not connected"} active={status.connected} />
          <StatusChip label={status.authorized ? "Authorized" : "Not authorized"} active={status.authorized} />
          <StatusChip label={status.has_session ? "Session found" : "No local session"} active={status.has_session} />
          <StatusChip
            label={status.password_required ? "2FA password required" : "Code verification available"}
            active={status.password_required}
          />
        </div>

        {statusError ? (
          <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            {statusError}
          </p>
        ) : null}

        <div className="mt-5 rounded-xl border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--card)/0.95)] p-4">
          {isInitialLoading ? (
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
              <LoaderCircle className="size-4 animate-spin" />
              Loading Telegram auth status...
            </div>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={flowStep}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                {flowStep === "connect" ? (
                  <ConnectForm isSubmitting={isConnecting} error={connectError} onSubmit={handleConnect} />
                ) : null}

                {flowStep === "verify" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">
                      {status.password_required
                        ? "Telegram requested your 2FA password. Submit it to complete sign-in."
                        : "Enter the verification code sent by Telegram to finish connecting."}
                    </p>
                    <VerifyCode
                      passwordRequired={status.password_required}
                      isSubmitting={isVerifying}
                      error={verifyError}
                      onSubmit={handleVerify}
                    />
                  </div>
                ) : null}

                {flowStep === "authorized" ? (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                      <ShieldCheck className="size-5" />
                      <p className="text-base font-semibold">Telegram session is authorized.</p>
                    </div>
                    <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
                      You can now run scans and manage Saved Messages from the dashboard.
                    </p>
                    <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="size-3.5" />
                      Ready to scan
                    </div>
                  </div>
                ) : null}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>
    </section>
  );
}

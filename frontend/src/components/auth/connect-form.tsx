import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ConnectTelegramPayload } from "@/types/auth";

interface ConnectFormProps {
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (payload: ConnectTelegramPayload) => void;
}

export function ConnectForm({ isSubmitting, error, onSubmit }: ConnectFormProps) {
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (error) {
      setLocalError(null);
    }
  }, [error]);

  const visibleError = localError ?? error;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedApiId = apiId.trim();
    const normalizedApiHash = apiHash.trim();
    const normalizedPhone = phone.trim();

    if (!/^\d+$/.test(normalizedApiId)) {
      setLocalError("API ID must be a positive number.");
      return;
    }
    const parsedApiId = Number(normalizedApiId);
    if (!Number.isSafeInteger(parsedApiId) || parsedApiId <= 0 || parsedApiId > 2_147_483_647) {
      setLocalError("API ID must be a positive number.");
      return;
    }
    if (!/^[0-9a-fA-F]{32}$/.test(normalizedApiHash)) {
      setLocalError("API Hash must be exactly 32 hexadecimal characters.");
      return;
    }
    if (normalizedPhone.length < 5) {
      setLocalError("Phone number looks too short.");
      return;
    }

    setLocalError(null);
    onSubmit({ apiId: parsedApiId, apiHash: normalizedApiHash, phone: normalizedPhone });
  }

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]" htmlFor="telegram-api-id">
            API ID
          </label>
          <input
            id="telegram-api-id"
            inputMode="numeric"
            autoComplete="off"
            required
            disabled={isSubmitting}
            aria-invalid={Boolean(visibleError)}
            aria-describedby={visibleError ? "telegram-connection-error" : undefined}
            value={apiId}
            onChange={(event) => setApiId(event.target.value)}
            placeholder="12345678"
            className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm text-[hsl(var(--foreground))] outline-none ring-[hsl(var(--ring))] transition focus:ring-2"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]" htmlFor="telegram-api-hash">
            API Hash
          </label>
          <input
            id="telegram-api-hash"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            disabled={isSubmitting}
            aria-invalid={Boolean(visibleError)}
            aria-describedby={visibleError ? "telegram-connection-error" : undefined}
            value={apiHash}
            onChange={(event) => setApiHash(event.target.value)}
            placeholder="32-character API hash"
            className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm text-[hsl(var(--foreground))] outline-none ring-[hsl(var(--ring))] transition focus:ring-2"
          />
        </div>
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        Create your own Telegram application at{" "}
        <a className="font-semibold text-[hsl(var(--primary))] underline-offset-4 hover:underline" href="https://my.telegram.org/apps" target="_blank" rel="noreferrer">
          my.telegram.org/apps
        </a>
        . Your API hash is encrypted for your account and is never shown again.
      </p>

      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]" htmlFor="telegram-phone">
          Phone Number
        </label>
        <input
          id="telegram-phone"
          type="tel"
          autoComplete="tel"
          required
          disabled={isSubmitting}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+1 555 000 0000"
          aria-invalid={Boolean(visibleError)}
          aria-describedby={visibleError ? "telegram-connection-error" : "telegram-phone-help"}
          className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm text-[hsl(var(--foreground))] outline-none ring-[hsl(var(--ring))] transition focus:ring-2"
        />
        <p id="telegram-phone-help" className="text-xs text-[hsl(var(--muted-foreground))]">
          Include the country calling code. Telegram will send a sign-in code to this account.
        </p>
      </div>

      {visibleError ? (
        <p id="telegram-connection-error" role="alert" className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {visibleError}
        </p>
      ) : null}

      <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
        {isSubmitting ? "Sending code..." : "Continue with Telegram"}
      </Button>
    </form>
  );
}

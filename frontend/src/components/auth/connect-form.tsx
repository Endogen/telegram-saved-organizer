import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ConnectTelegramPayload } from "@/types/auth";

type ConnectFormProps = {
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (payload: ConnectTelegramPayload) => Promise<void> | void;
};

function inputClassName(): string {
  return "h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm text-[hsl(var(--foreground))] outline-none ring-[hsl(var(--ring))] transition focus:ring-2";
}

export function ConnectForm({ isSubmitting, error, onSubmit }: ConnectFormProps) {
  const [phone, setPhone] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const displayError = validationError ?? error;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    const trimmedPhone = phone.trim();
    if (trimmedPhone.length < 3) {
      setValidationError("Phone number looks too short.");
      return;
    }

    void onSubmit({
      phone: trimmedPhone,
    });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <div className="space-y-1">
        <label
          htmlFor="telegram-phone"
          className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]"
        >
          Phone Number
        </label>
        <input
          id="telegram-phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+1 555 000 0000"
          className={inputClassName()}
          disabled={isSubmitting}
          aria-invalid={displayError ? true : undefined}
          aria-describedby={displayError ? "telegram-phone-error" : "telegram-phone-help"}
          required
        />
        <p id="telegram-phone-help" className="text-xs text-[hsl(var(--muted-foreground))]">
          Include the country calling code. Telegram will send a sign-in code to this account.
        </p>
      </div>

      {displayError ? (
        <p
          id="telegram-phone-error"
          role="alert"
          className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          {displayError}
        </p>
      ) : null}

      <Button className="w-full sm:w-auto" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Sending code..." : "Continue with Telegram"}
      </Button>
    </form>
  );
}

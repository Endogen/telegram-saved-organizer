import { type FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { VerifyTelegramPayload } from "@/types/auth";

type VerifyCodeProps = {
  passwordRequired: boolean;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (payload: VerifyTelegramPayload) => Promise<void> | void;
};

function inputClassName(): string {
  return "h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm text-[hsl(var(--foreground))] outline-none ring-[hsl(var(--ring))] transition focus:ring-2";
}

export function VerifyCode({ passwordRequired, isSubmitting, error, onSubmit }: VerifyCodeProps) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setValidationError(null);
    setCode("");
    setPassword("");
  }, [passwordRequired]);

  const displayError = validationError ?? error;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    if (passwordRequired) {
      const trimmedPassword = password.trim();
      if (trimmedPassword.length === 0) {
        setValidationError("Two-factor password is required.");
        return;
      }
      void onSubmit({ password: trimmedPassword });
      return;
    }

    const trimmedCode = code.trim();
    if (trimmedCode.length === 0) {
      setValidationError("Verification code is required.");
      return;
    }

    void onSubmit({ code: trimmedCode });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-1">
        <label
          htmlFor={passwordRequired ? "telegram-password" : "telegram-verification-code"}
          className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]"
        >
          {passwordRequired ? "Two-Factor Password" : "Verification Code"}
        </label>
        <input
          id={passwordRequired ? "telegram-password" : "telegram-verification-code"}
          type={passwordRequired ? "password" : "text"}
          autoComplete={passwordRequired ? "current-password" : "one-time-code"}
          value={passwordRequired ? password : code}
          onChange={(event) => {
            if (passwordRequired) {
              setPassword(event.target.value);
              return;
            }
            setCode(event.target.value);
          }}
          placeholder={passwordRequired ? "Your Telegram 2FA password" : "12345"}
          className={inputClassName()}
          disabled={isSubmitting}
        />
      </div>

      {displayError ? (
        <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {displayError}
        </p>
      ) : null}

      <Button className="w-full sm:w-auto" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Verifying..." : passwordRequired ? "Verify Password" : "Verify Code"}
      </Button>
    </form>
  );
}

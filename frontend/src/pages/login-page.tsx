import { type FormEvent, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LoaderCircle, LockKeyhole, LogIn } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";

import { ApiRequestError } from "@/api/client";
import { useAuth } from "@/components/auth/auth-provider";
import { getSafeReturnTo } from "@/components/auth/route-guards";
import { Button } from "@/components/ui/button";

type FieldErrors = Partial<Record<"email" | "password", string>>;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) {
      return "The email or password is incorrect.";
    }
    if (error.status === 429) {
      return "Too many sign-in attempts. Wait a moment and try again.";
    }
    return error.message;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Could not sign in. Please try again.";
}

export function LoginPage() {
  const { login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();
    const nextFieldErrors: FieldErrors = {};
    if (!normalizedEmail) {
      nextFieldErrors.email = "Enter your email address.";
    } else if (!EMAIL_PATTERN.test(normalizedEmail)) {
      nextFieldErrors.email = "Enter a valid email address.";
    }
    if (password.length === 0) {
      nextFieldErrors.password = "Enter your password.";
    }
    setFieldErrors(nextFieldErrors);
    setError(null);
    if (Object.keys(nextFieldErrors).length > 0) {
      (nextFieldErrors.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setIsSubmitting(true);
    try {
      await login({ email: normalizedEmail, password });
      navigate(getSafeReturnTo(location.state) ?? "/", { replace: true });
    } catch (requestError) {
      setError(loginErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <div className="inline-flex size-11 items-center justify-center rounded-2xl bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]">
        <LockKeyhole className="size-5" />
      </div>
      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--primary))]">Welcome back</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[hsl(var(--foreground))]">Sign in to your archive</h1>
      <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
        Continue organizing the messages and ideas you saved for later.
      </p>

      {error ? (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-700 outline-none focus:ring-2 focus:ring-red-500/50 dark:text-red-200"
        >
          {error}
        </div>
      ) : null}

      <form className="mt-7 space-y-5" onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="login-email" className="text-sm font-semibold text-[hsl(var(--foreground))]">Email address</label>
          <input
            id="login-email"
            ref={emailRef}
            name="email"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setFieldErrors((current) => ({ ...current, email: undefined }));
            }}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
            className="mt-2 h-12 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.8)] px-4 text-sm text-[hsl(var(--foreground))] outline-none transition placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary)/0.75)] focus:ring-4 focus:ring-[hsl(var(--primary)/0.12)]"
            placeholder="you@example.com"
          />
          {fieldErrors.email ? <p id="login-email-error" className="mt-2 text-sm text-red-700 dark:text-red-300">{fieldErrors.email}</p> : null}
        </div>

        <div>
          <label htmlFor="login-password" className="text-sm font-semibold text-[hsl(var(--foreground))]">Password</label>
          <div className="relative mt-2">
            <input
              id="login-password"
              ref={passwordRef}
              name="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setFieldErrors((current) => ({ ...current, password: undefined }));
              }}
              autoComplete="current-password"
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
              className="h-12 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.8)] px-4 pr-12 text-sm text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary)/0.75)] focus:ring-4 focus:ring-[hsl(var(--primary)/0.12)]"
            />
            <button
              type="button"
              className="absolute right-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {fieldErrors.password ? <p id="login-password-error" className="mt-2 text-sm text-red-700 dark:text-red-300">{fieldErrors.password}</p> : null}
        </div>

        <Button type="submit" size="lg" className="min-h-11 w-full gap-2" disabled={isSubmitting}>
          {isSubmitting ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <LogIn className="size-4" />}
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-7 text-center text-sm text-[hsl(var(--muted-foreground))]">
        New to Saved Organizer?{" "}
        <Link className="font-semibold text-[hsl(var(--primary))] underline-offset-4 hover:underline" to="/register" state={location.state}>
          Create an account
        </Link>
      </p>
    </div>
  );
}

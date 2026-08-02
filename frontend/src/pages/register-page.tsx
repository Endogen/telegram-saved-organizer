import { type FormEvent, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LoaderCircle, UserPlus } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";

import { ApiRequestError } from "@/api/client";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";

type RegistrationField = "displayName" | "email" | "password" | "passwordConfirmation";
type FieldErrors = Partial<Record<RegistrationField, string>>;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function registrationErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 429) {
      return "Too many attempts. Wait a moment and try again.";
    }
    return "We could not complete registration or sign you in. Check your details, then try signing in if you may already have an account.";
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Could not complete registration. Please try again.";
}

export function RegisterPage() {
  const { register } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const passwordConfirmationRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  function clearFieldError(field: RegistrationField) {
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedDisplayName = displayName.trim();
    const normalizedEmail = email.trim();
    const nextFieldErrors: FieldErrors = {};
    if (!normalizedDisplayName) {
      nextFieldErrors.displayName = "Enter the name you want us to show.";
    }
    if (!normalizedEmail) {
      nextFieldErrors.email = "Enter your email address.";
    } else if (!EMAIL_PATTERN.test(normalizedEmail)) {
      nextFieldErrors.email = "Enter a valid email address.";
    }
    if (password.length < 12) {
      nextFieldErrors.password = "Use at least 12 characters.";
    }
    if (passwordConfirmation !== password) {
      nextFieldErrors.passwordConfirmation = "The passwords do not match.";
    }
    setFieldErrors(nextFieldErrors);
    setError(null);
    if (Object.keys(nextFieldErrors).length > 0) {
      const firstInvalidField = nextFieldErrors.displayName
        ? displayNameRef
        : nextFieldErrors.email
          ? emailRef
          : nextFieldErrors.password
            ? passwordRef
            : passwordConfirmationRef;
      firstInvalidField.current?.focus();
      return;
    }

    setIsSubmitting(true);
    try {
      await register({
        email: normalizedEmail,
        display_name: normalizedDisplayName,
        password,
      });
      navigate("/onboarding/telegram", { replace: true });
    } catch (requestError) {
      setError(registrationErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--primary))]">Create your workspace</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[hsl(var(--foreground))]">Start organizing what matters</h1>
      <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
        Create your account, then connect Telegram when you are ready.
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

      <form className="mt-7 space-y-4" onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="register-display-name" className="text-sm font-semibold text-[hsl(var(--foreground))]">Display name</label>
          <input
            id="register-display-name"
            ref={displayNameRef}
            name="name"
            value={displayName}
            onChange={(event) => { setDisplayName(event.target.value); clearFieldError("displayName"); }}
            autoComplete="name"
            autoFocus
            aria-invalid={Boolean(fieldErrors.displayName)}
            aria-describedby={fieldErrors.displayName ? "register-display-name-error" : undefined}
            className="mt-2 h-12 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.8)] px-4 text-sm text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary)/0.75)] focus:ring-4 focus:ring-[hsl(var(--primary)/0.12)]"
            placeholder="Ada Lovelace"
          />
          {fieldErrors.displayName ? <p id="register-display-name-error" className="mt-2 text-sm text-red-700 dark:text-red-300">{fieldErrors.displayName}</p> : null}
        </div>

        <div>
          <label htmlFor="register-email" className="text-sm font-semibold text-[hsl(var(--foreground))]">Email address</label>
          <input
            id="register-email"
            ref={emailRef}
            name="email"
            type="email"
            value={email}
            onChange={(event) => { setEmail(event.target.value); clearFieldError("email"); }}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "register-email-error" : undefined}
            className="mt-2 h-12 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.8)] px-4 text-sm text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary)/0.75)] focus:ring-4 focus:ring-[hsl(var(--primary)/0.12)]"
            placeholder="you@example.com"
          />
          {fieldErrors.email ? <p id="register-email-error" className="mt-2 text-sm text-red-700 dark:text-red-300">{fieldErrors.email}</p> : null}
        </div>

        <div>
          <label htmlFor="register-password" className="text-sm font-semibold text-[hsl(var(--foreground))]">Password</label>
          <div className="relative mt-2">
            <input
              id="register-password"
              ref={passwordRef}
              name="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => { setPassword(event.target.value); clearFieldError("password"); }}
              autoComplete="new-password"
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby="register-password-help register-password-error"
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
          <p id="register-password-help" className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Use at least 12 characters.</p>
          {fieldErrors.password ? <p id="register-password-error" className="mt-1 text-sm text-red-700 dark:text-red-300">{fieldErrors.password}</p> : null}
        </div>

        <div>
          <label htmlFor="register-password-confirmation" className="text-sm font-semibold text-[hsl(var(--foreground))]">Confirm password</label>
          <input
            id="register-password-confirmation"
            ref={passwordConfirmationRef}
            name="password-confirmation"
            type={showPassword ? "text" : "password"}
            value={passwordConfirmation}
            onChange={(event) => { setPasswordConfirmation(event.target.value); clearFieldError("passwordConfirmation"); }}
            autoComplete="new-password"
            aria-invalid={Boolean(fieldErrors.passwordConfirmation)}
            aria-describedby={fieldErrors.passwordConfirmation ? "register-password-confirmation-error" : undefined}
            className="mt-2 h-12 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.8)] px-4 text-sm text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary)/0.75)] focus:ring-4 focus:ring-[hsl(var(--primary)/0.12)]"
          />
          {fieldErrors.passwordConfirmation ? <p id="register-password-confirmation-error" className="mt-2 text-sm text-red-700 dark:text-red-300">{fieldErrors.passwordConfirmation}</p> : null}
        </div>

        <Button type="submit" size="lg" className="min-h-11 w-full gap-2" disabled={isSubmitting}>
          {isSubmitting ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <UserPlus className="size-4" />}
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-7 text-center text-sm text-[hsl(var(--muted-foreground))]">
        Already have an account?{" "}
        <Link className="font-semibold text-[hsl(var(--primary))] underline-offset-4 hover:underline" to="/login" state={location.state}>
          Sign in
        </Link>
      </p>
    </div>
  );
}

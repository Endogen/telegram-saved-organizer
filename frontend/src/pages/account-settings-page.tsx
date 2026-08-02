import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound, LoaderCircle, Save, Trash2, UserRound } from "lucide-react";

import { changePassword, deleteAccount, fetchAccount, updateAccount } from "@/api/account";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { StatePanel } from "@/components/ui/state-panel";
import type { AccountUser } from "@/types/account";

const INPUT_CLASS_NAME =
  "mt-2 h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/0.72)] px-3 text-sm text-[hsl(var(--foreground))] outline-none transition placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary)/0.7)] focus:ring-4 focus:ring-[hsl(var(--primary)/0.12)] disabled:cursor-not-allowed disabled:opacity-60";

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

export function AccountSettingsPage() {
  const { logout, refreshSession } = useAuth();
  const [account, setAccount] = useState<AccountUser | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadAccount = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const nextAccount = await fetchAccount(signal);
      setAccount(nextAccount);
      setDisplayName(nextAccount.display_name);
    } catch (error) {
      if (!signal?.aborted) {
        setLoadError(toErrorMessage(error, "Could not load your account."));
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadAccount(controller.signal);
    return () => controller.abort();
  }, [loadAccount]);

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedDisplayName = displayName.trim();

    setProfileError(null);
    setProfileSuccess(null);
    if (normalizedDisplayName.length === 0) {
      setProfileError("Enter your display name.");
      return;
    }
    setIsSavingProfile(true);
    try {
      const updatedAccount = await updateAccount({
        display_name: normalizedDisplayName,
      });
      setAccount(updatedAccount);
      setDisplayName(updatedAccount.display_name);
      setProfileSuccess("Account details saved.");
      try {
        await refreshSession();
      } catch {
        // The profile is already saved; the next session refresh will update shared account chrome.
      }
    } catch (error) {
      setProfileError(toErrorMessage(error, "Could not save your account details."));
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (currentPassword.length === 0) {
      setPasswordError("Enter your current password.");
      return;
    }
    if (newPassword.length < 12) {
      setPasswordError("Your new password must be at least 12 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("Choose a password that is different from your current password.");
      return;
    }

    setIsChangingPassword(true);
    try {
      await changePassword({ current_password: currentPassword, new_password: newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess("Password changed successfully.");
    } catch (error) {
      setPasswordError(toErrorMessage(error, "Could not change your password."));
    } finally {
      setIsChangingPassword(false);
    }
  }

  async function handleDeleteAccount() {
    if (deletePassword.length === 0) {
      setDeleteError("Enter your current password.");
      return;
    }
    if (deleteConfirmation !== "DELETE") {
      setDeleteError('Type "DELETE" exactly to confirm.');
      return;
    }

    setDeleteError(null);
    setIsDeleting(true);
    try {
      await deleteAccount({ password: deletePassword, confirmation: "DELETE" });
      try {
        await logout();
      } catch {
        // AuthProvider clears local identity even if the already-deleted session returns 401.
      }
    } catch (error) {
      setDeleteError(toErrorMessage(error, "Could not delete your account."));
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <section className="mx-auto w-full max-w-3xl" aria-busy="true">
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-[hsl(var(--muted-foreground))]" role="status">
          <LoaderCircle className="size-5 animate-spin" />
          Loading account settings…
        </div>
      </section>
    );
  }

  if (loadError !== null || account === null) {
    return (
      <section className="mx-auto w-full max-w-3xl">
        <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Account settings</h2>
        <StatePanel
          tone="error"
          title="Could not load your account"
          description={loadError ?? "The account response was empty."}
          className="mt-6"
          action={
            <Button variant="outline" size="sm" onClick={() => void loadAccount()}>
              Try again
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl">
      <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Account settings</h2>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))] md:text-base">
        Manage your profile, password, and organizer account.
      </p>

      <form
        onSubmit={handleProfileSubmit}
        noValidate
        className="mt-6 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.92)] p-4 md:p-5"
      >
        <div className="flex items-center gap-2">
          <UserRound className="size-5 text-[hsl(var(--primary))]" />
          <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">Profile</h3>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-[hsl(var(--foreground))]">
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
              disabled={isSavingProfile}
              aria-invalid={profileError?.includes("display name") || undefined}
              aria-describedby="profile-status"
              className={INPUT_CLASS_NAME}
            />
          </label>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/0.55)] px-3 py-2.5">
            <p className="text-sm font-semibold text-[hsl(var(--foreground))]">Email address</p>
            <p className="mt-1 break-all text-sm text-[hsl(var(--foreground))]">{account.email}</p>
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
              This is your sign-in identity and cannot be changed here.
            </p>
          </div>
        </div>
        <div id="profile-status" aria-live="polite" className="mt-3 min-h-5 text-sm">
          {profileError ? <p className="font-medium text-red-600 dark:text-red-300">{profileError}</p> : null}
          {profileSuccess ? <p className="font-medium text-emerald-700 dark:text-emerald-300">{profileSuccess}</p> : null}
        </div>
        <Button type="submit" className="mt-2 gap-2" disabled={isSavingProfile}>
          {isSavingProfile ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          {isSavingProfile ? "Saving…" : "Save profile"}
        </Button>
      </form>

      <form
        onSubmit={handlePasswordSubmit}
        noValidate
        className="mt-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.92)] p-4 md:p-5"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="size-5 text-[hsl(var(--primary))]" />
          <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">Change password</h3>
        </div>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          Use at least 12 characters. Spaces are preserved exactly as entered.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-[hsl(var(--foreground))] sm:col-span-2">
            Current password
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              disabled={isChangingPassword}
              aria-invalid={passwordError !== null || undefined}
              aria-describedby="password-status"
              className={INPUT_CLASS_NAME}
            />
          </label>
          <label className="text-sm font-semibold text-[hsl(var(--foreground))]">
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              disabled={isChangingPassword}
              aria-invalid={passwordError !== null || undefined}
              aria-describedby="password-help password-status"
              className={INPUT_CLASS_NAME}
            />
          </label>
          <label className="text-sm font-semibold text-[hsl(var(--foreground))]">
            Confirm new password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              disabled={isChangingPassword}
              aria-invalid={passwordError !== null || undefined}
              aria-describedby="password-status"
              className={INPUT_CLASS_NAME}
            />
          </label>
        </div>
        <p id="password-help" className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
          Your password is sent only when you submit this form.
        </p>
        <div id="password-status" aria-live="polite" className="mt-3 min-h-5 text-sm">
          {passwordError ? <p className="font-medium text-red-600 dark:text-red-300">{passwordError}</p> : null}
          {passwordSuccess ? <p className="font-medium text-emerald-700 dark:text-emerald-300">{passwordSuccess}</p> : null}
        </div>
        <Button type="submit" className="mt-2 gap-2" disabled={isChangingPassword}>
          {isChangingPassword ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          {isChangingPassword ? "Changing…" : "Change password"}
        </Button>
      </form>

      <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 p-4 md:p-5">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
          <Trash2 className="size-5" />
          <h3 className="text-lg font-semibold">Delete account</h3>
        </div>
        <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
          Permanently delete your organizer account and its stored data. Enter your current password and type DELETE
          to confirm. This does not delete messages from Telegram.
        </p>

        {isConfirmingDelete ? (
          <div className="mt-4 rounded-lg border border-red-500/25 bg-[hsl(var(--card)/0.8)] p-3">
            <label className="text-sm font-semibold text-[hsl(var(--foreground))]">
              Current password for deletion
              <input
                type="password"
                value={deletePassword}
                onChange={(event) => {
                  setDeletePassword(event.target.value);
                  setDeleteError(null);
                }}
                autoComplete="current-password"
                disabled={isDeleting}
                aria-invalid={deleteError?.includes("password") || undefined}
                aria-describedby="delete-status"
                className={INPUT_CLASS_NAME}
              />
            </label>
            <label className="text-sm font-semibold text-[hsl(var(--foreground))]">
              Type DELETE to confirm
              <input
                value={deleteConfirmation}
                onChange={(event) => {
                  setDeleteConfirmation(event.target.value);
                  setDeleteError(null);
                }}
                autoComplete="off"
                spellCheck={false}
                disabled={isDeleting}
                aria-invalid={deleteError !== null || undefined}
                aria-describedby="delete-status"
                className={INPUT_CLASS_NAME}
              />
            </label>
            <div id="delete-status" aria-live="polite" className="mt-2 min-h-5 text-sm">
              {deleteError ? <p className="font-medium text-red-600 dark:text-red-300">{deleteError}</p> : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsConfirmingDelete(false);
                  setDeletePassword("");
                  setDeleteConfirmation("");
                  setDeleteError(null);
                }}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleDeleteAccount()}
                disabled={isDeleting || deletePassword.length === 0 || deleteConfirmation !== "DELETE"}
                className="gap-2 bg-red-600 text-white hover:bg-red-700"
              >
                {isDeleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {isDeleting ? "Deleting…" : "Permanently delete account"}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            className="mt-4 gap-2 border-red-500/35 text-red-700 hover:bg-red-500/10 dark:text-red-300"
            onClick={() => setIsConfirmingDelete(true)}
          >
            <Trash2 className="size-4" />
            Delete account
          </Button>
        )}
      </div>
    </section>
  );
}

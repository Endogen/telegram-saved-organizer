import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CircleUserRound, Link2, LogOut, MonitorSmartphone, Settings } from "lucide-react";
import { Link } from "react-router";

import { useAuth } from "@/components/auth/auth-provider";
import { cn } from "@/lib/utils";

const MENU_ITEM_SELECTOR = '[role="menuitem"]';

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Could not sign out. Please try again.";
}

export function AccountMenu() {
  const { user, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  function openMenu() {
    setError(null);
    setIsOpen(true);
    window.requestAnimationFrame(() => {
      containerRef.current?.querySelector<HTMLElement>(MENU_ITEM_SELECTOR)?.focus();
    });
  }

  function closeMenu({ restoreFocus = false } = {}) {
    setIsOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }

    const items = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? []).filter(
      (item) => item.getAttribute("aria-disabled") !== "true",
    );
    if (items.length === 0) {
      return;
    }

    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex: number;
    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    } else if (event.key === "ArrowDown") {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    } else {
      nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    }
    items[nextIndex]?.focus();
  }

  async function handleLogout() {
    setError(null);
    setIsSigningOut(true);
    try {
      await logout();
      setIsOpen(false);
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      setIsSigningOut(false);
    }
  }

  if (user === null) {
    return null;
  }

  const displayName = user.display_name.trim() || user.email;
  const avatarLabel = displayName.charAt(0).toLocaleUpperCase();

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="account-menu"
        aria-label={`Open account menu for ${displayName}`}
        onClick={() => (isOpen ? closeMenu({ restoreFocus: true }) : openMenu())}
        className="flex min-h-11 items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-1.5 text-left transition hover:bg-[hsl(var(--muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))] sm:px-3"
      >
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--primary)/0.16)] text-sm font-bold text-[hsl(var(--primary))]">
          {avatarLabel}
        </span>
        <span className="hidden min-w-0 max-w-44 sm:block">
          <span className="block truncate text-sm font-semibold text-[hsl(var(--foreground))]">{displayName}</span>
          <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">{user.email}</span>
        </span>
        <CircleUserRound className="hidden size-4 shrink-0 text-[hsl(var(--muted-foreground))] sm:block" />
      </button>

      {isOpen ? (
        <div
          id="account-menu"
          role="menu"
          aria-label="Account"
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 z-50 mt-2 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1.5 shadow-xl"
        >
          <div className="border-b border-[hsl(var(--border)/0.75)] px-3 py-2.5 sm:hidden">
            <p className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">{displayName}</p>
            <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{user.email}</p>
          </div>

          <Link
            to="/settings/account"
            role="menuitem"
            className="mt-1 flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[hsl(var(--foreground))] outline-none transition hover:bg-[hsl(var(--muted))] focus:bg-[hsl(var(--muted))] sm:mt-0"
            onClick={() => closeMenu()}
          >
            <Settings className="size-4 text-[hsl(var(--muted-foreground))]" />
            Account settings
          </Link>
          <Link
            to="/settings/sessions"
            role="menuitem"
            className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[hsl(var(--foreground))] outline-none transition hover:bg-[hsl(var(--muted))] focus:bg-[hsl(var(--muted))]"
            onClick={() => closeMenu()}
          >
            <MonitorSmartphone className="size-4 text-[hsl(var(--muted-foreground))]" />
            Active sessions
          </Link>
          <Link
            to="/settings/telegram"
            role="menuitem"
            className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[hsl(var(--foreground))] outline-none transition hover:bg-[hsl(var(--muted))] focus:bg-[hsl(var(--muted))]"
            onClick={() => closeMenu()}
          >
            <Link2 className="size-4 text-[hsl(var(--muted-foreground))]" />
            Telegram connection
          </Link>

          <div className="my-1 border-t border-[hsl(var(--border)/0.75)]" />
          <button
            type="button"
            role="menuitem"
            aria-disabled={isSigningOut}
            disabled={isSigningOut}
            onClick={() => void handleLogout()}
            className={cn(
              "flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-red-600 outline-none transition hover:bg-red-500/10 focus:bg-red-500/10 dark:text-red-300",
              isSigningOut && "opacity-60",
            )}
          >
            <LogOut className="size-4" />
            {isSigningOut ? "Signing out…" : "Sign out"}
          </button>
          {error ? (
            <p role="alert" className="mx-2 mb-1 mt-2 text-xs font-medium text-red-600 dark:text-red-300">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

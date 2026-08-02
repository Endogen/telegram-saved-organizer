# Multi-user code and UX audit

Branch: `codex/multi-user-auth`

Audit date: 2026-08-02

Browser: Codex in-app browser with Playwright-backed controls

Desktop viewport: 1280 × 720

Mobile viewport: 390 × 844

## Outcome

The primary account, Telegram setup, scan, library, organization, session, keyboard, and mobile workflows are usable after the fixes in this review. The audit found and corrected several real correctness defects: wrong-password reauthentication logged users out, registration could bypass onboarding, fallback category IDs could target another tenant's rows, duplicate Telegram verification could destroy a valid connection, clear-and-rescan was non-atomic, route animation rendered duplicate page trees, account-menu Enter activation failed, and production health checks used a Host value rejected by the API.

The live Telegram OTP/password exchange was not exercised against a real Telegram account. Its state machine and retry boundaries are covered by automated tests, and browser testing stopped at the safe phone-entry boundary.

## Tested user flows

### Flow 1 — Account entry and onboarding

1. Description: Open the signed-out product and review the sign-in form, password visibility control, account-creation path, and explanatory copy. Health check: **Pass** — the form is clear, keyboard reachable, and visually balanced at desktop size. Evidence: [sign in](01-sign-in.png).
2. Description: Submit invalid credentials. Health check: **Pass** — the response is generic and does not disclose whether the email exists. Evidence: [sign-in error](02-sign-in-error.png).
3. Description: Submit registration with mismatched passwords. Health check: **Pass** — focus moves to the invalid field and an inline, accessible error explains the correction. Evidence: [registration validation](03-registration-validation.png).
4. Description: Start from a protected URL, switch from sign-in to registration, and create an account. Health check: **Pass after fix** — the new account always lands on Telegram onboarding; the protected return path can no longer skip setup. Before: [onboarding bypass](04-new-account-dashboard.png). After: [correct onboarding](11-registration-onboarding-fixed.jpg).
5. Description: Sign out and sign back in. Health check: **Pass** — session state, protected routing, and account-specific UI reset correctly. A failed network logout now preserves the authenticated UI instead of pretending the server session ended.

### Flow 2 — Telegram connection

1. Description: Open Telegram onboarding/settings while disconnected. Health check: **Pass** — status, three-step progression, privacy explanation, country-code guidance, and phone input are understandable. Evidence: [Telegram connect](05-telegram-connect.png).
2. Description: Continue beyond phone entry into Telegram OTP and optional 2FA. Health check: **Safe boundary / automated** — no real account was contacted; code/password validation, expiry, identity conflicts, and duplicate verification are covered by tests. Duplicate verification is now idempotent and cannot erase an already-connected session.
3. Description: Disconnect or switch Telegram principals. Health check: **Automated pass, operational caveat** — tenant generation fencing is strong, but live remote logout and reconnect behavior still need staging credentials before release.

### Flow 3 — Scan lifecycle

1. Description: Start a scan while Telegram is disconnected. Health check: **Pass after fix** — the UI now says “Connect Telegram before starting a scan,” provides a connection link, and hides the raw `telegram_not_connected` code. Evidence: [scanner guidance](12-disconnected-scan-guidance-fixed.jpg).
2. Description: Refresh and stop a scan. Health check: **Automated pass** — busy-state guards prevent overlapping start, stop, refresh, and clear operations; SSE falls back to polling.
3. Description: Clear imported data and start a fresh scan. Health check: **Pass after fix** — clear-and-rescan is one server transaction, so a failed job creation cannot leave the library empty.
4. Description: Revoke/logout while an SSE stream is already connected. Health check: **Pass after fix** — the stream revalidates its originating web session at the heartbeat and terminates after revocation or expiry.

### Flow 4 — Message discovery

1. Description: Open a realistically populated library. Health check: **Pass** — six seeded messages, category counts, media types, URLs, timestamps, and tags render without duplicate route trees. Evidence: [populated library](09-populated-message-library.jpg).
2. Description: Search message content for “accessibility.” Health check: **Pass** — the server-backed result narrows to the matching React reference with a correct total.
3. Description: Filter by the Unicode tag `Straße`. Health check: **Pass after fix** — normalized-name filtering returns the expected message; the previous `lower(name)` comparison failed for Unicode casefolding.
4. Description: Filter by category and change sort order. Health check: **Pass** — filtering and sorting are understandable and consistently server-backed.
5. Description: Open full message details, inspect metadata, and close with Escape. Health check: **Pass after fix** — the modal receives initial focus, traps Tab navigation, closes with Escape, and restores focus to the originating button.
6. Description: Activate “Skip to main content.” Health check: **Pass** — focus moves to the main landmark.

### Flow 5 — Message organization

1. Description: Move a message while viewing its original category. Health check: **Pass after fix** — the moved row leaves the filtered result, totals refetch, and sidebar category counts update immediately.
2. Description: Add and remove an existing tag in the tag dialog. Health check: **Pass** — both operations update in place and retain usable focus.
3. Description: Select two messages and bulk-move them to Other. Health check: **Pass after fix** — the mutation clears selection and refreshes sidebar counts (`Other 2`, `Links 1`).
4. Description: Delete a single message or a bulk selection with and without Telegram connectivity. Health check: **Automated pass** — confirmation and local-only fallback paths are covered; browser deletion was intentionally not applied to preserve the seeded visual audit set.
5. Description: Drag a message to a category while category data is unavailable. Health check: **Pass after fix** — display-only fallback categories never emit mutations with fabricated IDs.

### Flow 6 — Account and sessions

1. Description: Update the display name. Health check: **Pass** — the saved profile propagates to shared account chrome.
2. Description: Submit a wrong current password. Health check: **Pass after fix** — the valid session remains active and the page shows human-readable inline guidance. Before: [unexpected logout](06-wrong-password-unexpected-logout.png). After: [correct inline error](10-account-password-error-fixed.jpg).
3. Description: Open active sessions and revoke another browser. Health check: **Pass** — the current session is identified, another session can be revoked, and cross-tenant session IDs return not found. Evidence: [active sessions](07-active-sessions.png).
4. Description: Open the account menu, move focus with ArrowDown, and activate Active sessions with Enter. Health check: **Pass after fix** — keyboard activation navigates reliably and Escape restores trigger focus.
5. Description: Delete the account with password and explicit `DELETE` confirmation. Health check: **Automated pass** — server cookies and data are cleared; the client now explicitly clears in-memory identity even if the follow-up logout sees the already-removed session.

### Flow 7 — Multi-user isolation

1. Description: Create a second account and inspect its initial library. Health check: **Pass** — it has its own eight categories with zero counts and cannot see the first account's six seeded messages. Evidence: [empty library](08-empty-message-library.png).
2. Description: Sign back into the first account. Health check: **Pass** — its six messages, category counts, tags, and profile are restored unchanged.
3. Description: Attempt cross-tenant message, tag, category, and session identifiers. Health check: **Automated pass** — every tested cross-tenant resource request returns 404.

### Flow 8 — Mobile and responsive behavior

1. Description: Open and close the 390 px mobile navigation drawer. Health check: **Pass** — focus enters the drawer, Escape closes it, body scrolling is locked, and focus returns to the menu button.
2. Description: Navigate to the populated message library at 390 × 844. Health check: **Pass** — filters stack logically, controls remain reachable, cards use one column, and document width equals viewport width with no horizontal overflow. Evidence: [mobile library](13-mobile-message-library.jpg).
3. Description: Use the compact account trigger and main actions at mobile size. Health check: **Pass** — controls maintain usable touch sizes and meaningful accessible names.

## Code and deployment improvements applied

- Corrected 401/403 semantics for reauthentication, suppressed false global sign-outs, and preserved UI state on logout network failure.
- Made completed Telegram verification idempotent.
- Bound established scan streams to their originating revocable web session.
- Made clear-and-rescan atomic and made disconnected-scan errors actionable.
- Prevented fallback category IDs from being used for move or drag mutations.
- Refetched filtered message results and category counts after organization mutations.
- Fixed Unicode tag filtering and bounded database-facing identifiers and page numbers.
- Removed duplicate route rendering caused by an animated `Outlet` transition.
- Added modal focus trapping/restoration, state-panel live-region semantics, page navigation semantics, keyboard menu activation, reduced-motion consistency, and stronger light-theme/destructive contrast.
- Fixed the production health-check Host header, upgraded nginx to the current patched stable line, upgraded `cryptography`, rejected copied example placeholders, hardened SPA asset caching, and documented private environment-file permissions.

## Remaining risks and recommendations

1. Description: Email ownership. Health check: **Needs product/security work** — accounts are usable immediately without email verification, so a user can pre-register someone else's address. Add verified-email ownership before opening unrestricted public registration.
2. Description: Live Telegram integration. Health check: **Needs staging validation** — run OTP, 2FA, expired challenge, reconnect, duplicate-submit, and remote delete against a dedicated Telegram test account.
3. Description: Long Telegram calls. Health check: **Needs architectural work** — some connect/verify/scan paths retain database locks or transactions across remote calls. Split remote I/O from short compare-and-swap persistence phases.
4. Description: Scan resilience. Health check: **Needs enhancement** — durable leases are strong, but there is no per-page retry/backoff/resume policy or worker health endpoint/heartbeat for orchestration.
5. Description: Organization management. Health check: **Needs product work** — the backend supports category management, but the UI has no dedicated create/rename/recolor/reorder category or tag-management surface.
6. Description: Durable discovery state. Health check: **Needs polish** — category is URL-backed, but search, tag, sort, and page state are not shareable/bookmarkable; tag counts describe only the loaded page.
7. Description: Production confidence. Health check: **Partially verified** — Compose renders successfully and a fresh SQLite migration is clean; add PostgreSQL CI, a real container build/smoke test, API database readiness, worker health, and stricter trusted-proxy configuration.

## Verification summary

- Backend: 250 tests passed; Ruff passed; dependency lock and package compatibility passed; one Alembic head; fresh upgrade and schema check passed.
- Frontend: 37 test files and 279 tests passed; TypeScript and production Vite build passed.
- Operations: production Compose configuration rendered successfully; source diff whitespace check passed.
- Browser: all flows above were exercised with the in-app Playwright-backed browser, except the explicitly identified live Telegram and destructive-delete boundaries.

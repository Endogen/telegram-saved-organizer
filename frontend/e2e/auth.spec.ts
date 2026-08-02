import { expect, test } from "@playwright/test";

import { registerThroughUi, TEST_PASSWORD } from "./support/workflows";

test("a user can register, sign out, sign back in, and navigate by keyboard on mobile", async ({ page }) => {
  const account = { displayName: "Ada Browser", email: "auth-e2e@example.com" };
  await registerThroughUi(page, account);

  const accountMenuTrigger = page.getByRole("button", { name: `Open account menu for ${account.displayName}` });
  await accountMenuTrigger.click();
  await expect(page.getByRole("menuitem", { name: "Account settings" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Active sessions" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(accountMenuTrigger).toBeFocused();

  await accountMenuTrigger.click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in to your archive" })).toBeVisible();

  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding\/telegram$/);
  await page.waitForLoadState("networkidle");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.waitForLoadState("networkidle");

  await page.setViewportSize({ width: 390, height: 844 });
  const navigationToggle = page.getByRole("button", { name: "Toggle navigation" });
  await expect(navigationToggle).toBeVisible();
  await navigationToggle.click();
  await expect(navigationToggle).toHaveAttribute("aria-expanded", "true");

  const tagsLink = page.getByRole("link", { name: "Tags", exact: true });
  await tagsLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings\/tags$/);
  await expect(page.getByRole("heading", { name: "Tag management" })).toBeVisible();
  await expect(navigationToggle).toHaveAttribute("aria-expanded", "false");
});

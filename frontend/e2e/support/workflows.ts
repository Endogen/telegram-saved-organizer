import { expect, type Page } from "@playwright/test";

export const TEST_PASSWORD = "Correct horse battery staple! 2026";

type TestAccount = {
  displayName: string;
  email: string;
};

export async function registerThroughUi(page: Page, account: TestAccount) {
  await page.goto("/register");
  await page.getByLabel("Display name").fill(account.displayName);
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding\/telegram$/);
  await expect(page.getByRole("heading", { name: "Set up Telegram" })).toBeVisible();
}

export async function createCategoryThroughUi(page: Page, name: string) {
  await page.goto("/settings/categories");
  await expect(page.getByRole("heading", { name: "Categories", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New category" }).click();
  const dialog = page.getByRole("dialog", { name: "Create category" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create category" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: name })).toBeVisible();
}

export async function createTagThroughUi(page: Page, name: string) {
  await page.goto("/settings/tags");
  await expect(page.getByRole("heading", { name: "Tags", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New tag" }).click();
  const dialog = page.getByRole("dialog", { name: "Create tag" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create tag" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: `#${name}` })).toBeVisible();
}

import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  createCategoryThroughUi,
  createTagThroughUi,
  registerThroughUi,
} from "./support/workflows";

test("message-library controls hydrate from and persist to a shareable URL", async ({ page }) => {
  await registerThroughUi(page, {
    displayName: "Filter Tester",
    email: `filters-e2e-${randomUUID()}@example.com`,
  });
  await createCategoryThroughUi(page, "Research Queue");
  await createTagThroughUi(page, "reference");

  await page.goto(
    "/messages?category=research-queue&q=weekly%20plan&tag=reference&sort=date_asc&per_page=30",
  );
  const search = page.getByRole("textbox", { name: "Search messages" });
  await expect(search).toHaveValue("weekly plan");
  await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue("research-queue");
  await expect(page.getByRole("combobox", { name: "Sort" })).toHaveValue("date_asc");
  await expect(page.getByRole("combobox", { name: "Per page" })).toHaveValue("30");
  await expect(page.getByRole("button", { name: "#reference" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(search).toHaveValue("weekly plan");
  await expect(page.getByRole("button", { name: "#reference" })).toHaveAttribute("aria-pressed", "true");

  await search.fill("project notes");
  await page.getByRole("combobox", { name: "Sort" }).selectOption("category");
  await page.getByRole("combobox", { name: "Per page" }).selectOption("120");
  await page.getByRole("button", { name: "#reference" }).click();

  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("project notes");
  const persistedUrl = new URL(page.url());
  expect(persistedUrl.searchParams.get("category")).toBe("research-queue");
  expect(persistedUrl.searchParams.get("sort")).toBe("category");
  expect(persistedUrl.searchParams.get("per_page")).toBe("120");
  expect(persistedUrl.searchParams.has("tag")).toBe(false);

  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Sort" })).toHaveValue("date_desc");
  const clearedUrl = new URL(page.url());
  expect([...clearedUrl.searchParams.entries()]).toEqual([["per_page", "120"]]);
});

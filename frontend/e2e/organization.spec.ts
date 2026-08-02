import { expect, test } from "@playwright/test";

import { registerThroughUi } from "./support/workflows";

test("category and tag management support complete create, edit, browse, and delete workflows", async ({ page }) => {
  await registerThroughUi(page, {
    displayName: "Organization Tester",
    email: "organization-e2e@example.com",
  });

  await page.goto("/settings/categories");
  await page.getByRole("button", { name: "New category" }).click();
  await expect(page.getByRole("dialog", { name: "Create category" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Create category" })).toHaveCount(0);

  await page.getByRole("button", { name: "New category" }).click();
  let dialog = page.getByRole("dialog", { name: "Create category" });
  await dialog.getByLabel("Name").fill("Project Alpha");
  await dialog.getByLabel("Sort order").fill("25");
  await dialog.getByRole("button", { name: "Create category" }).click();
  await expect(page.getByText("Created “Project Alpha”.")).toBeVisible();

  let categoryItem = page.getByRole("listitem").filter({ hasText: "Project Alpha" });
  await categoryItem.getByRole("button", { name: "Edit Project Alpha" }).click();
  dialog = page.getByRole("dialog", { name: "Edit Project Alpha" });
  await dialog.getByLabel("Name").fill("Project Archive");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved “Project Archive”.")).toBeVisible();

  categoryItem = page.getByRole("listitem").filter({ hasText: "Project Archive" });
  await categoryItem.getByRole("link", { name: "View messages in Project Archive" }).click();
  await expect(page).toHaveURL(/\/messages\?category=project-archive$/);
  await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue("project-archive");

  await page.goto("/settings/categories");
  categoryItem = page.getByRole("listitem").filter({ hasText: "Project Archive" });
  await categoryItem.getByRole("button", { name: "Delete Project Archive" }).click();
  dialog = page.getByRole("dialog", { name: "Delete “Project Archive”?" });
  await dialog.getByRole("button", { name: "Delete category" }).click();
  await expect(page.getByText("Deleted “Project Archive”.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Project Archive" })).toHaveCount(0);

  await page.goto("/settings/tags");
  await page.getByRole("button", { name: "New tag" }).click();
  dialog = page.getByRole("dialog", { name: "Create tag" });
  await dialog.getByLabel("Name").fill("follow-up");
  await dialog.getByRole("button", { name: "Create tag" }).click();
  await expect(page.getByText("Created #follow-up.")).toBeVisible();

  let tagItem = page.getByRole("listitem").filter({ hasText: "#follow-up" });
  await tagItem.getByRole("button", { name: "Edit #follow-up" }).click();
  dialog = page.getByRole("dialog", { name: "Edit #follow-up" });
  await dialog.getByLabel("Name").fill("next-action");
  await dialog.getByLabel("Use a custom color").uncheck();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved #next-action.")).toBeVisible();

  tagItem = page.getByRole("listitem").filter({ hasText: "#next-action" });
  await tagItem.getByRole("link", { name: "View messages tagged #next-action" }).click();
  await expect(page).toHaveURL(/\/messages\?tag=next-action$/);
  await expect(page.getByRole("button", { name: "#next-action", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.goto("/settings/tags");
  tagItem = page.getByRole("listitem").filter({ hasText: "#next-action" });
  await tagItem.getByRole("button", { name: "Delete #next-action" }).click();
  dialog = page.getByRole("dialog", { name: "Delete #next-action?" });
  await dialog.getByRole("button", { name: "Delete tag" }).click();
  await expect(page.getByText(/Deleted #next-action and removed it from 0 messages\./)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "#next-action" })).toHaveCount(0);
});

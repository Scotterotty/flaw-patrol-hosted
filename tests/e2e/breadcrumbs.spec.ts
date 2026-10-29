import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `B${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("breadcrumbs next to the logo lead back up to Projects", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Crumbs ${KEY}`, KEY);
  await page.goto(`/p/${KEY}/cases/new`);

  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs).toHaveText(new RegExp(`Umbrellas›Crumbs ${KEY}›Test cases›New`));
  await crumbs.getByRole("link", { name: "Test cases" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases$`));
  await crumbs.getByRole("link", { name: "Umbrellas" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(crumbs).toHaveText("Umbrellas");
});

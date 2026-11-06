import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `F${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("a case can be flagged from a run, found in Test cases, and cleared", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/");
  await standaloneProject(page, `Flags ${KEY}`, KEY);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases`));
  for (const title of ["Login works", "Logout works"]) {
    await page.goto(`/p/${KEY}/cases/new`);
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Step 1 action").fill("Do it");
    await page.getByRole("button", { name: "Create case" }).first().click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Both");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
  const runNumber = page.url().match(/runs\/(\d+)/)![1];

  // Flag the case being run.
  await page.goto(page.url() + "/execute");
  await expect(page.getByRole("heading", { name: "Login works", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Flag", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Steps unclear").click();
  await dialog.getByLabel("Note (optional)").fill("Which account should log in?");
  await dialog.getByRole("button", { name: "Flag case" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Steps unclear" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Run list" }).getByTitle("Flagged: Steps unclear")).toHaveCount(1);

  // Test cases shows the flag and can list just the flagged ones.
  await page.goto(`/p/${KEY}/cases`);
  await expect(page.getByRole("img", { name: "Flagged: Steps unclear" })).toHaveCount(1);
  await page.getByRole("link", { name: "1 flagged" }).click();
  await expect(page).toHaveURL(/flagged=1/);
  await expect(page.getByRole("link", { name: "Login works" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Logout works" })).toHaveCount(0);

  // The case page says why, and the flag can be cleared there.
  await page.getByRole("link", { name: "Login works" }).click();
  const note = page.getByRole("note");
  await expect(note).toContainText("Flagged: Steps unclear");
  await expect(note).toContainText("Which account should log in?");
  await expect(note.getByRole("link", { name: "testing a run" })).toBeVisible();
  await page.getByRole("button", { name: "Steps unclear" }).click();
  await dialog.getByRole("button", { name: "Clear flag" }).click();
  await expect(note).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Flag", exact: true })).toBeVisible();
  await page.goto(`/p/${KEY}/cases`);
  await expect(page.getByRole("img", { name: /^Flagged/ })).toHaveCount(0);
});

import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `L${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("the run list tucks finished cases away under Assigned to me", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/");
  await standaloneProject(page, `Run list ${KEY}`, KEY);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases`));
  for (const title of ["Alpha", "Bravo", "Charlie"]) {
    await page.goto(`/p/${KEY}/cases/new`);
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Step 1 action").fill("Do it");
    await page.getByRole("button", { name: "Create case" }).first().click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Three");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByLabel("Assign every case to").selectOption({ label: "Me (Demo Admin)" });
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);

  await page.goto(page.url() + "/execute?mine=1");
  const list = page.getByRole("list", { name: "Run list" });
  await expect(page.getByRole("heading", { name: "Run list" })).toBeVisible();
  await expect(page.getByText("3 to go")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alpha", level: 1 })).toBeVisible();
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Save and next" }).click();

  // On Bravo, Alpha is folded into Done.
  await expect(page.getByRole("heading", { name: "Bravo", level: 1 })).toBeVisible();
  await expect(page.getByText("2 to go")).toBeVisible();
  await expect(list.getByRole("link", { name: /Alpha/ })).toHaveCount(0);
  await list.getByRole("button", { name: "Done (1) Show" }).click();
  await expect(list.getByRole("link", { name: /Alpha/ })).toBeVisible();
  // It stays open on the next case.
  await page.keyboard.press("p");
  await page.getByRole("button", { name: /Save and (next|finish)/ }).click();
  // Let the save land before reloading the list.
  await expect(page.getByText("1 to go")).toBeVisible();
  await page.goto(page.url().replace(/\/runs\/(\d+).*/, "/runs/$1/execute?mine=1"));
  await expect(list.getByRole("button", { name: "Done (2) Hide" })).toBeVisible();

  // All cases still lists everything in place.
  await page.getByRole("link", { name: "All cases" }).click();
  await expect(list.getByRole("button", { name: /^Done/ })).toHaveCount(0);
  await expect(list.getByRole("link", { name: /Alpha/ })).toBeVisible();
});

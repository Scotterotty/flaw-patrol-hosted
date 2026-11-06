import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `O${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("the project overview shows runs in progress, my work and flagged cases", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/");
  await standaloneProject(page, `Overview ${KEY}`, KEY);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases`));
  for (const title of ["Sign in", "Sign out"]) {
    await page.goto(`/p/${KEY}/cases/new`);
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Step 1 action").fill("Do it");
    await page.getByRole("button", { name: "Create case" }).first().click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }

  // Opening a project from the projects page lands on its overview, which has nothing in progress yet.
  await page.goto("/");
  // (Checked by its link, then opened: with hundreds of test projects the page can still be settling.)
  await expect(page.getByRole("link", { name: `Overview ${KEY}`, exact: true })).toHaveAttribute("href", `/p/${KEY}`);
  await page.goto(`/p/${KEY}`);
  await expect(page.getByRole("heading", { name: `Overview ${KEY}`, level: 1 })).toBeVisible();
  await expect(page.getByText("No runs in progress.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Overview", exact: true }).first()).toHaveAttribute("class", /bg-accent-100/);

  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Both");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByLabel("Assign every case to").selectOption({ label: "Me (Demo Admin)" });
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);

  await page.goto(page.url() + "/execute?mine=1");
  await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" }).click();
  await page.getByRole("button", { name: "Save and next" }).click();
  await expect(page.getByRole("heading", { name: "Sign out", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Flag", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Flag case" }).click();
  await expect(page.getByRole("button", { name: "Needs updating" })).toBeVisible();

  // The breadcrumb's project name leads to the overview.
  await page.getByRole("navigation", { name: /breadcrumb/i }).getByRole("link", { name: `Overview ${KEY}` }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}$`));
  const runs = page.getByRole("heading", { name: "Runs in progress" }).locator("xpath=../..");
  await expect(runs).toContainText("1 of 2 tested · 100% passed");
  await expect(runs).toContainText("1 of yours to go");
  const mine = page.getByRole("heading", { name: "My work" }).locator("xpath=../..");
  await expect(mine.getByRole("link", { name: /Both/ })).toContainText("1 to go");
  const flagged = page.getByRole("heading", { name: "Flagged cases" }).locator("xpath=../..");
  await expect(flagged).toContainText("Sign out");
  await expect(flagged).toContainText("Needs updating");
  await expect(page.getByRole("link", { name: /Test cases\s*2\s*1 flagged/ })).toBeVisible();
  await expect(page.getByTestId("cycle-nothing-yet")).toContainText("open bugs");
  await mine.getByRole("link", { name: /Both/ }).click();
  await expect(page.getByRole("heading", { name: "Sign out", level: 1 })).toBeVisible();

  // Continue testing picks the run up where it was left.
  await page.goto(`/p/${KEY}`);
  await runs.getByRole("link", { name: /^Continue testing Both/ }).click();
  await expect(page.getByRole("heading", { name: "Sign out", level: 1 })).toBeVisible();
});

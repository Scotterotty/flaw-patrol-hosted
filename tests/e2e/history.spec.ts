import { expect, test } from "@playwright/test";
import { signIn, backToRun } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `H${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("the runner shows the case's history, and a known bug can be re-reported in one click", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `History ${KEY}`, KEY);
  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Bing");
  for (const [i, text] of ["Glonk", "Pip", "Small"].entries()) {
    if (i > 0) await page.getByRole("button", { name: "+ Add step" }).click();
    await page.getByLabel(`Step ${i + 1} action`).fill(text);
  }
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Bing" })).toBeVisible();
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Smoke");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page.getByRole("button", { name: "Create a run" })).toBeVisible();
  const suiteUrl = page.url();

  const startRun = async () => {
    await page.goto(suiteUrl);
    await page.getByRole("button", { name: "Create a run" }).click();
    await page.getByRole("button", { name: "Create run", exact: true }).click();
    await expect(page).toHaveURL(/\/runs\/\d+$/);
    await page.getByRole("link", { name: "Start testing" }).click();
    await expect(page.getByRole("heading", { name: "Bing" })).toBeVisible();
  };
  const history = page.getByRole("region", { name: "Execution history" });

  // Run 1: step 2 fails with a bug.
  await startRun();
  await expect(history).toContainText("hasn't been run before");
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" }).click();
  await page.getByRole("group", { name: "Step 2 status" }).getByRole("button", { name: "Failed" }).click();
  await page.getByLabel("Step 2 actual result").fill("Pip went pop");
  await page.getByRole("button", { name: "Report bug" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Summary").fill("Pip pops");
  await dialog.getByRole("button", { name: "Save bug" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: /Save and (next|finish)/ }).click();
  await backToRun(page);

  // Run 2: the history panel shows run 1; clicking its pip shows the details.
  await startRun();
  await expect(history).toContainText("1 run");
  // Open by default; collapsing leaves the summary line, and the choice is remembered.
  await expect(history).toContainText("D-1");
  await history.getByRole("button", { name: "Collapse" }).click();
  await expect(history.getByRole("listitem")).toHaveCount(0);
  await page.reload();
  await expect(history.getByRole("button", { name: "Expand" })).toBeVisible();
  await expect(history.getByRole("listitem")).toHaveCount(0);
  await history.getByRole("button", { name: "Expand" }).click();
  await expect(history).toContainText("D-1");
  await history.getByRole("button", { name: /^R1 failed/ }).click();
  await expect(history).toContainText("Actual: Pip went pop");
  await expect(history.getByRole("link", { name: "D-1 Pip pops" }).first()).toHaveAttribute("href", `/p/${KEY}/bugs#D-1`);
  await history.getByRole("button", { name: "Bug still occurs" }).click();

  await expect(page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Step 2 status" }).getByRole("button", { name: "Failed" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Step 2 actual result")).toHaveValue("Pip went pop");
  await expect(page.getByLabel("Comment")).toHaveValue("Bug still occurs: D-1 (same as R1).");
  await expect(page.getByRole("button", { name: "Unlink bug" })).toHaveCount(1);
  await page.getByRole("button", { name: /Save and (next|finish)/ }).click();
  await backToRun(page);

  // The bug is linked to the new run too.
  await page.goto(`/p/${KEY}/cases/1`);
  const rows = page.getByRole("row").filter({ hasText: "Failed" });
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) await expect(row).toContainText("D-1");

  // Back to the list when no pip is picked.
  await startRun();
  await history.getByRole("button", { name: /^R2 failed/ }).click();
  await history.getByRole("button", { name: "← All executions" }).click();
  await expect(history.getByRole("listitem")).toHaveCount(2);
});

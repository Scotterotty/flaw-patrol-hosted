import { expect, test, type Page } from "@playwright/test";
import { signIn, backToRun } from "./auth";
import { standaloneProject } from "./projects";

// Milestone 2: a versioned suite, a run against a release, the
// step-by-step runner with Jira bugs (against tests/e2e/mock-jira.mjs), the run
// dashboard, a case's execution history and the reports.

const run = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `X${run}`;
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;
const shots = process.env.SCREENSHOT_DIR;
const snap = async (page: Page, name: string, fullPage = true) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage });
};

async function newCase(page: Page, title: string, steps: [string, string][]) {
  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill(title);
  for (let i = 0; i < steps.length; i++) {
    if (i > 0) await page.getByRole("button", { name: "+ Add step" }).click();
    await page.getByLabel(`Step ${i + 1} action`).fill(steps[i][0]);
    await page.getByLabel(`Step ${i + 1} expected result`).fill(steps[i][1]);
  }
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("suites, runs, Jira bugs and reports", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(`${page.url()}: ${m.text()}`));
  page.on("pageerror", (e) => consoleErrors.push(`${page.url()}: ${e.message}`));
  await signIn(page, "admin@example.com", "Demo Admin");

  await standaloneProject(page, `Exec ${run}`, KEY);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases`));

  // Connect the mock Jira
  await page.goto(`/p/${KEY}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("QA");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText(`Connected to ${JIRA}, Jira project QA`)).toBeVisible();

  await newCase(page, "Checkout with saved card", [
    ["Open the cart", "Cart lists 2 items"],
    ["Click Pay", "Payment form opens"],
    ["Confirm payment", "Order confirmation shown"],
  ]);
  await newCase(page, "Apply discount code", [
    ["Enter SAVE10", "Code accepted"],
    ["Check total", "Total is 10% lower"],
  ]);

  // Suite, version 1 with case 1 only
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Checkout regression");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page.getByRole("heading", { name: "Checkout regression" })).toBeVisible();

  // Version 2 adds case 2
  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByRole("button", { name: /Add all 1 shown/ }).click();
  await page.getByLabel("What changed? (optional)").fill("Added discount case");
  await page.getByRole("button", { name: "Save suite" }).click();
  await expect(page.getByText("Added discount case")).toBeVisible();
  await snap(page, "suite");

  // Run against an RC
  await page.getByRole("button", { name: "Start test run" }).click();
  await page.getByLabel("Release", { exact: true }).fill("2.4.0-rc1");
  await page.getByLabel("Build").fill("#1482");
  await page.getByLabel("Open the first case when it starts").uncheck();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/runs/1$`));
  await page.getByRole("link", { name: "Start testing" }).click();

  // Case 1: pass step 1, fail step 2 and file a Jira bug, link an existing one to step 3
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" }).click();
  await page.getByRole("group", { name: "Step 2 status" }).getByRole("button", { name: "Failed" }).click();
  await page.getByLabel("Step 2 actual result").fill("Spinner never stops");
  await page.getByRole("button", { name: "Report bug in Jira" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Spinner never stops")).toBeVisible();
  await expect(dialog.getByLabel("Summary")).toHaveValue("Checkout with saved card: Click Pay: Spinner never stops");
  await snap(page, "bug-dialog");
  await dialog.getByLabel("Severity").selectOption({ label: "A - Showstopper" });
  await dialog.getByRole("button", { name: "File bug in Jira" }).click();
  await expect(page.getByText("QA-101")).toBeVisible();

  await page.getByRole("group", { name: "Step 3 status" }).getByRole("button", { name: "Blocked" }).click();
  await page.getByRole("button", { name: "Report bug in Jira" }).nth(1).click();
  await dialog.getByRole("button", { name: "Link existing bug" }).click();
  await dialog.getByPlaceholder(/Search Jira/).fill("safari");
  await dialog.getByRole("listitem").filter({ hasText: "QA-7" }).getByRole("button", { name: "Link" }).click();
  await expect(page.getByText("QA-7")).toBeVisible();
  await expect(dialog).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 1000 });
  await snap(page, "runner", false);
  await page.getByRole("button", { name: "Save and next" }).click();

  // Case 2: pass every step
  await expect(page.getByRole("heading", { name: /Apply discount code/ })).toBeVisible();
  await page.keyboard.press("p");
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Save and finish" }).click();
  // The last case offers to close the run.
  await expect(page.getByText("That was the last case in R1.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close run" })).toBeVisible();

  // Dashboard
  await backToRun(page);
  await expect(page.getByText("2.4.0-rc1").first()).toBeVisible();
  await expect(page.getByText("QA-101")).toBeVisible();
  await snap(page, "run-dashboard");

  const created = await (await fetch(`${JIRA}/__issues`)).json();
  expect(created["QA-101"].summary).toMatch(/Checkout with saved card/);
  expect(JSON.stringify(created["QA-101"].description)).toContain("Spinner never stops");
  // Severity goes in Jira's Severity field; Priority is left for producers.
  expect(created["QA-101"].severity).toBe("A - Showstopper");
  expect(created["QA-101"].priority).toBeUndefined();

  // Defects show Jira's severity and priority for a linked bug.
  await page.goto(`/p/${KEY}/bugs`);
  const qa7 = page.getByRole("row").filter({ hasText: "QA-7" });
  await expect(qa7).toContainText("B - Critical");
  await expect(qa7).toContainText("Priority: Blocker");

  // Case history
  await page.goto(`/p/${KEY}/cases/1`);
  await expect(page.getByText("Execution history")).toBeVisible();
  await expect(page.getByRole("link", { name: /R1/ }).first()).toBeVisible();

  // Suite page shows the RC it tested
  await page.goto(`/p/${KEY}/suites`);
  await page.getByRole("link", { name: /Checkout regression/ }).click();
  await expect(page.getByText("Releases tested")).toBeVisible();
  await expect(page.getByRole("cell", { name: "2.4.0-rc1" })).toBeVisible();

  // Reports
  for (const view of ["status", "steps", "failing", "defects", "cases", "testers"]) {
    await page.goto(`/p/${KEY}/reports?view=${view}`);
    await expect(page.locator("main")).not.toContainText("Something went wrong");
    await snap(page, `report-${view}`);
  }
  await page.goto(`/p/${KEY}/reports?view=failing&range=all`);
  const clickPay = page.getByRole("row").filter({ hasText: "Click Pay" });
  await expect(clickPay).toContainText("Failing now");
  await expect(clickPay).toContainText("QA-101");
  const failingCsv = await (await page.request.get(`/p/${KEY}/reports/export?view=failing&range=all`)).text();
  expect(failingCsv).toContain("Click Pay");
  await page.goto(`/p/${KEY}/reports?view=defects`);
  await expect(page.getByText("QA-101").first()).toBeVisible();
  const csv = await page.request.get(`/p/${KEY}/reports/export?view=steps`);
  expect(csv.ok()).toBeTruthy();
  expect(await csv.text()).toContain("Checkout regression");

  // Refresh from Jira picks up a closed bug even when another linked key has gone from Jira.
  await fetch(`${JIRA}/__close/QA-101`, { method: "POST" });
  await fetch(`${JIRA}/__delete/QA-7`, { method: "POST" });
  await page.goto(`/p/${KEY}/bugs`);
  await page.getByRole("button", { name: "Refresh from Jira" }).click();
  await expect(page.getByText(/Updated 1 from Jira\. Couldn’t read QA-7 \(Not found in Jira\.\)/)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "QA-101" })).toContainText("Closed");

  // Ignore next dev's own hot-reload hiccups while it compiles pages on demand.
  expect(consoleErrors.filter((e) => !e.includes("__webpack_require__"))).toEqual([]);
});

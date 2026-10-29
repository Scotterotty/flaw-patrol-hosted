import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// A run tracked in Google Sheets while the test tool was down: one row per step,
// the case result under a pass-rate header, testers by first name.
test("a run kept in a sheet imports as an open run with results, testers and work left to do", async ({ page }) => {
  test.setTimeout(180_000);
  const id = Date.now().toString(36).slice(-4).toUpperCase();
  const key = `I${id}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Sheet run ${id}`, key);
  await expect(page).toHaveURL(new RegExp(`/p/${key}/cases`));

  const head = "Key,Name,Description,Precondition,Step Order,Step Description,Expected Result,{pct},Executed By,Status,Defects,Priority,Folder";
  const cases = [
    head.replace("{pct}", "0.00%"),
    "PQ-1,[UNREAL] - Assets,,,1.1,Upload Asset,,,,Untested,,High,R22/UNREAL",
    ",,,,1.2,Delete Asset,,,,Untested,,,",
    "PQ-2,[UNREAL] - Chat,,,1.1,Send message,,,,Untested,,Medium,R22/UNREAL",
    ",,,,1.2,Edit message,,,,Untested,,,",
    ",,,,1.3,Delete message,,,,Untested,,,",
    "PQ-3,[UNREAL] - Voice,,,1.1,Join voice,,,,Untested,,Low,R22/UNREAL",
  ].join("\n");
  await page.goto(`/p/${key}/import`);
  await page.locator('input[type="file"]').setInputFiles({ name: "cases.csv", mimeType: "text/csv", buffer: Buffer.from(cases) });
  await page.getByRole("button", { name: "Import 3 cases" }).click();
  await expect(page.getByText("Imported 3 test cases")).toBeVisible();

  const sheet = [
    head.replace("{pct}", "58.70%"),
    "PQ-1,[UNREAL] - Assets,,,1.1,Upload Asset,,Failed,Demo,Passed,PROJ-77,High,R22/UNREAL",
    ",,,,1.2,Delete Asset,,,,Failed,,,",
    "PQ-2,[UNREAL] - Chat,,,1.1,Send message,,Untested,Jess,Passed,,Medium,R22/UNREAL",
    ",,,,1.2,Edit message,,,,Blocked,,,",
    ",,,,1.3,Delete message,,,,Untested,,,",
    "PQ-3,[UNREAL] - Voice,,,1.1,Join voice,,Untested,—,Untested,,Low,R22/UNREAL",
    "PQ-9,[UNREAL] - Gone,,,1.1,Old case,,Passed,Demo,Passed,,Low,R22/UNREAL",
  ].join("\n");

  await page.goto(`/p/${key}/runs`);
  await page.getByRole("link", { name: "Import a run" }).click();
  await page.getByLabel("Sheet file").setInputFiles({ name: "R22 Test Cycle - Unreal.csv", mimeType: "text/csv", buffer: Buffer.from(sheet) });

  // Columns are matched, including the pass-rate header holding case results.
  await expect(page.getByLabel("Case result", { exact: true })).toHaveValue("7");
  await expect(page.getByLabel("Tester", { exact: true })).toHaveValue("8");
  const found = page.getByRole("region", { name: "What Flaw Patrol found" });
  await expect(found).toContainText("Cases matched3");
  await expect(found).toContainText("Not found1");
  await expect(page.getByRole("region", { name: "Needs a look" })).toContainText("PQ-9");

  // Testers: "Demo" finds Demo Admin; "Jess" needs linking by hand.
  const testers = page.getByRole("region", { name: "Testers" });
  await expect(testers.getByLabel("Flaw Patrol user for Demo")).toHaveValue(/.+/);
  await expect(testers.getByLabel("Flaw Patrol user for Jess")).toHaveValue("");
  await testers.getByLabel("Flaw Patrol user for Jess").selectOption({ label: "Demo Admin" });
  await expect(testers.getByLabel("Flaw Patrol user for Jess")).not.toHaveValue("");

  await expect(page.getByLabel("Run name")).toHaveValue("R22 Test Cycle - Unreal");
  await page.getByLabel("Release", { exact: true }).fill("RC22");
  await page.getByLabel("Tested on").fill("2026-10-20");
  await page.getByRole("button", { name: "Create run with 3 cases" }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
  const runUrl = page.url();

  // The run is open: one result, one in progress, one still to do.
  await expect(page.getByRole("heading", { name: "R22 Test Cycle - Unreal" })).toBeVisible();
  await expect(page.getByText("RC22").first()).toBeVisible();
  await expect(page.getByText("Closed", { exact: true })).toHaveCount(0);
  const rowFor = (t: string) => page.getByRole("row").filter({ hasText: t });
  await expect(rowFor("[UNREAL] - Assets")).toContainText("Failed");
  await expect(rowFor("[UNREAL] - Chat")).toContainText("In progress");
  await expect(rowFor("[UNREAL] - Voice")).toContainText("Untested");

  // The part-done case picks up with the sheet's step results.
  await page.goto(`${runUrl}/execute`);
  await page.getByRole("link", { name: /Chat/ }).first().click();
  await expect(page.getByRole("heading", { name: "[UNREAL] - Chat", level: 1 })).toBeVisible();
  const steps = page.getByRole("group", { name: /^Step .* status$/ });
  await expect(steps.nth(0).getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "true");
  await expect(steps.nth(1).getByRole("button", { name: "Blocked" })).toHaveAttribute("aria-pressed", "true");
  await expect(steps.nth(2).getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "false");

  // The bug from the sheet is linked, and the tester link is remembered next time.
  await page.goto(`/p/${key}/bugs`);
  await expect(page.getByText("PROJ-77").first()).toBeVisible();
  await page.goto(`/p/${key}/runs/import`);
  await page.getByLabel("Sheet file").setInputFiles({ name: "again.csv", mimeType: "text/csv", buffer: Buffer.from(sheet) });
  await expect(page.getByRole("region", { name: "Testers" }).getByLabel("Flaw Patrol user for Jess")).not.toHaveValue("");
});

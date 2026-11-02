import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_135: qTest steps with their expected results inside the step cell, and Excel files with
// empty merged cells (which used to say "Something went wrong").
test("moves the lines under a step's name to Expected, and keeps a line where asked", async ({ page }) => {
  const run = Date.now().toString(36).slice(-4).toUpperCase();
  const key = `X${run}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Packed ${run}`, key);
  await expect(page).toHaveURL(new RegExp(`/p/${key}/cases`));

  const csv = [
    "Key,Name,Description,Precondition,Step Order,Step Description,Expected Result,0.00%,Executed By,Status,Actual Result,Defects,Priority,Folder",
    `PQ-1,[WEB] - Assets Panel,,,1.1,Toggle Multi-SelectA user is able to toggle multi-select on.A user is able to toggle multi-select off.,Not Supported by: UNREAL / UNITY,,,Untested,,,High,2026 Cases/WEB`,
    `,,,,1.2,Open the asset panel.Asset Panels.Panels don't freeze.,,,,Untested,,,,`,
    `,,,,1.3,Upload Asset,An asset appears.,,,Untested,,,,`,
  ].join("\n");

  await page.goto(`/p/${key}/import`);
  await page.locator('input[type="file"]').setInputFiles({ name: "R22 Test Cycle - Web.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  const card = page.getByTestId("packed-steps");
  await expect(card).toContainText("2 steps in 1 case have more lines under the step name");
  await expect(page.getByLabel(/Move the lines under the step name to Expected/)).toBeChecked();

  await page.getByRole("button", { name: /PQ-1/ }).click();
  await expect(page.getByTestId("moved-lines").first()).toContainText("A user is able to toggle multi-select on.");
  // The panel step really is two sentences: keep one more line, then check Undo shows up.
  await page.getByRole("button", { name: "Keep one more line in the step" }).nth(1).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(page.getByTestId("moved-lines").nth(1)).toHaveText("Panels don't freeze.");

  await page.getByLabel(/Yes, we've run them before/).check();
  await page.getByRole("button", { name: /^Import 1 case\b/ }).click();
  await expect(page.getByText(/Imported 1 test case/)).toBeVisible();

  await page.goto(`/p/${key}/cases/1`);
  await expect(page.getByRole("cell", { name: "Toggle Multi-Select", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Not Supported by: UNREAL \/ UNITY\s+A user is able to toggle multi-select on\./ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Open the asset panel\.\s+Asset Panels\./ })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Panels don't freeze.", exact: true })).toBeVisible();
});

test("imports an Excel file with empty merged cells", async ({ page }) => {
  const run = Date.now().toString(36).slice(-4).toUpperCase();
  const key = `M${run}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Merged ${run}`, key);
  await expect(page).toHaveURL(new RegExp(`/p/${key}/cases`));

  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Cases");
  sheet.addRows([
    ["Title", "Steps", "Expected", "Notes"],
    ["Upload an asset", "Click Upload", "", ""],
    ["Delete an asset", "Click Delete", "The asset is gone", ""],
  ]);
  sheet.mergeCells("C2:D2");
  const buffer = Buffer.from(await book.xlsx.writeBuffer());

  await page.goto(`/p/${key}/import`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "merged.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(page.getByText("Preview: 2 cases, 2 steps")).toBeVisible();
});

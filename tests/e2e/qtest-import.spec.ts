import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";
import ExcelJS from "exceljs";

// qTest exports test cases as .xlsx with one row per step, repeating the case ID.
test("imports a qTest Excel export", async ({ page }) => {
  const run = Date.now().toString(36).slice(-4).toUpperCase();
  const key = `Q${run}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `qTest ${run}`, key);
  await expect(page).toHaveURL(new RegExp(`/p/${key}/cases`));

  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Test Cases");
  sheet.addRows([
    ["Id", "Name", "Description", "Precondition", "Module", "Priority", "Type", "Test Step #", "Test Step Description", "Test Step Expected Result"],
    ["TC-11", "Reset password", "", "User exists", "Accounts / Password", "High", "Manual", 1, "Open Forgot password", "Form shows"],
    ["TC-11", "Reset password", "", "User exists", "Accounts / Password", "High", "Manual", 2, "Submit email", "Reset email arrives"],
    ["TC-12", "Change email", "", "", "Accounts", "Medium", "Manual", 1, "Edit email and save", "Confirmation sent"],
  ]);
  const buffer = Buffer.from(await book.xlsx.writeBuffer());

  await page.goto(`/p/${key}/import`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "qtest-export.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await expect(page.getByLabel("Where is this file from?")).toHaveValue("qtest");
  await expect(page.getByText("Preview: 2 cases, 3 steps")).toBeVisible();
  await page.getByLabel("Make folders from the file's Folder column").check();
  await page.getByRole("button", { name: "Import 2 cases" }).click();
  await expect(page.getByText("Imported 2 test cases")).toBeVisible();

  await page.goto(`/p/${key}/cases/1`);
  await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Reset email arrives" })).toBeVisible();
  await expect(page.getByText("Accounts / Password")).toBeVisible();
});

// qTest's test run export: key on the first row only, steps numbered by called test case.
test("imports a qTest test run CSV with shared blocks", async ({ page }) => {
  const run = Date.now().toString(36).slice(-4).toUpperCase();
  const key = `R${run}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `qTest run ${run}`, key);
  await expect(page).toHaveURL(new RegExp(`/p/${key}/cases`));

  const csv = [
    "Key,Name,Description,Precondition,Step Order,Step Description,Expected Result,0.00%,Executed By,Status,Actual Result,Defects,Priority,Folder",
    "PQ-1,[WEB] - Login,,,1.1,LOGIN UNIQUE STEPS,,,,Untested,,,Blocker,2026 Cases/WEB",
    ",,,,1.2,Sign inA user can sign in.,User sees home,,,Untested,,,,",
    ",,,,2.1,SEARCH BAR SHARED STEPS,,,,Untested,,,,",
    ",,,,2.2,Search Bar InteractionA user can type.,Results show,,,Untested,,,,",
    "PQ-2,[WEB] - Assets,,,1.1,Upload Asset,Asset appears,,,Untested,,,High,2026 Cases/WEB",
    ",,,,2.1,SEARCH BAR SHARED STEPS,,,,Untested,,,,",
    ",,,,2.2,Search Bar InteractionA user can type.,Results show,,,Untested,,,,",
  ].join("\n");

  await page.goto(`/p/${key}/import`);
  await page.locator('input[type="file"]').setInputFiles({ name: "R22 Test Cycle.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByLabel("Where is this file from?")).toHaveValue("qtest");
  await expect(page.getByLabel("Put back line breaks qTest's CSV export removed")).toBeChecked();
  await expect(page.getByText("Preview: 2 cases, 7 steps, 1 shared step")).toBeVisible();
  await page.getByRole("button", { name: /PQ-1/ }).click();
  await expect(page.getByText("3.2")).toBeVisible();
  await page.getByRole("button", { name: "Import 2 cases" }).click();
  await expect(page.getByText("Imported 2 test cases")).toBeVisible();

  await page.goto(`/p/${key}/cases/1`);
  await expect(page.getByRole("heading", { name: "[WEB] - Login" })).toBeVisible();
  await expect(page.getByText("PQ-1", { exact: true })).toBeVisible();
  await expect(page.getByText("3.2", { exact: true })).toBeVisible();
  await expect(page.getByText("A user can sign in.")).toBeVisible();

  await page.goto(`/p/${key}/cases?q=PQ-2`);
  await expect(page.getByRole("link", { name: "[WEB] - Assets" })).toBeVisible();
});

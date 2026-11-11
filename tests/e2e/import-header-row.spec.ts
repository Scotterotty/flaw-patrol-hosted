import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_169: Scott's "Demo Dry Run Checklist" sheet. Run info sits on top, the column names are on
// row 23, rows with one filled cell are sections ("Queen Mary Space"), titles have several lines,
// and Result, Bug Ticket and Repro columns are filled in during a run.
const original = readFileSync(path.join(__dirname, "fixtures", "demo-dry-run-checklist.csv"), "utf8");
// One real result, so the done screen offers to bring the results into a run.
const withResult = original.replace(",Enter space,User is able to enter the Frida Mag Office Demo space on all clients.,Select,", ",Enter space,User is able to enter the Frida Mag Office Demo space on all clients.,Pass,");

test("a checklist sheet with its column names on row 23 imports with section folders and first-line titles", async ({ page }) => {
  test.setTimeout(180_000);
  expect(withResult).not.toBe(original);
  const run = Date.now().toString(36).slice(-4).toUpperCase();
  const key = `H${run}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Checklist ${run}`, key);

  await page.goto(`/p/${key}/import`);
  await page.locator('input[type="file"]').setInputFiles({ name: "Demo Dry Run Checklist.csv", mimeType: "text/csv", buffer: Buffer.from(withResult) });

  // 1. The column names are found on row 23, announced, and another row can be picked.
  const found = page.getByTestId("header-row-found");
  await expect(found).toHaveAttribute("role", "status");
  await expect(found).toContainText("We found your column names on row 23");
  await expect(found).toContainText("Run Status");
  await expect(page.getByLabel("Title *")).toHaveValue(/\d+/);
  await expect(page.getByLabel("Title *").locator("option:checked")).toHaveText("Test Case");
  // 2. Category is a Folder column now.
  await expect(page.getByLabel("Folder", { exact: true }).locator("option:checked")).toHaveText("Category");
  // 5. Expected names where the lines under the title go.
  await expect(page.getByLabel("Expected results").locator("option:checked")).toHaveText("Test Case (lines under the first)");

  // 3. Multi-line titles: first line is the title, picked for you.
  const titles = page.getByTestId("long-titles");
  await expect(titles.getByLabel(/Use the first line as the title/)).toBeChecked();
  await expect(titles).toContainText("You don't have to answer this to import.");

  // 2. Section rows become top folders.
  const sections = page.getByTestId("section-rows");
  await expect(sections).toContainText("3 rows look like section names");
  for (const name of ["Frida Demo Space", "Queen Mary Space", "Pilot Space"]) await expect(sections).toContainText(name);

  // 4. Per-run columns are left out.
  await expect(page.getByTestId("per-run-columns")).toContainText("Result, Bug Ticket");
  // ver_217: the one result can come in as a finished run; unticked here, so it waits for Bring them into a run.
  await expect(page.getByTestId("sheet-results").getByRole("heading")).toHaveText("Your sheet has results for 1 of 53 cases");
  await page.getByTestId("sheet-results-keep").uncheck();

  await expect(page.getByText("Preview: 53 cases")).toBeVisible();
  await expect(page.getByTestId("import-warnings")).toHaveCount(0);

  // Another row as the column names, then back.
  await page.getByLabel("Use a different row").selectOption({ label: "Row 3: Run Status: · Not Started" });
  await expect(found).toContainText("Column names from row 3");
  await expect(page.getByText("Preview: 53 cases")).toHaveCount(0);
  await page.getByLabel("Use a different row").selectOption({ label: "Row 23: Category · Test Case · Result …" });
  await expect(found).toContainText("We found your column names on row 23");
  await expect(page.getByText("Preview: 53 cases")).toBeVisible();

  // The file's folders are used, so the Import button needs only the run-before answer.
  await expect(page.getByLabel("Use the file's folders")).toBeChecked();
  const tree = page.getByRole("list", { name: "Folders this import makes" });
  await expect(tree).toContainText("Queen Mary Space");
  await page.getByLabel(/No, they're brand new/).check();
  await page.getByRole("button", { name: "Import 53 cases" }).click();
  await expect(page.getByText("Imported 53 test cases")).toBeVisible();

  // The results go to "Results from a spreadsheet" with the same sheet, no picking it again.
  await page.getByTestId("sheet-results-link").getByRole("link", { name: "Bring them into a run" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${key}/runs/import`));
  await expect(page.getByText("Demo Dry Run Checklist.csv")).toBeVisible();
  await expect(page.getByText("Cases with a result").locator("..")).toContainText("1");

  // The cases: first line as the title, the rest as Expected, in section folders.
  await page.goto(`/p/${key}/cases`);
  const folders = page.locator("aside");
  for (const name of ["Frida Demo Space", "Queen Mary Space", "Pilot Space"]) await expect(folders.getByRole("link", { name, exact: true })).toBeVisible();
  const db = new PrismaClient();
  const splat = await db.testCase.findFirstOrThrow({ where: { project: { key }, title: "Gaussian Splat" }, select: { number: true } });
  await db.$disconnect();
  await page.goto(`/p/${key}/cases/${splat.number}`);
  await expect(page.getByRole("heading", { name: "Gaussian Splat" })).toBeVisible();
  await expect(page.getByText(/Validate a Gaussian Splat asset/).first()).toBeVisible();
});

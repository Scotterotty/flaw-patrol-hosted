import { createServer } from "node:http";
import ExcelJS from "exceljs";
import { expect, test } from "@playwright/test";
import { SHEETS_ENABLED } from "../../src/lib/features";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `G${Date.now().toString(36).slice(-4).toUpperCase()}`;
type Push = { secret: string; tab: string; rows: string[][]; merges: number[][]; caseEnds: number[]; look: { fontColors: string[][]; backgrounds: string[][] }; chips: { status: string; fill: string; text: string }[]; testerChip: { fill: string; text: string }; formula: string };

test.skip(!SHEETS_ENABLED, "Spreadsheet export is switched off.");

test("a run's results export to a spreadsheet and send to a linked Google Sheet", async ({ page }) => {
  // A stand-in for the script pasted into the Google Sheet.
  const pushes: Push[] = [];
  const hook = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      pushes.push(JSON.parse(body));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, url: "https://docs.google.com/spreadsheets/d/x/edit#gid=1" }));
    });
  });
  await new Promise<void>((r) => hook.listen(3198, r));
  try {
    await signIn(page, "admin@example.com", "Demo Admin");
    await page.goto("/");
    await standaloneProject(page, `Sheet ${KEY}`, KEY);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases`));
    for (const title of ["Alpha", "Bravo"]) {
      await page.goto(`/p/${KEY}/cases/new`);
      await page.getByLabel("Title").fill(title);
      await page.getByLabel("Step 1 action").fill(`${title} one`);
      await page.getByRole("button", { name: "Add step" }).click();
      await page.getByLabel("Step 2 action").fill(`=${title} two`);
      await page.getByLabel("Step 2 expected").fill("It works");
      await page.getByRole("button", { name: "Create case" }).first().click();
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }
    await page.goto(`/p/${KEY}/suites/new`);
    await page.getByLabel("Name", { exact: true }).fill("Two");
    await page.getByRole("button", { name: /^Tick all/ }).click();
    await page.getByRole("button", { name: "Create suite" }).click();
    await page.getByRole("button", { name: "Create a run" }).click();
    await page.getByLabel("Assign every case to").selectOption({ label: "Me (Demo Admin)" });
    await page.getByRole("button", { name: "Create run", exact: true }).click();
    await expect(page).toHaveURL(/\/runs\/\d+$/);
    const runUrl = page.url();

    // Pass Alpha's steps.
    await page.goto(runUrl + "/execute");
    await expect(page.getByRole("heading", { name: "Alpha", level: 1 })).toBeVisible();
    for (const n of [1, 2]) await page.getByRole("group", { name: `Step ${n} status` }).getByRole("button", { name: "Passed" }).click();
    await page.getByRole("button", { name: "Save and next" }).click();
    await expect(page.getByRole("heading", { name: "Bravo", level: 1 })).toBeVisible();

    // Export: one row per step, in the cycle sheet's columns.
    await page.goto(runUrl);
    await page.getByRole("button", { name: "More" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export to spreadsheet" }).click();
    const file = await (await download).path();
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(file!);
    const sheet = book.worksheets[0];
    const row = (n: number) => (sheet.getRow(n).values as unknown[]).slice(1).map((v) => (v == null ? "" : String(v)));
    expect(row(1).filter((_, i) => i !== 7)).toEqual(["Key", "Name", "Description", "Precondition", "Step Order", "Step Description", "Expected Result", "Executed By", "Status", "Defects", "Priority", "Folder"]);
    // The header over case statuses is the cycle sheet's live "done" percentage: 1 of 2 cases.
    const pct = sheet.getCell("H1").value as { formula: string; result: number };
    expect(pct.formula).toContain("COUNTIF(H2:H");
    expect(pct.result).toBe(0.5);
    expect(sheet.getCell("H1").numFmt).toBe("0.00%");
    // Looks like the R22 sheet: Montserrat header on dark blue, frozen through column F, dropdowns on case status.
    expect(sheet.getCell("A1").font.name).toBe("Montserrat");
    expect(sheet.views[0]).toMatchObject({ state: "frozen", xSplit: 6, ySplit: 1 });
    expect(sheet.getColumn(11).hidden).toBe(false);
    expect(sheet.getCell("H2").dataValidation.formulae[0]).toContain("Not Run");
    expect(sheet.autoFilter).toBeTruthy();
    expect(row(2).slice(0, 2)).toEqual([`${KEY}-1`, "Alpha"]);
    expect(row(2)[7]).toBe("Passed");
    expect(row(2)[8]).toBe("Demo Admin");
    expect(row(3)[5]).toBe("=Alpha two");
    expect(row(3)[9]).toBe("Passed");
    expect(row(4)[7]).toBe("Untested");

    // Link a Google Sheet tab.
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: "Google Sheet" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Script")).toHaveValue(/const KEY = "[\w-]+";/);
    const script = await dialog.getByLabel("Script").inputValue();
    const secret = script.match(/const KEY = "([\w-]+)"/)![1];
    await dialog.getByLabel("Web app URL").fill("https://example.com/not-a-script");
    await dialog.getByLabel("Tab").fill("Web");
    await dialog.getByRole("button", { name: "Link and send" }).click();
    await expect(dialog.getByText(/isn.t a Web app URL/)).toBeVisible();
    await expect(dialog.getByLabel("Tab")).toHaveValue("Web");
    await dialog.getByLabel("Web app URL").fill("http://localhost:3198/exec");
    await dialog.getByRole("button", { name: "Link and send" }).click();
    await expect(dialog).toHaveCount(0);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].secret).toBe(secret);
    expect(pushes[0].tab).toBe("Web");
    expect(pushes[0].rows[2][5]).toBe("'=Alpha two"); // never a formula in the sheet
    expect(pushes[0].merges).toContainEqual([2, 8, 2]);
    expect(pushes[0].caseEnds).toEqual([3, 5]);
    expect(pushes[0].chips).toContainEqual({ status: "Passed", fill: "#D4EDBC", text: "#11734B" }); // Passed in green, like the cycle sheet
    expect(pushes[0].testerChip.fill).toBe("#BFE1F6"); // testers in light blue
    expect(pushes[0].look.backgrounds).toHaveLength(4);
    const status = page.getByLabel("Google Sheet", { exact: true });
    await expect(status).toContainText("Linked to the Web tab");

    // Sending is by hand unless turned on.
    await page.goto(runUrl + "/execute");
    await expect(page.getByRole("heading", { name: "Bravo", level: 1 })).toBeVisible();
    await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Failed" }).click();
    await expect(page.getByText("Step results saved")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(pushes).toHaveLength(1);
    await page.goto(runUrl);
    await status.getByRole("button", { name: "Send to sheet" }).click();
    await expect.poll(() => pushes.length).toBe(2);
    expect(pushes[1].rows[3][7]).toBe("In Progress");
    expect(pushes[1].rows[3][9]).toBe("Failed");

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: "Google Sheet" }).click();
    await dialog.getByLabel("Send automatically each time a result is saved").check();
    await expect(dialog.getByLabel("Send automatically each time a result is saved")).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(status).toContainText("Results go to the Web tab");
    await page.goto(runUrl + "/execute");
    await expect(page.getByRole("heading", { name: "Bravo", level: 1 })).toBeVisible();
    await page.getByRole("group", { name: "Step 2 status" }).getByRole("button", { name: "Passed" }).click();
    await expect.poll(() => pushes.at(-1)?.rows[4][9]).toBe("Passed");
  } finally {
    hook.close();
  }
});

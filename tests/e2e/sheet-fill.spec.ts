import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { SHEETS_ENABLED } from "../../src/lib/features";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// Fill in my columns: a run fills the Result column of a checklist the team already keeps.
// The stand-in plays the sheet's script: it answers "read" with the tab and records each "fill".

const KEY = `F${Date.now().toString(36).slice(-4).toUpperCase()}`;
type Cell = { r: number; c: number; v: string };

test.skip(!SHEETS_ENABLED, "Spreadsheet export is switched off.");

test("Fill in my columns fills only the picked columns of an existing tab", async ({ page }) => {
  const tab = [
    ["", "Demo Dry Run", "", "", "", "", "", ""],
    ["", "Test", "Result", "Bug Ticket", "Summary", "Result", "Bug Ticket", "Summary"],
    ["", "Frida Demo Space", "", "", "", "", "", ""],
    ["", "Alpha\nWorks on every client", "Pass", "", "", "", "", ""],
    ["", "Bravo (web)", "Pass", "", "", "", "", "typed by hand"],
    ["", "Old row nobody runs", "Pass", "", "", "", "", ""],
  ];
  const fills: Cell[][] = [];
  const hook = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const b = JSON.parse(body);
      res.setHeader("Content-Type", "application/json");
      if (b.tab === "Old") return res.end(JSON.stringify({ ok: true, url: "x" })); // an older script: no version
      if (b.action === "read") return res.end(JSON.stringify({ ok: true, version: 2, values: tab, lists: tab[0].map(() => null) }));
      fills.push(b.cells);
      res.end(JSON.stringify({ ok: true, version: 2, filled: b.cells.filter((c: Cell) => c.v).length, kept: 0, url: "https://docs.google.com/spreadsheets/d/x/edit#gid=2" }));
    });
  });
  await new Promise<void>((r) => hook.listen(3197, r));
  try {
    await signIn(page, "admin@example.com", "Demo Admin");
    await page.goto("/");
    await standaloneProject(page, `Fill ${KEY}`, KEY);
    for (const title of ["Alpha", "Bravo", "Charlie"]) {
      await page.goto(`/p/${KEY}/cases/new`);
      await page.getByLabel("Title").fill(title);
      await page.getByLabel("Step 1 action").fill(`${title} one`);
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
    const runUrl = page.url();

    // Alpha passes, Bravo fails, Charlie isn't run.
    await page.goto(runUrl + "/execute");
    await expect(page.getByRole("heading", { name: "Alpha", level: 1 })).toBeVisible();
    await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" }).click();
    await page.getByRole("button", { name: "Save and next" }).click();
    await expect(page.getByRole("heading", { name: "Bravo", level: 1 })).toBeVisible();
    await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Failed" }).click();
    await page.getByRole("button", { name: "Save and next" }).click();
    await expect(page.getByRole("heading", { name: "Charlie", level: 1 })).toBeVisible();

    await page.goto(runUrl);
    await page.getByRole("button", { name: "Import / Export" }).click();
    await page.getByRole("button", { name: "Export to a Google Sheet" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Script")).toHaveValue(/function fillTab/);
    await expect(dialog.getByRole("radio", { name: /Fill in my columns/ })).toBeChecked();
    await dialog.getByLabel("Web app URL").fill("http://localhost:3197/exec");

    // A sheet still on the old script says so.
    await dialog.getByLabel("Tab", { exact: true }).fill("Old");
    await dialog.getByRole("button", { name: "Look at the sheet" }).click();
    await expect(dialog.getByText(/older Flaw Patrol script/)).toBeVisible();

    await dialog.getByLabel("Tab", { exact: true }).fill("Checklist");
    await dialog.getByRole("button", { name: "Look at the sheet" }).click();
    const found = dialog.getByLabel("What Flaw Patrol found");
    await expect(found).toContainText("Found your header on row 2. Matched 2 of 3 cases.");
    await expect(dialog.getByLabel("Header row")).toHaveValue("2");
    await dialog.getByLabel("Fill", { exact: true }).selectOption({ label: "Columns F to H" });
    await expect(found.getByLabel("Fill Result (column F)")).toBeChecked();
    await found.getByLabel("Fill Summary (column H)").uncheck();
    await expect(found).toContainText("1 case isn't in the sheet yet.");
    await found.getByLabel("Row for Charlie").selectOption({ label: "Row 6: Old row nobody runs" });
    await expect(found).toContainText("Matched 3 of 3 cases.");
    await dialog.getByRole("button", { name: "Link and send" }).click();
    await expect(dialog).toHaveCount(0);

    expect(fills).toHaveLength(1);
    const cells = fills[0];
    // Only columns F and G, never C to E or the typed Summary in H.
    expect(cells.every((c) => c.c === 6 || c.c === 7)).toBe(true);
    // The sheet's own word for a pass, from what's already in its Result columns.
    expect(cells).toContainEqual({ r: 4, c: 6, v: "Pass" });
    expect(cells).toContainEqual({ r: 5, c: 6, v: "Failed" });
    expect(cells).toContainEqual({ r: 6, c: 6, v: "" });
    const status = page.getByLabel("Google Sheet", { exact: true });
    await expect(status).toContainText("Linked to the Checklist tab");
    await expect(status).toContainText("2 cells filled");

    // The dialog says what it fills, and Send uses the saved choices (Charlie stays on row 6).
    await page.getByRole("button", { name: "Import / Export" }).click();
    await page.getByRole("button", { name: "Export to a Google Sheet" }).click();
    await expect(dialog).toContainText("Fills Result and Bug Ticket (columns F to H) in the Checklist tab");
    await dialog.getByRole("button", { name: "Send to sheet" }).click();
    await expect.poll(() => fills.length).toBe(2);
    expect(fills[1]).toContainEqual({ r: 6, c: 7, v: "" });
  } finally {
    hook.close();
  }
});

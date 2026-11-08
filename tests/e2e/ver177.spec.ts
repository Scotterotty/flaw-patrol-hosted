import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { pickKind } from "./projects";

// ver_177: Create a run → What to run → From a spreadsheet. Pick the sheet in the box, choose
// Update a run in progress or A new run, then Next: check the sheet opens the import page with
// it loaded. Results that differ use the sheet's by default. Runs also get More → Update from a sheet.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `SX${TAG}`;
const CYCLE = `SY${TAG}`;
const NAME = `Sheet runs ${TAG}`;
const ids = { group: "", run: "", disagree: "" };

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: NAME, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const group = await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }] } });
    ids.group = group.id;
    const cycle = await db.project.create({ data: { key: CYCLE, name: `${NAME} Web RC 1`, groupId: group.id, platform: "Web", rcName: "RC 1", runSeq: 1, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    // The cases live in the umbrella's Case library (the hub), like real umbrellas.
    const titles = ["Untested here", "Passed both", "Failed here", "Not in the run", "Blank in sheet"];
    const cases = [];
    // The first keeps its old qTest key, like cases imported from qTest.
    for (const [i, title] of titles.entries()) cases.push(await db.testCase.create({ data: { projectId: hub.id, number: i + 1, title, sourceKey: i === 0 ? `PX-17${TAG}` : null } }));
    const status = ["UNTESTED", "PASSED", "FAILED", null, "UNTESTED"] as const;
    const run = await db.testRun.create({
      data: {
        projectId: cycle.id,
        number: 1,
        name: "R1 Web check",
        build: "2.4.1",
        createdById: admin.id,
        createdBy: "Demo Admin",
        entries: {
          create: cases
            .map((c, i) => ({ c, i }))
            .filter(({ i }) => status[i] !== null)
            .map(({ c, i }) => ({ caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: "MEDIUM" as const, steps: [], status: status[i]!, lastTestedAt: status[i] === "UNTESTED" ? null : new Date() })),
        },
      },
      include: { entries: true },
    });
    for (const e of run.entries.filter((e) => e.status !== "UNTESTED")) {
      await db.testResult.create({ data: { entryId: e.id, runId: run.id, caseId: e.caseId, caseVersion: 1, status: e.status, stepResults: [], testerId: admin.id, testerName: "Demo Admin" } });
    }
    ids.run = run.id;
    ids.disagree = cases[2].id;
  } finally {
    await db.$disconnect();
  }
});

const sheet = [
  "Key,Name,Case result",
  `PX-17${TAG},Untested here,Passed`,
  `${HUB}-2,Passed both,Passed`,
  `${HUB}-3,Failed here,Passed`,
  `${HUB}-4,Not in the run,Failed`,
  `${HUB}-5,Blank in sheet,Select`,
].join("\n");
const file = (name: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(sheet) });

test.describe.configure({ mode: "serial" });

test("Create a run → From a spreadsheet updates a run in progress", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  // Ctrl+K's "Update a run from a sheet" link opens the box on From a spreadsheet.
  await page.goto(`/g/${ids.group}?start=run&what=sheet`);
  const box = page.getByRole("dialog", { name: "Create a run" });
  await pickKind(page);
  await expect(box.getByRole("button", { name: /From a spreadsheet/ })).toHaveAttribute("aria-pressed", "true");
  await expect(box.getByTestId("run-todo")).toContainText("Pick your sheet");
  await box.getByLabel("Spreadsheet file").setInputFiles(file("Web check.csv"));
  await expect(box.getByTestId("sheet-picked")).toContainText("Web check.csv · 5 rows");

  const where = box.getByRole("radiogroup", { name: "Where the sheet goes" });
  await expect(where.getByRole("radio", { name: "Update a run in progress" })).toBeChecked();
  await expect(where.getByLabel("Run in progress to update")).toContainText("R1 Web check v2.4.1 · 2 of 4 tested");
  await expect(box.getByTestId("run-todo")).toContainText("Updates R1 Web check v2.4.1");
  // Updating needs no name or release.
  await expect(box.getByLabel("Run name (optional)")).toHaveCount(0);
  await box.getByRole("button", { name: "Next: check the sheet" }).click();

  await expect(page).toHaveURL(new RegExp(`/p/${CYCLE}/runs/import\\?sheet=handoff&run=1$`));
  await expect(page.getByText("Columns in Web check.csv")).toBeVisible();
  const into = page.getByRole("region", { name: "Updating the run" });
  await expect(into).toContainText("Updating R1 Web check v2.4.1");
  await expect(into.getByRole("checkbox", { name: /Use the sheet's results for the 1 that differs/ })).toBeChecked();
  await into.getByRole("button", { name: "Update 2 results" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${CYCLE}/runs/1\\?updated=2$`));
  await expect(page.getByTestId("sheet-updated")).toContainText("Updated 2 results from the sheet.");

  const db = new PrismaClient();
  try {
    const entries = await db.runEntry.findMany({ where: { runId: ids.run }, select: { title: true, status: true } });
    const of = (t: string) => entries.find((e) => e.title === t)?.status;
    expect(of("Untested here")).toBe("PASSED");
    expect(of("Failed here")).toBe("PASSED");
    expect(of("Blank in sheet")).toBe("UNTESTED");
    const history = await db.testResult.findMany({ where: { caseId: ids.disagree }, orderBy: { createdAt: "asc" }, select: { status: true } });
    expect(history.map((h) => h.status)).toEqual(["FAILED", "PASSED"]);
  } finally {
    await db.$disconnect();
  }
});

test("A new run from the sheet keeps the name and kind picked in the box", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${ids.group}?start=run`);
  const box = page.getByRole("dialog", { name: "Create a run" });
  await pickKind(page);
  await box.getByRole("button", { name: /From a spreadsheet/ }).click();
  await box.getByLabel("Spreadsheet file").setInputFiles(file("Fresh.csv"));
  await box.getByRole("radio", { name: "A new run" }).check();
  await expect(box.getByLabel("Run name (optional)")).toHaveAttribute("placeholder", "Fresh");
  await box.getByLabel("Run name (optional)").fill(`Sheet smoke ${TAG}`);
  await box.getByLabel("Release").fill("RC 1");
  await box.getByRole("button", { name: "Next: check the sheet" }).click();

  await expect(page).toHaveURL(new RegExp(`/p/${CYCLE}/runs/import\\?sheet=handoff$`));
  await expect(page.getByRole("radio", { name: /A new run/ })).toBeChecked();
  await expect(page.getByLabel("Run name")).toHaveValue(`Sheet smoke ${TAG}`);
  await expect(page.locator("#imp-rc")).toHaveValue("RC 1");
  await page.getByRole("button", { name: "Create run with 5 cases" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${CYCLE}/runs/2$`));

  const db = new PrismaClient();
  try {
    const run = await db.testRun.findFirstOrThrow({ where: { name: `Sheet smoke ${TAG}` }, select: { kind: true, release: true } });
    expect(run).toEqual({ kind: "smoke", release: "RC 1" });
  } finally {
    await db.$disconnect();
  }
});

test("A run's Import / Export menu has Import results from a sheet", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${CYCLE}/runs/1`);
  await page.getByRole("button", { name: "Import / Export" }).click();
  await page.getByRole("menu").getByRole("link", { name: "Import results from a sheet" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${CYCLE}/runs/import\\?run=1$`));
  await page.getByLabel("Sheet file").setInputFiles(file("Again.csv"));
  await expect(page.getByLabel("Run in progress", { exact: true })).toHaveValue(ids.run);
  // Everything already matches now: nothing to update.
  await expect(page.getByRole("button", { name: "Nothing to update" })).toBeDisabled();
});

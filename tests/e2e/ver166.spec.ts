import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_166: an umbrella's Test runs page has Bring in results → Results from a spreadsheet,
// with the test cycle picked first. The sheet can go into a run in progress: it only fills
// untested cases, lists disagreements with an unticked box, and never clears anything.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `SH${TAG}`;
const CYCLE = `SW${TAG}`;
const NAME = `Sheets ${TAG}`;
const ids = { group: "", run: "", disagree: "" };

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: NAME, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const group = await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }] } });
    ids.group = group.id;
    const cycle = await db.project.create({ data: { key: CYCLE, name: `${NAME} Web RC 1`, groupId: group.id, platform: "Web", rcName: "RC 1", members: { create: { userId: admin.id, role: "ADMIN" } } } });
    // The cases live in the umbrella's Case library (the hub), like real umbrellas.
    const titles = ["Untested here", "Passed both", "Failed here", "Not in the run", "Blank in sheet"];
    const cases = [];
    // The first keeps its old qTest key, like cases imported from qTest.
    for (const [i, title] of titles.entries()) cases.push(await db.testCase.create({ data: { projectId: hub.id, number: i + 1, title, sourceKey: i === 0 ? `PQ-17${TAG}` : null } }));
    const status = ["UNTESTED", "PASSED", "FAILED", null, "UNTESTED"] as const;
    const run = await db.testRun.create({
      data: {
        projectId: cycle.id,
        number: 1,
        name: "R1 Web check",
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
  `PQ-17${TAG},Untested here,Passed`,
  `${HUB}-2,Passed both,Passed`,
  `${HUB}-3,Failed here,Passed`,
  `${HUB}-4,Not in the run,Failed`,
  `${HUB}-5,Blank in sheet,Select`,
].join("\n");

test("a sheet goes into a run in progress from the umbrella, filling only untested cases", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${ids.group}/runs`);
  await page.getByRole("button", { name: "Bring in results" }).click();
  await expect(page.getByRole("menuitem", { name: /Automated test results/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /Results from a spreadsheet/ }).click();

  const pick = page.getByRole("dialog", { name: "Results from a spreadsheet" });
  await expect(pick.getByLabel("Which test cycle is this run for?")).toHaveValue(CYCLE);
  await pick.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${CYCLE}/runs/import`));

  await page.getByLabel("Sheet file").setInputFiles({ name: "Web check.csv", mimeType: "text/csv", buffer: Buffer.from(sheet) });
  // Every case is found in the umbrella's Case library: by its old qTest key and by its key there.
  const found = page.getByRole("region", { name: "What Flaw Patrol found" });
  await expect(found).toContainText("Cases matched5");
  await expect(found).toContainText("Not found0");
  const where = page.getByRole("radiogroup", { name: "Where should the results go?" });
  await expect(where.getByRole("radio", { name: /A run in progress/ })).toBeChecked();
  await expect(where.getByLabel("Run in progress", { exact: true })).toContainText("R1 R1 Web check · 2 of 4 tested");

  const into = page.getByRole("region", { name: "Adding to the run" });
  await expect(into.getByTestId("into-summary")).toContainText("1 case gets a result · 2 already done here, skipped · 1 blank in the sheet, left as they are · 1 not in this run, skipped");
  const disagree = into.getByRole("group", { name: "Disagrees with the sheet" });
  await expect(disagree).toContainText("1 case disagrees with the sheet");
  await expect(disagree).toContainText("Flaw Patrol: Failed · Sheet: Passed");
  const box = disagree.getByRole("checkbox", { name: `Use the sheet's result for ${HUB}-3` });
  await expect(box).not.toBeChecked();
  await expect(into.getByRole("button", { name: "Add 1 result to the run" })).toBeVisible();
  // "Select" is an untouched dropdown, not an unknown word.
  await expect(page.getByText("Results Flaw Patrol doesn't recognize")).toHaveCount(0);

  await box.check();
  await into.getByRole("button", { name: "Add 2 results to the run" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${CYCLE}/runs/1$`));

  const db = new PrismaClient();
  try {
    const entries = await db.runEntry.findMany({ where: { runId: ids.run }, select: { title: true, status: true, caseId: true } });
    const of = (t: string) => entries.find((e) => e.title === t)?.status;
    expect(of("Untested here")).toBe("PASSED");
    expect(of("Passed both")).toBe("PASSED");
    expect(of("Failed here")).toBe("PASSED");
    expect(of("Blank in sheet")).toBe("UNTESTED");
    expect(entries).toHaveLength(4);
    // The old Failed stays in the case's history, under the sheet's newer Passed.
    const history = await db.testResult.findMany({ where: { caseId: ids.disagree }, orderBy: { createdAt: "asc" }, select: { status: true } });
    expect(history.map((h) => h.status)).toEqual(["FAILED", "PASSED"]);
  } finally {
    await db.$disconnect();
  }
});

test("A new run is still there, and leaves the run in progress alone", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${CYCLE}/runs/import`);
  await page.getByLabel("Sheet file").setInputFiles({ name: "Fresh.csv", mimeType: "text/csv", buffer: Buffer.from(sheet) });
  await page.getByRole("radio", { name: /A new run/ }).check();
  await expect(page.getByRole("region", { name: "Adding to the run" })).toHaveCount(0);
  await expect(page.getByLabel("Run name")).toHaveValue("Fresh");
  await expect(page.getByRole("button", { name: "Create run with 5 cases" })).toBeVisible();
});

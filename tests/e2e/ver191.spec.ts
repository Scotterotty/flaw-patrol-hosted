import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_191 (Scott, Nov 6): a sheet added to a run in progress hands out its testers, even for
// cases with no result yet. A case someone already has here keeps them.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `TA${TAG}`;
const CYCLE = `TB${TAG}`;
const NAME = `Sheet testers ${TAG}`;
const ids = { run: "", cases: [] as string[], admin: "", sam: "" };

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const sam = await db.user.findUniqueOrThrow({ where: { email: "tester@example.com" } });
    ids.admin = admin.id;
    ids.sam = sam.id;
    const members = { create: [{ userId: admin.id, role: "ADMIN" as const }, { userId: sam.id, role: "TESTER" as const }] };
    const hub = await db.project.create({ data: { key: HUB, name: NAME, members } });
    const group = await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }] } });
    const cycle = await db.project.create({ data: { key: CYCLE, name: `${NAME} Web RC 1`, groupId: group.id, platform: "Web", rcName: "RC 1", runSeq: 1, members } });
    const titles = ["Nobody has it", "Passed, nobody has it", "Sam has it"];
    const cases = [];
    for (const [i, title] of titles.entries()) cases.push(await db.testCase.create({ data: { projectId: hub.id, number: i + 1, title } }));
    ids.cases = cases.map((c) => c.id);
    const status = ["UNTESTED", "PASSED", "UNTESTED"] as const;
    const run = await db.testRun.create({
      data: {
        projectId: cycle.id,
        number: 1,
        name: "Web check",
        createdById: admin.id,
        createdBy: "Demo Admin",
        entries: {
          create: cases.map((c, i) => ({ caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: "MEDIUM" as const, steps: [], status: status[i], assigneeId: i === 2 ? sam.id : null, lastTestedAt: status[i] === "UNTESTED" ? null : new Date() })),
        },
      },
      include: { entries: true },
    });
    const passed = run.entries.find((e) => e.status === "PASSED")!;
    await db.testResult.create({ data: { entryId: passed.id, runId: run.id, caseId: passed.caseId, caseVersion: 1, status: "PASSED", stepResults: [], testerId: admin.id, testerName: "Demo Admin" } });
    ids.run = run.id;
  } finally {
    await db.$disconnect();
  }
});

const sheet = [
  "Key,Name,Case result,Executed By",
  `${HUB}-1,Nobody has it,Select,Demo Admin`,
  `${HUB}-2,"Passed, nobody has it",Passed,Sam Tester`,
  `${HUB}-3,Sam has it,,Demo Admin`,
].join("\n");

test("a sheet with only testers assigns the cases nobody has yet", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${CYCLE}/runs/import`);
  await page.getByLabel("Sheet file").setInputFiles({ name: "Assigned.csv", mimeType: "text/csv", buffer: Buffer.from(sheet) });
  const where = page.getByRole("radiogroup", { name: "Where should the results go?" });
  await expect(where.getByRole("radio", { name: /A run in progress/ })).toBeChecked();

  const into = page.getByRole("region", { name: "Updating the run" });
  await expect(into.getByTestId("into-summary")).toContainText("0 cases get a result · 2 get a tester · 1 already matches, skipped · 2 have no result in the sheet");
  await expect(into.getByTestId("into-kept-tester")).toHaveText("1 case already has a different tester here and keeps them.");
  await into.getByRole("button", { name: "Assign 2 cases" }).click();

  await expect(page).toHaveURL(/assigned=2/);
  await expect(page.getByTestId("sheet-updated")).toContainText("Assigned 2 cases to the sheet's testers.");
  await expect(page.getByTestId("sheet-updated")).not.toContainText("Updated");

  const db = new PrismaClient();
  try {
    const entries = await db.runEntry.findMany({ where: { runId: ids.run }, orderBy: { position: "asc" } });
    expect(entries.map((e) => e.assigneeId)).toEqual([ids.admin, ids.sam, ids.sam]);
    // Assigning never adds or changes a result.
    expect(entries.map((e) => e.status)).toEqual(["UNTESTED", "PASSED", "UNTESTED"]);
    expect(await db.testResult.count({ where: { runId: ids.run } })).toBe(1);
  } finally {
    await db.$disconnect();
  }
});

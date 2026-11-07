import { PrismaClient, type ResultStatus } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_195: Execution history shows each run once with its latest save. An open run
// shows as In progress and doesn't count; once it's closed it counts and is locked in.

const KEY = `OR${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("history shows one result per run and counts a run once it's closed", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `One per run ${KEY}`, KEY);
  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Editing Spaces");
  await page.getByLabel("Step 1 action").fill("Open a space");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Editing Spaces" })).toBeVisible();

  const db = new PrismaClient();
  // A run with the case saved once per status, oldest first.
  const runWithSaves = async (number: number, saves: ResultStatus[]) => {
    const project = await db.project.findUniqueOrThrow({ where: { key: KEY }, include: { cases: true } });
    const c = project.cases[0];
    const r = await db.testRun.create({ data: { projectId: project.id, number, name: `Smoke ${number}`, build: `2.4.${number}` } });
    const e = await db.runEntry.create({ data: { runId: r.id, caseId: c.id, caseVersion: 1, position: 1, title: c.title, priority: c.priority, steps: [], status: saves.at(-1) ?? "UNTESTED" } });
    for (const [i, status] of saves.entries())
      await db.testResult.create({ data: { entryId: e.id, runId: r.id, caseId: c.id, caseVersion: 1, status, stepResults: [], createdAt: new Date(Date.now() - (number * 100 - i) * 60_000) } });
    return r;
  };
  try {
    // Saved twice in one open run: one row, In progress, not counted yet.
    const first = await runWithSaves(1, ["FAILED", "PASSED"]);
    await page.goto(`/p/${KEY}/cases/1`);
    const rows = page.getByRole("row").filter({ hasText: "v2.4.1" });
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("In progress");
    await expect(rows).toContainText("Passed");
    await expect(page.getByText("Counts once the run closes")).toBeVisible();

    // Closed: it counts and the In progress tag is gone.
    await db.testRun.update({ where: { id: first.id }, data: { state: "COMPLETED" } });
    await page.reload();
    await expect(page.getByText("1 run · 100% passed")).toBeVisible();
    await expect(rows).not.toContainText("In progress");

    // Retests inside one closed run don't make it look flaky.
    await runWithSaves(2, ["FAILED", "PASSED", "FAILED", "PASSED"]).then((r) => db.testRun.update({ where: { id: r.id }, data: { state: "COMPLETED" } }));
    await page.reload();
    await expect(page.getByText("2 runs · 100% passed")).toBeVisible();
    await expect(page.getByText("Flaky", { exact: true })).toHaveCount(0);

    // The runner's panel agrees: two runs, each listed once.
    await runWithSaves(3, []);
    await page.goto(`/p/${KEY}/runs/3/execute`);
    const history = page.getByRole("region", { name: "Execution history" });
    await expect(history).toContainText("2 runs · 100% passed");
    await expect(history.getByRole("listitem")).toHaveCount(2);
  } finally {
    await db.$disconnect();
  }
});

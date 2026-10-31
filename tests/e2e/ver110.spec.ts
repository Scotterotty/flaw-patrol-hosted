import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_110: a shared step's heading row takes no result, so the Run List's pips and the run page's
// step counts leave it out. Real steps right next to headings still count.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `HD${TAG}`;
const ids = { live: "", saved: "" };

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 110 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const project = await db.project.create({
      data: { key: KEY, name: `Headings ${TAG}`, caseSeq: 2, runSeq: 1, members: { create: [{ userId: admin.id, role: "ADMIN" }] } },
    });
    const makeCase = (number: number, title: string) =>
      db.testCase.create({ data: { projectId: project.id, number, title, versions: { create: { version: 1, title, preconditions: "", priority: "HIGH", type: "MANUAL", tags: [], steps: [] } } } });
    const entering = { id: "entering", name: "ENTERING SPACES", version: 1 };
    const assets = { id: "assets", name: "ASSETS PANEL", version: 1 };
    // Like TCT-3: a heading, then four real steps.
    const liveSteps = [
      { number: "1.1", action: "ENTERING SPACES", expected: "", shared: entering },
      { number: "1.2", action: "Enter a Space\nA user can enter a Space without issue.", expected: "", shared: entering },
      { number: "1.3", action: "Owned By You\nA user can enter a Space they own.", expected: "User can enter space", shared: entering },
      { number: "1.4", action: "Shared With You\nA user can enter a Space they have been invited to.", expected: "User can enter space", shared: entering },
      { number: "1.5", action: "Discover / Featured Space\nA user can enter a featured Space.", expected: "User can enter space", shared: entering },
    ];
    // Two shared steps, each opening with a heading; the short "Owned By You" row is a real step.
    const savedSteps = [
      { number: "1", action: "Open the hub.", expected: "The hub opens." },
      { number: "2.1", action: "Assets Panel", expected: "", shared: assets },
      { number: "2.2", action: "Open the assets panel.", expected: "It opens.", shared: assets },
      { number: "3.1", action: "ENTERING SPACES", expected: "", shared: entering },
      { number: "3.2", action: "Enter a Space.", expected: "The Space opens.", shared: entering },
      { number: "3.3", action: "Owned By You", expected: "", shared: entering },
    ];
    const a = await makeCase(1, "Hub - Entering Spaces");
    const b = await makeCase(2, "In Space - Assets Panel");
    const run = await db.testRun.create({
      data: {
        projectId: project.id,
        number: 1,
        name: "Headings",
        createdBy: "Demo Admin",
        entries: {
          create: [
            { caseId: a.id, caseVersion: 1, position: 0, title: a.title, priority: "HIGH", steps: liveSteps },
            { caseId: b.id, caseVersion: 1, position: 1, title: b.title, priority: "HIGH", steps: savedSteps, status: "PASSED" },
          ],
        },
      },
      include: { entries: { orderBy: { position: "asc" } } },
    });
    ids.live = run.entries[0].id;
    ids.saved = run.entries[1].id;
    // Saved the way the runner saves it: one row per step, headings left Untested.
    const stepResults = ["PASSED", "UNTESTED", "PASSED", "UNTESTED", "PASSED", "PASSED"].map((status) => ({ status, actual: "" }));
    await db.testResult.create({ data: { entryId: ids.saved, runId: run.id, caseId: b.id, caseVersion: 1, status: "PASSED", stepResults, testerId: admin.id, testerName: "Demo Admin" } });
  } finally {
    await db.$disconnect();
  }
});

test("heading rows aren't counted as steps, and real steps are", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");

  // Run page: the saved case shows 4 of 4 lit, and the step totals leave the 3 headings out (4 + 4 real steps).
  await page.goto(`/p/${KEY}/runs/1`);
  const savedRow = page.getByRole("row").filter({ hasText: "In Space - Assets Panel" });
  await expect(savedRow.getByText("4/4", { exact: true })).toBeVisible();
  await expect(page.getByText("0 failed or blocked of 8 steps")).toBeVisible();

  // Runner: the TCT-3 style case has one heading and four real steps, each with its own buttons.
  await page.goto(`/p/${KEY}/runs/1/execute?entry=${ids.live}`);
  await expect(page.getByText("heading, no result needed")).toHaveCount(1);
  for (const n of ["1.2", "1.3", "1.4", "1.5"]) await expect(page.getByRole("group", { name: `Step ${n} status` })).toBeVisible();
  await expect(page.getByRole("group", { name: "Step 1.1 status" })).toHaveCount(0);

  const list = page.getByRole("complementary").or(page.locator("body"));
  const liveRow = list.getByRole("link").filter({ hasText: "Hub - Entering Spaces" });
  const savedLink = list.getByRole("link").filter({ hasText: "In Space - Assets Panel" });
  await expect(savedLink.getByText("4/4", { exact: true })).toBeVisible();

  // Marking all four real steps lights all four pips; there's no grey one left for the heading.
  for (const n of ["1.2", "1.3", "1.4", "1.5"]) await page.getByRole("group", { name: `Step ${n} status` }).getByRole("button", { name: "Passed" }).click();
  await expect(liveRow.getByText("4/4", { exact: true })).toBeVisible();
  await expect(page.getByText("from steps: 4 passed")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Last result in this run/)).toBeVisible();

  // Back on the run page: both cases 4/4, and 8 steps passed of 8.
  await page.goto(`/p/${KEY}/runs/1`);
  await expect(page.getByRole("row").filter({ hasText: "Hub - Entering Spaces" }).getByText("4/4", { exact: true })).toBeVisible();
  await expect(page.getByText("8 passed", { exact: true })).toBeVisible();
  await expect(page.getByText("0 failed or blocked of 8 steps")).toBeVisible();

  // The short "Owned By You" row after a heading is a real step with its own buttons.
  await page.goto(`/p/${KEY}/runs/1/execute?entry=${ids.saved}`);
  await expect(page.getByRole("group", { name: "Step 3.3 status" })).toBeVisible();
});

import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_95: one Create a run button that asks the kind of run (and can make the test cycle),
// Reports that never add hand testing and automation together, automated cases that
// look like the rest with a "Who runs it" filter, Playwright attempts, and the My picture pawn.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `KH${TAG}`;
const NAME = `Kinds ${TAG}`;
let groupId = "";
let cycleKey = "";

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 95 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: NAME, caseSeq: 4, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const manual = await Promise.all(
      ["Sign in", "Open the map"].map((title, i) => db.testCase.create({ data: { projectId: hub.id, number: i + 1, title, versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags: [], steps: [{ kind: "step", action: "Do it", expected: "It works" }] } } } })),
    );
    const auto = await db.testCase.create({
      data: { projectId: hub.id, number: 3, title: "Adds an item to the cart", type: "AUTOMATED", automationId: "shop.spec.ts.Shop › adds an item to the cart", versions: { create: { version: 1, title: "Adds an item to the cart", preconditions: "", priority: "MEDIUM", type: "AUTOMATED", tags: [], steps: [] } } },
    });
    const suite = await db.testSuite.create({ data: { projectId: hub.id, name: "Smoke", cases: { create: manual.map((c, i) => ({ caseId: c.id, position: i })) } } });
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [suite.id] }], runKinds: [{ id: "smoke", name: "Smoke test", suiteId: suite.id }] } })).id;
    cycleKey = `KC${TAG}`;
    const cycle = await db.project.create({ data: { key: cycleKey, name: `Demo RC 1 ${TAG}`, groupId, platform: "Web", runSeq: 2, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    // One hand run nobody has started, and one automated run whose test was retried.
    const entry = (c: { id: string; title: string }, i: number) => ({ caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: "MEDIUM" as const, steps: [] });
    await db.testRun.create({ data: { projectId: cycle.id, number: 1, name: "By hand", createdBy: "Demo Admin", entries: { create: manual.map(entry) } } });
    const run = await db.testRun.create({
      data: { projectId: cycle.id, number: 2, name: "CI", automated: true, state: "COMPLETED", createdBy: "CI", entries: { create: [{ ...entry(auto, 0), status: "FAILED" }] } },
      include: { entries: true },
    });
    const result = await db.testResult.create({ data: { entryId: run.entries[0].id, runId: run.id, caseId: auto.id, caseVersion: 1, status: "FAILED", stepResults: [], automated: true, testerName: "Automation", failureMessage: "Expected 2 items" } });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    for (const attempt of [1, 2]) {
      await db.attachment.create({ data: { projectId: cycle.id, resultId: result.id, fileName: "test-failed-1.png", contentType: "image/png", size: png.length, data: png, kind: "screenshot", attempt } });
    }
  } finally {
    await db.$disconnect();
  }
});

test("one Create a run button: pick the kind, add a kind, make the test cycle on Start", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${groupId}`);
  // Only Create a run up top; the setup card says the first run is in progress.
  await expect(page.getByRole("button", { name: /Start next release/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add test cycle/ })).toHaveCount(0);
  await expect(page.getByText(`Demo RC 1 ${TAG} is in progress`)).toBeVisible();

  await page.getByRole("button", { name: /Create a run/ }).first().click();
  const box = page.getByRole("dialog");
  await expect(box.getByRole("heading", { name: "1. What kind of run?" })).toBeVisible();
  await expect(box.getByRole("button", { name: /^Smoke test.*Usually runs Smoke/ })).toBeVisible();
  await expect(box.getByRole("button", { name: /^Release candidate/ })).toBeVisible();

  // + New kind… adds it and uses it at once.
  await box.getByRole("button", { name: /New kind/ }).click();
  await box.getByLabel("Name").fill("Regression");
  await box.getByRole("button", { name: "Add and use it" }).click();
  await expect(box.getByTestId("kind-picked")).toContainText("Regression");

  // Pick Smoke test instead: its usual suite is offered, not picked (ver_99).
  await box.getByTestId("kind-picked").getByRole("button", { name: "Change" }).click();
  await box.getByRole("button", { name: /^Smoke test/ }).click();
  await expect(box.getByRole("button", { name: "Create smoke test" })).toBeDisabled();
  await box.getByTestId("usual-suite").getByRole("button", { name: "Use it" }).click();
  await expect(box.getByRole("radio", { name: /Smoke/ })).toBeChecked();
  // Test cycle: the only one is ticked for you (ver_178); untick it, and + New test cycle is made on Start.
  await expect(box.getByRole("checkbox", { name: `Demo RC 1 ${TAG}` })).toBeChecked();
  await box.getByRole("checkbox", { name: `Demo RC 1 ${TAG}` }).uncheck();
  await box.getByRole("button", { name: "＋ New test cycle" }).click();
  await box.getByLabel("Name", { exact: true }).fill(`Sprint 14 ${TAG}`);
  await expect(box.getByText(`Goes in Sprint 14 ${TAG} (new)`)).toBeVisible();
  await box.getByRole("button", { name: "Create smoke test" }).click();
  await expect(page).toHaveURL(/\/runs\/1$/, { timeout: 60_000 });

  // The run keeps its kind: a tag on Test runs and a Kind filter.
  await page.goto(`/g/${groupId}/runs?kind=smoke`);
  await expect(page.getByTestId("kind-tag").first()).toHaveText("Smoke test");
  await expect(page.getByText("By hand", { exact: true })).toHaveCount(0);

  // Umbrella Settings → Run kinds lists the built-ins and Regression.
  await page.goto(`/g/${groupId}/settings`);
  const row = page.locator("#row-run-kinds");
  await expect(row).toContainText("Smoke test, Release candidate, Bug bash, Regression");
});

test("Reports split hand testing from automation; automated cases look like the rest", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${groupId}/reports?range=all`);
  await expect(page.getByTestId("no-manual-banner")).toContainText(/0 of \d+ cases have been tested by hand/);
  await expect(page.getByText("✋ Manual testing").first()).toBeVisible();
  await expect(page.getByText("🤖 Automated tests").first()).toBeVisible();
  await expect(page.getByText("Pass rate", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("cycle-manual").first()).toContainText("0 / 2");
  await expect(page.getByTestId("cycle-auto").first()).toContainText("1 / 1");
  // Automated only: no banner, only that side.
  await page.goto(`/g/${groupId}/reports?range=all&runs=automated`);
  await expect(page.getByTestId("no-manual-banner")).toHaveCount(0);

  // Case library: the count line and Who runs it.
  await page.goto(`/p/${HUB}/cases`);
  await expect(page.getByTestId("who-runs-count")).toHaveText("3 cases · ✋ 2 by hand · 🤖 1 by automation · 0 both");
  await expect(page.getByTestId("auto-line")).toContainText("🤖 Automated · Failed");
  await page.getByLabel("Who runs it").selectOption("auto");
  await expect(page.getByRole("link", { name: "Adds an item to the cart" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
});

test("a retried Playwright test shows one attempt at a time", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${cycleKey}/runs/2`);
  const attempts = page.getByTestId("attempts");
  await expect(attempts.getByRole("tab", { name: "Attempt 2 (last)" })).toHaveAttribute("aria-selected", "true");
  await expect(attempts).toContainText("Failed both attempts");
  await expect(page.getByText("Screenshot when it failed (attempt 2)")).toBeVisible();
  await attempts.getByRole("tab", { name: "Attempt 1" }).click();
  await expect(page.getByText("Screenshot when it failed (attempt 1)")).toBeVisible();
  await expect(page.getByText("· 2 attempts")).toBeVisible();
});

test("My picture pawn: offers to add a picture when there's none", async ({ page }) => {
  const db = new PrismaClient();
  try {
    await db.user.update({ where: { email: "admin@example.com" }, data: { gameEnabled: true, questMap: true, avatar: null, avatarAt: null } });
  } finally {
    await db.$disconnect();
  }
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${cycleKey}/quests`);
  await page.getByRole("button", { name: "Change pawn" }).first().click();
  const box = page.getByRole("dialog");
  await box.getByRole("button", { name: /My picture/ }).click();
  await expect(box.getByTestId("pawn-add-picture")).toBeVisible();
  await expect(box.getByRole("button", { name: "Upload picture" })).toBeVisible();
});

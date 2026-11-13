import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_237: a bug bash in Reports is listed apart from the test cycles, under Bug bashes,
// with a Bug bash badge, its name and day. It doesn't count in the Status numbers.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `BX${TAG}`;
const NAME = `Bash rows ${TAG}`;
let groupId = "";
let bashId = "";

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: NAME, caseSeq: 4, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const cases = await Promise.all(
      ["Sign in", "Open the map", "Buy a hat", "Log out"].map((title, i) =>
        db.testCase.create({ data: { projectId: hub.id, number: i + 1, title, versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags: [], steps: [{ kind: "step", action: "Do it", expected: "It works" }] } } } }),
      ),
    );
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }], rolesChosenAt: new Date() } })).id;
    await db.project.update({ where: { id: hub.id }, data: { groupId } });
    const cycle = await db.project.create({ data: { key: `BY${TAG}`, name: `Web RC 23 ${TAG}`, groupId, platform: "Web", runSeq: 1, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const entry = (c: { id: string; title: string }, i: number, status: "PASSED" | "FAILED" | "UNTESTED") => ({ caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: "MEDIUM" as const, steps: [], status });
    await db.testRun.create({ data: { projectId: cycle.id, number: 1, name: "RC 23", createdBy: "Demo Admin", entries: { create: cases.slice(0, 2).map((c, i) => entry(c, i, "PASSED")) } } });
    // The bash's run, on the hub: 3 of 4 done, one failed.
    const run = await db.testRun.create({
      data: { projectId: hub.id, number: 1, name: `Bug bash · ${NAME}`, createdBy: "Demo Admin", entries: { create: cases.map((c, i) => entry(c, i, i === 3 ? "UNTESTED" : i === 2 ? "FAILED" : "PASSED")) } },
    });
    const now = Date.now();
    bashId = (
      await db.bugBash.create({
        data: { projectId: hub.id, runId: run.id, name: `Hats ${TAG}`, minutes: 60, startsAt: new Date(now - 3 * 3_600_000), endsAt: new Date(now - 2 * 3_600_000), areas: [], createdById: admin.id, createdBy: "Demo Admin" },
      })
    ).id;
  } finally {
    await db.$disconnect();
  }
});

test("Reports lists a bug bash under Bug bashes, apart from the test cycles, and leaves it out of the numbers", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${groupId}/reports?range=all`);
  // The test cycle keeps its Manual row; the bash isn't one of them.
  await expect(page.getByTestId("cycle-manual")).toHaveCount(1);
  await expect(page.getByTestId("cycle-manual")).toContainText("2 / 2");
  const group = page.getByTestId("cycle-bashes");
  await expect(group).toContainText("🐞 Bug bashes");
  const row = group.getByTestId("cycle-bash");
  await expect(row).toContainText(`Hats ${TAG} bug bash`);
  await expect(row).toContainText("Bug bash");
  await expect(row).toContainText("3 / 4");
  await expect(row).not.toContainText("Manual");
  await expect(group).toContainText("don't count toward pass rates");
  // Only the RC run counts: 1 run, 2 of 2 tested by hand.
  await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
  await row.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/bashes/${bashId}/report$`));
});

test("Runs set to Bug bash counts only the bash", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${groupId}/reports?range=all&runs=bash`);
  await expect(page.getByTestId("cycle-manual")).toHaveCount(0);
  await expect(page.getByTestId("cycle-bash")).toHaveCount(1);
  await expect(page.getByText("3 of 4", { exact: true })).toBeVisible();
});

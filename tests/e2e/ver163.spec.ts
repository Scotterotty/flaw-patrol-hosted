import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_163: Start a run is now Create a run, each run's Start testing is the big button,
// and the umbrella's Overview starts with Runs in progress from every test cycle.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Go ${TAG}`;
let groupId = "";
let webKey = "";

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 163 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: `GH${TAG}`, name: NAME, caseSeq: 3, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const cases = await Promise.all(
      ["Sign in", "Open the map"].map((title, i) => db.testCase.create({ data: { projectId: hub.id, number: i + 1, title, versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags: [], steps: [{ kind: "step", action: "Do it", expected: "It works" }] } } } })),
    );
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web" }, { name: "Unity" }] } })).id;
    webKey = `GW${TAG}`;
    const member = { create: { userId: admin.id, role: "ADMIN" as const } };
    const web = await db.project.create({ data: { key: webKey, name: `Web RC ${TAG}`, groupId, platform: "Web", runSeq: 2, members: member } });
    const unity = await db.project.create({ data: { key: `GU${TAG}`, name: `Unity RC ${TAG}`, groupId, platform: "Unity", runSeq: 1, members: member } });
    // An archived test cycle: its run stays off the Overview.
    const old = await db.project.create({ data: { key: `GO${TAG}`, name: `Old RC ${TAG}`, groupId, platform: "Web", runSeq: 1, archivedAt: new Date(), members: member } });
    const entry = (c: { id: string; title: string }, i: number, status?: "PASSED") => ({ caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: "MEDIUM" as const, steps: [], ...(status ? { status } : {}) });
    await db.testRun.create({ data: { projectId: web.id, number: 1, name: `Fresh web ${TAG}`, createdBy: "Demo Admin", entries: { create: cases.map((c, i) => entry(c, i)) } } });
    await db.testRun.create({ data: { projectId: unity.id, number: 1, name: `Half unity ${TAG}`, createdBy: "Demo Admin", entries: { create: cases.map((c, i) => entry(c, i, i === 0 ? "PASSED" : undefined)) } } });
    await db.testRun.create({ data: { projectId: old.id, number: 1, name: `Archived run ${TAG}`, createdBy: "Demo Admin", entries: { create: cases.map((c, i) => entry(c, i)) } } });
  } finally {
    await db.$disconnect();
  }
});

test("the Overview starts with Runs in progress, and Start testing is the big button", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${groupId}`);
  const box = page.getByTestId("umbrella-runs-in-progress");
  await expect(box.getByTestId("progress-run")).toHaveCount(2);
  await expect(box).toContainText(`in Web RC ${TAG}`);
  await expect(box).toContainText(`in Unity RC ${TAG}`);
  await expect(box).not.toContainText(`Archived run ${TAG}`);
  await expect(box.getByRole("link", { name: `Continue testing R1 Half unity ${TAG}` })).toBeVisible();
  // Runs are waiting, so Create a run is the quieter button.
  const create = page.getByRole("button", { name: "▶ Create a run" });
  await expect(create).toBeVisible();
  await expect(create).not.toHaveClass(/bg-accent-600/);

  // Start testing goes straight to the runner.
  await box.getByRole("link", { name: `Start testing R1 Fresh web ${TAG}` }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${webKey}/runs/1/execute`), { timeout: 60_000 });

  // The test cycle page: same big button; the box's last button says Create.
  await page.goto(`/p/${webKey}`);
  await expect(page.getByRole("link", { name: `Start testing R1 Fresh web ${TAG}` })).toBeVisible();
  await page.getByRole("button", { name: "Create a run" }).click();
  await expect(page.getByRole("dialog", { name: "Create a run" })).toBeVisible();
});

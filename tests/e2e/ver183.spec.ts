import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_183: results brought in from a spreadsheet move the quest pawn but never take finds or
// fall into trouble, and people with no name show a name made from their email.

const TAG = Date.now().toString(36).slice(-4).toLowerCase();
const KEY = `QI${TAG.toUpperCase()}`;
const EMAIL = `quest-import-${TAG}@example.com`;
const RYAN = `ryan.meredith@${TAG}.example.com`;

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const me = await db.user.create({ data: { email: EMAIL, name: "Sky Import", whatsNewSeen: 183, gameEnabled: true, gameTitle: "rookie", questMap: true } });
    const ryan = await db.user.create({ data: { email: RYAN } });
    const project = await db.project.create({
      data: { key: KEY, name: `Quest import ${TAG}`, caseSeq: 13, runSeq: 2, members: { create: [{ userId: me.id, role: "ADMIN" }, { userId: ryan.id, role: "TESTER" }] } },
    });
    const run = await db.testRun.create({ data: { projectId: project.id, number: 1, name: "Imported road" } });
    for (let i = 0; i < 12; i++) {
      const title = `Case ${i + 1}`;
      const c = await db.testCase.create({ data: { projectId: project.id, number: i + 1, title, versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags: [], steps: [] } } } });
      const e = await db.runEntry.create({ data: { runId: run.id, caseId: c.id, caseVersion: 1, position: i, title, priority: "MEDIUM", steps: [], status: "PASSED" } });
      // Case 1 saved here today; the rest imported, dated earlier (the sheet's day).
      const live = i === 0;
      await db.testResult.create({
        data: {
          entryId: e.id, runId: run.id, caseId: c.id, caseVersion: 1, status: "PASSED", stepResults: [],
          testerId: live ? me.id : ryan.id, testerName: live ? "Sky Import" : RYAN, imported: !live,
          createdAt: live ? new Date() : new Date(Date.now() - 3_600_000 + i * 1000),
        },
      });
    }
  } finally {
    await db.$disconnect();
  }
});

test("imported results walk the road but find nothing, and names replace emails", async ({ page }) => {
  await signIn(page, EMAIL, "Sky Import");
  await page.goto(`/p/${KEY}/quests/1`);
  await expect(page.getByText("Along the way")).toBeVisible();
  await expect(page.getByText("Ryan Meredith").first()).toBeVisible();
  await expect(page.getByText(RYAN)).toHaveCount(0);
  // Nothing on the road went to Ryan's imported results.
  await expect(page.locator("ol li").filter({ hasText: /Ryan Meredith/ })).toHaveCount(0);
  await expect(page.locator("svg title").filter({ hasText: /^Ryan Meredith (found|defeated|met|slipped|got|stepped|stubbed|fell|was)/ })).toHaveCount(0);
});

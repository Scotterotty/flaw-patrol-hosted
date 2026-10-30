import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { openAccount, signIn } from "./auth";

// ver_98: quest maps dress up for the season of the day their run started, unless you turn
// Seasonal maps off in Account → Mini game.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `SN${TAG}`;
const EMAIL = `seasons-${TAG.toLowerCase()}@example.com`;

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const user = await db.user.create({ data: { email: EMAIL, name: "Sky Seasons", whatsNewSeen: 98, gameEnabled: true, gameTitle: "rookie", questMap: true } });
    const project = await db.project.create({ data: { key: KEY, name: `Seasons ${TAG}`, caseSeq: 1, runSeq: 3, members: { create: [{ userId: user.id, role: "ADMIN" }] } } });
    const title = "Open the shop";
    const c = await db.testCase.create({ data: { projectId: project.id, number: 1, title, versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags: [], steps: [] } } } });
    const entry = { caseId: c.id, caseVersion: 1, position: 0, title, priority: "MEDIUM" as const, steps: [] };
    // One run started at Halloween, one in summer.
    await db.testRun.create({ data: { projectId: project.id, number: 1, name: "Spooky run", createdAt: new Date("2026-10-20T12:00:00Z"), entries: { create: [entry] } } });
    await db.testRun.create({ data: { projectId: project.id, number: 2, name: "Sunny run", createdAt: new Date("2026-07-04T12:00:00Z"), entries: { create: [entry] } } });
  } finally {
    await db.$disconnect();
  }
});

test("quest maps take the season of the day the run started, and the switch turns it off", async ({ page }) => {
  await signIn(page, EMAIL, "Sky Seasons");
  const map = page.getByRole("img", { name: /quest from/i }).first();

  await page.goto(`/p/${KEY}/quests/1`);
  await expect(map).toHaveAttribute("aria-label", /^Halloween quest from/);
  await expect(map.getByText("🏚️")).toBeVisible();
  await page.goto(`/p/${KEY}/quests/2`);
  await expect(map).toHaveAttribute("aria-label", /^Summer quest from/);
  // The small maps on the Quests page are seasonal too.
  await page.goto(`/p/${KEY}/quests`);
  await expect(page.getByRole("img", { name: /^Halloween quest from/ })).toBeVisible();

  // On by default; off shows the plain map.
  await openAccount(page);
  const seasonal = page.getByLabel("Seasonal maps");
  await expect(seasonal).toBeChecked();
  await seasonal.uncheck();
  await page.goto(`/p/${KEY}/quests/1`);
  await expect(map).toHaveAttribute("aria-label", /^Quest from/);

  await openAccount(page);
  await expect(page.getByLabel("Seasonal maps")).not.toBeChecked();
  await page.getByLabel("Seasonal maps").check();
  await page.goto(`/p/${KEY}/quests/1`);
  await expect(map).toHaveAttribute("aria-label", /^Halloween quest from/);
});

import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_158: the platform chips on the Case library also match the platform's tag and the cases
// picked for it, not only its suites, so Web + Account shows the Web Account cases. With a
// platform picked, the Tags row counts only that platform's cases.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `PF${TAG}`;
const NAME = `Platform filter ${TAG}`;

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 999 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const rows: [string, string[]][] = [
      ["Sign in with email", ["Web", "Account"]],
      ["Reset password", ["Web", "Account"]],
      ["Space list loads", ["Web", "Hub"]],
      ["Unity sign in", ["Unity", "Account"]],
      ["Unity picked case", ["Spaces"]],
      ["Unity suite case", ["Account"]],
    ];
    const hub = await db.project.create({ data: { key: HUB, name: NAME, caseSeq: rows.length, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const steps = [{ kind: "step", action: "Open the app", expected: "It opens" }];
    const ids: string[] = [];
    for (const [i, [title, tags]] of rows.entries())
      ids.push((await db.testCase.create({ data: { projectId: hub.id, number: i + 1, title, tags, versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags, steps } } } })).id);
    const suite = await db.testSuite.create({ data: { projectId: hub.id, name: "Unity smoke", cases: { create: { caseId: ids[5], position: 0 } } } });
    await db.projectGroup.create({
      data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }, { name: "Unity", suiteIds: [suite.id], caseIds: [ids[4]] }] },
    });
  } finally {
    await db.$disconnect();
  }
});

test("Platform chip + tag: tagged, picked and suite cases all count, and tag numbers follow the platform", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  const tags = page.getByTestId("tags-row");

  // Web has no suites: its tag decides. Account drops to the 2 Web ones; Spaces (not on Web) leaves the row.
  await page.goto(`/p/${HUB}/cases?platform=Web`);
  await expect(tags.getByRole("link", { name: /^Account\s*2$/ })).toBeVisible();
  await expect(tags.getByRole("link", { name: /^Spaces/ })).toHaveCount(0);
  await tags.getByRole("link", { name: /^Account/ }).click();
  await expect(page).toHaveURL(/tag=Account/);
  await expect(page.getByRole("link", { name: "Sign in with email" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Reset password" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Space list loads" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Unity sign in" })).toHaveCount(0);

  // Unity: its tag, its picked case and its suite's case.
  await page.goto(`/p/${HUB}/cases?platform=Unity`);
  for (const t of ["Unity sign in", "Unity picked case", "Unity suite case"]) await expect(page.getByRole("link", { name: t })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in with email" })).toHaveCount(0);
  await expect(tags.getByRole("link", { name: /^Account\s*2$/ })).toBeVisible();

  // No platform: the whole library's counts.
  await page.goto(`/p/${HUB}/cases`);
  await expect(tags.getByRole("link", { name: /^Account\s*4$/ })).toBeVisible();
});

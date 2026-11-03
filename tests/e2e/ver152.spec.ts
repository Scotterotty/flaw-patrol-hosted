import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_152: a bug bash can count toward a release, picked by name when it starts (or changed later).
// It stays on the umbrella with the platforms it lists; that release's Release status shows it
// under Exploring and bug bashes and lists every bug it found, while the platform columns stay the same.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const UMB = `Bash RC ${TAG}`;
const HUB = `BR${TAG}`;
const ids: Record<string, string> = {};

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const team = [{ userId: admin.id, role: "ADMIN" as const }];
    const hub = await db.project.create({ data: { key: HUB, name: UMB, caseSeq: 1, members: { create: team } } });
    const group = await db.projectGroup.create({
      data: { name: UMB, hubProjectId: hub.id, platforms: [{ name: "iOS", suiteIds: [] }, { name: "Android", suiteIds: [] }], rolesChosenAt: new Date() },
    });
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
    const kase = await db.testCase.create({ data: { projectId: hub.id, number: 1, title: "Sign in" } });
    const cycle = (key: string, platform: string) =>
      db.project.create({ data: { key, name: `${UMB} ${platform} 4.2`, platform, rcName: "4.2", groupId: group.id, members: { create: team.map((m) => ({ ...m, fromUmbrella: true })) } } });
    const ios = await cycle(`BI${TAG}`, "iOS");
    await cycle(`BA${TAG}`, "Android");
    await db.testRun.create({
      data: {
        projectId: ios.id,
        number: 1,
        name: "Smoke iOS",
        kind: "smoke",
        release: "4.2",
        createdById: admin.id,
        createdBy: "Demo Admin",
        entries: { create: [{ caseId: kase.id, caseVersion: 1, position: 0, title: kase.title, priority: "MEDIUM", steps: [], status: "PASSED", lastTestedAt: new Date() }] },
      },
    });
    Object.assign(ids, { group: group.id, hub: hub.id });
  } finally {
    await db.$disconnect();
  }
});

test("a bug bash counted toward 4.2 shows on its Release status, and can be taken out again", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page, "admin@example.com", "Demo Admin");

  // Start: release names, not test cycles. Off by default.
  await page.goto(`/p/${HUB}/bashes`);
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const box = page.getByRole("dialog");
  const pick = box.getByTestId("bash-release");
  await expect(pick.getByRole("radio", { name: "No, keep it on its own" })).toHaveAttribute("aria-checked", "true");
  await expect(pick).toContainText("Kept on its own.");
  await pick.getByRole("radio", { name: "4.2" }).click();
  await expect(pick).toContainText("Its bugs show on the 4.2 Release status report, for the platforms this bash lists: iOS, Android.");
  await box.getByLabel("Name").fill(`Counted bash ${TAG}`);
  await box.getByLabel("Add an area").fill("Checkout");
  await box.getByLabel("Add an area").press("Enter");
  await box.getByRole("button", { name: "Start bug bash" }).click();
  await box.getByRole("link", { name: "Open the bash" }).click();
  await expect(page.getByTestId("bash-release-pill")).toContainText("Counts toward 4.2");

  // Its run stays on the umbrella, marked 4.2.
  const db = new PrismaClient();
  const bash = await db.bugBash.findFirstOrThrow({ where: { name: `Counted bash ${TAG}` }, include: { run: true } });
  expect(bash.release).toBe("4.2");
  expect(bash.run?.projectId).toBe(ids.hub);
  expect(bash.run?.release).toBe("4.2");

  // Log a Medium bug and wrap up.
  await page.getByTestId("join-strip").getByRole("button", { name: "Join the bug bash" }).click();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: /^Start bashing/ }).click();
  await expect(page).toHaveURL(/\/explore$/);
  await page.getByLabel("What did you find?").fill(`Coupon field loses text ${TAG}`);
  await page.getByRole("button", { name: "Log bug" }).click();
  await expect(page.getByTestId("live-finds")).toContainText(`Coupon field loses text ${TAG}`);
  await page.goto(`/p/${HUB}/bashes/${bash.id}`);
  await page.getByRole("button", { name: "End early" }).click();
  await page.getByRole("button", { name: "Yes, end it" }).click();
  await page.getByRole("button", { name: /File 1 bug|Wrap up/ }).click();
  await expect(page).toHaveURL(/\/report$/, { timeout: 30_000 });

  // Release status: the bash under Exploring and bug bashes, and its Medium bug listed. iOS is still 1 of 1.
  await page.goto(`/g/${ids.group}/rc?release=4.2`);
  const wraps = page.getByTestId("wrap-ups");
  await expect(wraps).toContainText(`Counted bash ${TAG}`);
  await expect(wraps).toContainText("Counts toward 4.2");
  await expect(page.getByRole("heading", { name: "Critical and blocking bugs, plus bug bash bugs" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: `Coupon field loses text ${TAG}` })).toContainText("from bug bash");

  // Change it on the report: keep it on its own. It leaves the release.
  await page.goto(`/p/${HUB}/bashes/${bash.id}/report`);
  const pill = page.getByTestId("bash-release-pill");
  await pill.getByRole("button", { name: "Change" }).click();
  await pill.getByRole("radio", { name: "No, keep it on its own" }).click();
  await pill.getByRole("button", { name: "Save" }).click();
  await expect(pill).toContainText("Not counted toward a release");
  expect((await db.testRun.findUniqueOrThrow({ where: { id: bash.runId! } })).release).toBe("");
  await page.goto(`/g/${ids.group}/rc?release=4.2`);
  await expect(page.getByText(`Counted bash ${TAG}`)).toHaveCount(0);
  await expect(page.getByText(`Coupon field loses text ${TAG}`)).toHaveCount(0);
  await db.$disconnect();
});

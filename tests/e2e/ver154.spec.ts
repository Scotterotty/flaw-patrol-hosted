import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_154: the Bug bashes list. Red means live, and only live; a coming-up bash is blue; an ended
// bash says Needs wrap-up, who files its bugs, and has a Wrap up and file bugs button.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `BL${TAG}`;

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: `Bash list ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
    const group = await db.projectGroup.create({ data: { name: `Bash list ${TAG}`, hubProjectId: hub.id, rolesChosenAt: new Date() } });
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
    const now = Date.now();
    const areas = [{ id: "a1", name: "Checkout", caseId: "none", template: null }];
    const bash = (name: string, startMin: number, minutes: number) =>
      db.bugBash.create({ data: { projectId: hub.id, name, minutes, startsAt: new Date(now + startMin * 60_000), endsAt: new Date(now + (startMin + minutes) * 60_000), areas, createdById: admin.id, createdBy: "Demo Admin" } });
    await bash(`Live one ${TAG}`, -10, 60);
    await bash(`Soon one ${TAG}`, 3 * 24 * 60, 60);
    const ended = await bash(`Done one ${TAG}`, -24 * 60, 60);
    await db.bashItem.createMany({
      data: [
        { bashId: ended.id, areaId: "a1", kind: "bug", text: `Cart total wrong ${TAG}`, byId: admin.id, byName: "Demo Admin" },
        { bashId: ended.id, areaId: "a1", kind: "bug", text: `Coupon lost ${TAG}`, byId: admin.id, byName: "Demo Admin" },
      ],
    });
  } finally {
    await db.$disconnect();
  }
});

test("live, coming up and needs wrap-up each look different, in that order", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/bashes`);
  const cards = page.getByTestId("live-bash");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toHaveAttribute("data-phase", "live");
  await expect(cards.nth(1)).toHaveAttribute("data-phase", "scheduled");
  await expect(cards.nth(2)).toHaveAttribute("data-phase", "ended");

  // Red is only on the live one.
  await expect(cards.nth(0)).toHaveClass(/border-red-400/);
  await expect(cards.nth(1)).not.toHaveClass(/border-red/);
  await expect(cards.nth(2)).not.toHaveClass(/border-red/);

  const done = cards.nth(2);
  await expect(done).toContainText("Needs wrap-up");
  await expect(done).not.toContainText("Wrapping up");
  await expect(done.getByTestId("bash-wrap-line")).toContainText("2 bugs waiting to be filed by Demo Admin");
  await done.getByRole("link", { name: "Wrap up and file bugs" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${HUB}/bashes/[^/?]+$`));

  // Past bashes doesn't say there are none when some are above it.
  await page.goto(`/p/${HUB}/bashes`);
  await expect(page.getByText("None wrapped up yet")).toBeVisible();
  await expect(page.getByText("No bug bashes yet")).toHaveCount(0);
});

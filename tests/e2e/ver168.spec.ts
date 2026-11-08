import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_168: who's on a team is for Admins only. Everyone else gets no Members row and
// one line naming the Admins to ask, on umbrella Settings and on a test cycle's own Settings.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Crew ${TAG}`;
const ids = { group: "", lone: `CL${TAG}`, cycle: `CS${TAG}` };

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const tester = await db.user.findUniqueOrThrow({ where: { email: "tester@example.com" } });
    const team = [
      { userId: admin.id, role: "ADMIN" as const },
      { userId: tester.id, role: "TESTER" as const },
    ];
    const hub = await db.project.create({ data: { key: `CH${TAG}`, name: NAME, members: { create: team } } });
    const group = await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }] } });
    ids.group = group.id;
    // A test cycle that keeps its own members.
    await db.project.create({ data: { key: ids.cycle, name: `${NAME} Web 1`, groupId: group.id, platform: "Web", keepMembersSeparate: true, members: { create: team } } });
    // A test cycle with no umbrella, which has its own Settings page.
    await db.project.create({ data: { key: ids.lone, name: `Lone ${TAG}`, members: { create: team } } });
  } finally {
    await db.$disconnect();
  }
});

test("only Admins see Members; everyone else is told which Admin to ask", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "tester@example.com", "Sam Tester");

  // Umbrella Settings: no Members row, one line naming the Admin.
  await page.goto(`/g/${ids.group}/settings`);
  await expect(page.getByTestId("ask-admin").first()).toHaveText("Need someone added or a role changed? Ask an Admin: Demo Admin.");
  await expect(page.locator("#row-members")).toHaveCount(0);
  await expect(page.getByText("admin@example.com")).toHaveCount(0);

  // The test cycle that keeps its own members: no head count, no list.
  const table = page.getByTestId("cycle-settings");
  await expect(table.getByText(/Its own · \d+ (person|people)/)).toHaveCount(0);
  await expect(table.getByText("Its own", { exact: true }).first()).toBeVisible();

  // Umbrella home: the Invite your team step is for Admins.
  await page.goto(`/g/${ids.group}`);
  await expect(page.getByRole("listitem").filter({ hasText: "Invite your team" })).toHaveCount(0);

  // A test cycle's own Settings page: same line, no list, no Add box.
  await page.goto(`/p/${ids.lone}/settings`);
  await expect(page.getByTestId("ask-admin")).toHaveText("Need someone added or a role changed? Ask an Admin: Demo Admin.");
  await expect(page.getByLabel("Add people by email")).toHaveCount(0);
  await expect(page.getByText("admin@example.com")).toHaveCount(0);
});

test("Admins still manage Members as before", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${ids.group}/settings`);
  await expect(page.locator("#row-members")).toBeVisible();
  await expect(page.locator("#row-members").getByRole("button", { name: "Manage" })).toBeVisible();
  await expect(page.getByTestId("ask-admin")).toHaveCount(0);
  await expect(page.getByTestId("cycle-settings").getByText(/Its own · 2 people/)).toBeVisible();
  await page.goto(`/p/${ids.lone}/settings`);
  await expect(page.getByLabel("Add people by email")).toBeVisible();
  await expect(page.getByTestId("ask-admin")).toHaveCount(0);
});

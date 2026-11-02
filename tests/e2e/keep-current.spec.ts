import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// Keep in Current: a pinned test cycle stays in Current when a newer one for its platform
// comes along. Pin and unpin from ⋯ on the Test cycles page and from the test cycle's Settings.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `KC${TAG}`;
const NAME = `Pins ${TAG}`;
let groupId = "";

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const member = { create: { userId: admin.id, role: "ADMIN" as const } };
    const hub = await db.project.create({ data: { key: HUB, name: NAME, members: member } });
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }] } })).id;
    // Oldest first, so Web RC 1 is the newest Web test cycle.
    const at = (min: number) => new Date(Date.now() - min * 60_000);
    await db.project.create({ data: { key: `KW${TAG}`, name: "Web", groupId, platform: "Web", createdAt: at(30), members: member } });
    await db.project.create({ data: { key: `KB${TAG}`, name: "Build health", groupId, platform: "Web", keepCurrent: true, createdAt: at(20), members: member } });
    await db.project.create({ data: { key: `KR${TAG}`, name: "Web RC 1", groupId, platform: "Web", rcName: "RC 1", createdAt: at(10), members: member } });
  } finally {
    await db.$disconnect();
  }
});

test("a pinned test cycle stays in Current; pin and unpin from ⋯ and Settings", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${groupId}/projects`);

  const current = page.getByTestId("current-cycles");
  const older = page.getByTestId("older-cycles");
  await expect(current.getByTestId(`cycle-row-KR${TAG}`)).toBeVisible();
  await expect(current.getByTestId(`cycle-row-KB${TAG}`)).toContainText("kept in Current");
  await expect(older.getByTestId(`cycle-row-KW${TAG}`)).toBeVisible();

  // Pin Web from its ⋯ menu: it moves up to Current.
  await page.getByRole("button", { name: "More for Web", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: /Keep in Current/ }).click();
  await expect(current.getByTestId(`cycle-row-KW${TAG}`)).toContainText("kept in Current");
  await expect(page.getByRole("heading", { name: "Older test cycles" })).toHaveCount(0);

  // Unpin Build health from its Settings (⋯ › Settings opens its row): it goes to Older, behind Web RC 1.
  await page.getByRole("button", { name: "More for Build health", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${groupId}/settings#cycle-kb${TAG.toLowerCase()}$`));
  const pin = page.getByTestId("keep-current");
  await expect(pin).toBeChecked();
  await pin.click();
  await expect(pin).not.toBeChecked();
  await expect(page.getByText("Moves to Older test cycles when a newer Web test cycle is made.")).toBeVisible();

  // ⋯ › Archive… opens the Archive card with that test cycle ticked.
  await page.goto(`/g/${groupId}/projects`);
  await page.getByRole("button", { name: "More for Web", exact: true }).click();
  await page.getByRole("menuitem", { name: "Archive…" }).click();
  const list = page.getByTestId("archive-card").getByRole("list", { name: "Test cycles to archive" });
  await expect(list.getByRole("checkbox", { name: /^Web(?! RC)/ })).toBeChecked();
  await expect(list.getByRole("checkbox", { checked: true })).toHaveCount(1);
  await page.goto(`/g/${groupId}/projects`);
  await expect(older.getByTestId(`cycle-row-KB${TAG}`)).toBeVisible();
  await expect(current.getByTestId(`cycle-row-KR${TAG}`)).toBeVisible();
});

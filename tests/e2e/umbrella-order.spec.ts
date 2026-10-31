import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// Umbrellas page (ver_79): per-person stars, drag and ⋯ order and a Sort box for
// umbrella cards; one search over umbrellas and their test cycles, archived too;
// and the Archive… card's tick list on a test cycle's Settings.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const names = [`Ord A ${TAG}`, `Ord B ${TAG}`, `Ord C ${TAG}`];

/** An umbrella made straight in the database, with test cycles under it. */
async function umbrella(name: string, hubKey: string, cycles: { key: string; name: string; archived?: boolean }[]) {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: hubKey, name, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const group = await db.projectGroup.create({ data: { name, hubProjectId: hub.id } });
    for (const c of cycles)
      await db.project.create({
        data: { key: c.key, name: c.name, groupId: group.id, archivedAt: c.archived ? new Date() : null, members: { create: { userId: admin.id, role: "ADMIN" } } },
      });
    return group.id;
  } finally {
    await db.$disconnect();
  }
}

const order = async (page: Page) =>
  (await page.getByRole("region", { name: /umbrella$/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))).map((l) => l.replace(/ umbrella$/, "")).filter((n) => n.endsWith(TAG));

test("umbrellas: star, move, drag, sort and search", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await umbrella(names[0], `UA${TAG}`, [{ key: `UAW${TAG}`, name: `${names[0]} Web RC1` }]);
  await umbrella(names[1], `UB${TAG}`, [{ key: `UBW${TAG}`, name: `${names[1]} Web RC9`, archived: true }]);
  await umbrella(names[2], `UC${TAG}`, []);
  await page.goto("/");
  // My order starts A to Z for umbrellas never placed.
  await page.getByLabel("Sort umbrellas").selectOption("mine");
  await expect.poll(() => order(page)).toEqual(names);

  // Star C: it jumps to the top. Move A down with its ⋯ menu.
  await page.getByRole("button", { name: `Star ${names[2]}` }).click();
  await expect.poll(() => order(page)).toEqual([names[2], names[0], names[1]]);
  await page.getByRole("button", { name: `More for ${names[0]}` }).click();
  await page.getByRole("menuitem", { name: "Move down" }).click();
  await expect.poll(() => order(page)).toEqual([names[2], names[1], names[0]]);
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect.poll(() => order(page)).toEqual([names[2], names[1], names[0]]);

  // A to Z sorts, starred still first; dragging switches back to My order.
  await page.getByLabel("Sort umbrellas").selectOption("az");
  await expect.poll(() => order(page)).toEqual([names[2], names[0], names[1]]);
  await page.reload();
  await expect(page.getByLabel("Sort umbrellas")).toHaveValue("az");
  // Playwright's mouse drag doesn't start HTML drag and drop here, so the events are sent directly.
  const dt = await page.evaluateHandle(() => new DataTransfer());
  // Since ver_94 the whole card header is the grip.
  await page.getByRole("region", { name: `${names[0]} umbrella` }).locator('[draggable="true"]').first().dispatchEvent("dragstart", { dataTransfer: dt });
  const target = page.getByRole("region", { name: `${names[1]} umbrella` });
  // Drop on the lower half of B's card (ver_94 drops above or below by where the mouse is).
  const box = (await target.boundingBox())!;
  const clientY = box.y + box.height * 0.75;
  await target.dispatchEvent("dragover", { dataTransfer: dt, clientY });
  await target.dispatchEvent("drop", { dataTransfer: dt, clientY });
  await expect(page.getByLabel("Sort umbrellas")).toHaveValue("mine");
  await expect.poll(() => order(page)).toEqual([names[2], names[1], names[0]]);
  await page.getByRole("button", { name: `Unstar ${names[2]}` }).click();

  // Search finds umbrellas and test cycles inside them, archived ones too.
  await page.getByLabel("Search umbrellas and test cycles").fill(`web ${TAG.toLowerCase()}`);
  const found = page.getByRole("region", { name: "2 matches" });
  await expect(found.getByRole("link", { name: `${names[0]} Web RC1` })).toBeVisible();
  await expect(found.locator("li", { hasText: `${names[1]} Web RC9` })).toContainText("Archived");
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Active" }).click();
  await expect(page.getByRole("region", { name: "1 match" }).getByRole("link")).toHaveText(`${names[0]} Web RC1`);
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Archived" }).click();
  await expect(page.getByRole("region", { name: "1 match" }).getByRole("link")).toHaveText(`${names[1]} Web RC9`);
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "All" }).click();
  await page.getByLabel("Search umbrellas and test cycles").fill(TAG);
  await expect(page.getByRole("region", { name: "5 matches" }).getByRole("link", { name: names[2], exact: true })).toBeVisible();
});

test("archive several test cycles from one test cycle's Settings", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  const name = `Tick ${TAG}`;
  await umbrella(name, `TK${TAG}`, [
    { key: `TK1${TAG}`, name: `${name} Web RC1` },
    { key: `TK2${TAG}`, name: `${name} Web RC2` },
    { key: `TK3${TAG}`, name: `${name} Web RC3` },
  ]);
  // ver_117: a test cycle's settings are its row in the umbrella's Settings; ⋯ → Archive… opens the card with it ticked.
  await page.goto(`/p/TK1${TAG}/settings`);
  await page.getByTestId("cycle-settings").getByRole("button", { name: "More for Web RC1" }).click();
  await page.getByRole("menuitem", { name: "Archive…" }).click();
  const card = page.getByTestId("archive-card");
  await expect(card.getByRole("radio", { name: "Test cycles" })).toHaveAttribute("aria-checked", "true");
  const list = card.getByRole("list", { name: "Test cycles to archive" });
  await expect(list.getByRole("checkbox", { name: new RegExp(`${name} Web RC1`) })).toBeChecked();
  await list.getByRole("checkbox", { name: new RegExp(`${name} Web RC2`) }).check();
  await card.getByRole("button", { name: "Archive 2 test cycles" }).click();
  await card.getByRole("button", { name: "Yes, archive 2" }).click();
  await expect(card.getByRole("button", { name: "Yes, archive 2" })).toHaveCount(0);
  const db = new PrismaClient();
  try {
    const rows = await db.project.findMany({ where: { name: { startsWith: `${name} ` } }, select: { name: true, archivedAt: true }, orderBy: { name: "asc" } });
    expect(rows.map((r) => [r.name.slice(-3), !!r.archivedAt])).toEqual([
      ["RC1", true],
      ["RC2", true],
      ["RC3", false],
    ]);
    expect((await db.projectGroup.findFirstOrThrow({ where: { name } })).archivedAt).toBeNull();
  } finally {
    await db.$disconnect();
  }
});

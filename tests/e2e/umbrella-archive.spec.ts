import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Arch ${TAG}`;
const HUB = `A${TAG}`;

test("admins archive an umbrella with its projects, and restoring brings back only those", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Product name").fill(NAME);
  await dialog.getByLabel("Key").fill(HUB);
  await dialog.getByLabel("Release", { exact: true }).fill("RC1");
  await dialog.getByLabel("Platform 1").fill("Web");
  await dialog.getByRole("button", { name: "＋ Add a platform" }).click();
  await dialog.getByLabel("Platform 2").fill("Unity");
  await dialog.getByRole("button", { name: `Make ${NAME} with 2 new test cycles` }).click();
  await expect(page).toHaveURL(/\/g\//);
  const home = page.url();

  // One project was archived on its own before, and a lead joins the umbrella's team.
  const db = new PrismaClient();
  try {
    await db.project.updateMany({ where: { name: `${NAME} Unity RC1` }, data: { archivedAt: new Date() } });
    const hub = await db.project.findUniqueOrThrow({ where: { key: HUB } });
    const lead = await db.user.findUniqueOrThrow({ where: { email: "lead@example.com" } });
    await db.projectMember.upsert({ where: { projectId_userId: { projectId: hub.id, userId: lead.id } }, create: { projectId: hub.id, userId: lead.id, role: "LEAD" }, update: { role: "LEAD" } });
  } finally {
    await db.$disconnect();
  }

  // Archive from the Archive… card: the whole umbrella lists the test cycle still in use, trimmed.
  await page.goto(`${home}/settings`);
  const archive = page.getByTestId("archive-card");
  await archive.getByRole("button", { name: "Archive…" }).click();
  await archive.getByRole("radio", { name: `The whole ${NAME} umbrella` }).click();
  const going = archive.getByRole("list", { name: "Goes with it" });
  await expect(going.getByText("Web RC1", { exact: true })).toHaveAttribute("title", `${NAME} Web RC1`);
  await expect(going.getByText("Unity RC1")).toHaveCount(0);
  await archive.getByRole("button", { name: "Archive umbrella…" }).click();
  await expect(archive.getByText(`Archive ${NAME} and its 1 test cycle?`)).toBeVisible();
  await archive.getByRole("button", { name: "Yes, archive" }).click();
  await expect(page.getByText(`${NAME} is archived, with its test cycles.`)).toBeVisible();
  await expect(archive.getByRole("button", { name: "Restore…" })).toBeVisible();

  // Its projects say so, and nothing new can be added while it's archived.
  await page.goto(home);
  await expect(page.getByRole("button", { name: /Add test cycle/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Start next release/ })).toHaveCount(0);

  // On the Umbrellas page it's tucked into the one Archived fold.
  await page.goto("/");
  await expect(page.getByRole("region", { name: `${NAME} umbrella` })).toBeHidden();
  await page.getByText(/^▸ Archived \(\d+\)/).click();
  const card = page.getByRole("region", { name: `${NAME} umbrella` });
  await expect(card.getByText("Archived", { exact: true })).toBeVisible();

  // Restore from the card, confirmed in place: the Web project comes back, the one archived on its own stays archived.
  await card.getByRole("button", { name: "Restore…" }).click();
  await expect(card.getByText(`Restore ${NAME} and its 1 test cycle?`)).toBeVisible();
  await card.getByRole("button", { name: "Yes, restore" }).click();
  await expect(page.getByRole("region", { name: `${NAME} umbrella` }).getByText("Archived", { exact: true })).toHaveCount(0);
  const check = new PrismaClient();
  try {
    const rows = await check.project.findMany({ where: { name: { startsWith: NAME } }, select: { name: true, archivedAt: true } });
    expect(rows.find((r) => r.name.endsWith("Web RC1"))?.archivedAt).toBeNull();
    expect(rows.find((r) => r.name.endsWith("Unity RC1"))?.archivedAt).not.toBeNull();
    expect((await check.projectGroup.findFirstOrThrow({ where: { name: NAME } })).archivedAt).toBeNull();
  } finally {
    await check.$disconnect();
  }

  // Leads never see the card.
  await page.context().clearCookies();
  await signIn(page, "lead@example.com", "Demo Lead");
  await page.goto(`${home}/settings`);
  await expect(page.getByRole("heading", { name: `${NAME} settings` })).toBeVisible();
  await expect(page.getByTestId("archive-card")).toHaveCount(0);
});

import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_140: crown notes stop piling up. Keeper of Words is one crown for the whole team (the
// Glossary is one list), a crown note only shows inside its own umbrella, and every note
// closes itself after 10 seconds.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const WORDER = `worder-${TAG.toLowerCase()}@example.com`;
const RULER = `ruler-${TAG.toLowerCase()}@example.com`;
const KEY1 = `CA${TAG}`;
const KEY2 = `CB${TAG}`;
const KEY3 = `CC${TAG}`;
let group1 = "";
let group2 = "";

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const game = { gameEnabled: true, gameTitle: "rookie", whatsNewSeen: 999 };
    const worder = await db.user.create({ data: { email: WORDER, name: `Wren ${TAG}`, ...game } });
    const ruler = await db.user.create({ data: { email: RULER, name: `Rory ${TAG}`, ...game } });
    // Three umbrellas, both people in all of them.
    const groups = [];
    for (const key of [KEY1, KEY2, KEY3]) {
      const hub = await db.project.create({
        data: { key, name: `Crowns ${key}`, caseSeq: 0, members: { create: [{ userId: worder.id, role: "ADMIN" }, { userId: ruler.id, role: "ADMIN" }] } },
      });
      groups.push(await db.projectGroup.create({ data: { name: `Umbrella ${key}`, hubProjectId: hub.id, projects: { connect: { id: hub.id } } } }));
    }
    group1 = groups[0].id;
    group2 = groups[1].id;
    // Start from nobody holding Keeper of Words, so three terms are enough to take it.
    await db.crown.deleteMany({ where: { key: "words" } });
    // Rory took a crown in umbrella 1 and another in umbrella 2, and hasn't been told yet.
    await db.crown.createMany({
      data: [
        { groupId: group1, key: "bash", label: "Bug Bash Champion", userId: ruler.id, counts: { [ruler.id]: 4 } },
        { groupId: group2, key: "sharp", label: "Sharp Eye", userId: ruler.id, counts: { [ruler.id]: 5 } },
      ],
    });
  } finally {
    await db.$disconnect();
  }
});

test.afterAll(async () => {
  const db = new PrismaClient();
  try {
    await db.glossaryTerm.deleteMany({ where: { term: { contains: TAG } } });
    await db.crown.deleteMany({ where: { groupId: { in: [group1, group2] } } });
    await db.crown.deleteMany({ where: { key: "words" } });
  } finally {
    await db.$disconnect();
  }
});

const notes = (page: Page) => page.getByTestId("crown-note");

test("three Glossary terms make you Keeper of Words once, for the whole team", async ({ page }) => {
  await signIn(page, WORDER, `Wren ${TAG}`);
  await page.goto(`/p/${KEY1}/glossary`);
  for (const word of ["Alpha", "Bravo", "Charlie"]) {
    await page.getByRole("button", { name: "+ Add a term" }).click();
    const box = page.getByRole("dialog", { name: "Add a term" });
    await box.getByLabel("Term", { exact: true }).fill(`${word}${TAG}`);
    await box.getByLabel("What it means").fill(`The ${word.toLowerCase()} panel that lists every open order for the team.`);
    await box.getByRole("button", { name: "Add term" }).click();
    await expect(box).toBeHidden();
  }
  await page.reload();
  await expect(notes(page)).toHaveCount(1);
  await expect(notes(page)).toContainText("You're now Keeper of Words for the whole team.");
  await expect(page.getByTestId("glossary-crown")).toContainText("You · 3 terms");
  // Seen once: it doesn't come back in another umbrella.
  await page.goto(`/p/${KEY3}`);
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(notes(page)).toHaveCount(0);
});

test("crown notes show only in their umbrella, and close after 10 seconds", async ({ page }) => {
  await signIn(page, RULER, `Rory ${TAG}`);
  // Outside any umbrella: nothing.
  await page.goto("/");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(notes(page)).toHaveCount(0);
  // In umbrella 1: only umbrella 1's crown.
  await page.goto(`/p/${KEY1}`);
  await expect(notes(page)).toHaveCount(1);
  await expect(notes(page)).toContainText(`You're now Bug Bash Champion in Umbrella ${KEY1}.`);
  // Pointing at it holds it open past 10 seconds.
  await notes(page).hover();
  await page.waitForTimeout(11_000);
  await expect(notes(page)).toHaveCount(1);
  // Moving away lets it close on its own.
  await page.mouse.move(0, 0);
  await expect(notes(page)).toHaveCount(0, { timeout: 13_000 });
  // Umbrella 2's crown waited for umbrella 2.
  await page.goto(`/g/${group2}`);
  await expect(notes(page)).toHaveCount(1);
  await expect(notes(page)).toContainText(`You're now Sharp Eye in Umbrella ${KEY2}.`);
  await notes(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(notes(page)).toHaveCount(0);
  // Both were seen, so neither shows again.
  await page.goto(`/p/${KEY1}`);
  await page.goto(`/p/${KEY2}`);
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(notes(page)).toHaveCount(0);
});

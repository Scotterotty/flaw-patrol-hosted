import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_153: a bug bash can be scheduled days ahead. It shows as Coming up with its day and time
// on each person's own clock, has Add to calendar, and whoever set it up can change the time or cancel it.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `BS${TAG}`;
const NAME = `Friday bash ${TAG}`;

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: `Bash schedule ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
    const group = await db.projectGroup.create({ data: { name: `Bash schedule ${TAG}`, hubProjectId: hub.id, rolesChosenAt: new Date() } });
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
  } finally {
    await db.$disconnect();
  }
});

/** A date N days from now as the date box wants it, on the Pacific clock. */
const dayAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

test("schedule a bug bash days ahead, add it to a calendar, move it, and cancel it", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ timezoneId: "America/Los_Angeles", acceptDownloads: true, viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/bashes`);
  await page
    .getByRole("button", { name: /Start a bug bash/ })
    .first()
    .click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Name").fill(NAME);
  await box.getByLabel("Add an area").fill("Checkout");
  await box.getByLabel("Add an area").press("Enter");

  // When? Now is the default; picking a date shows the boxes, and a past time is refused.
  const when = box.getByTestId("bash-when");
  await expect(when.getByRole("button", { name: "Now" })).toHaveAttribute("aria-pressed", "true");
  await when.getByRole("button", { name: "Pick a date and time" }).click();
  await when.getByLabel("Start date").fill(dayAhead(-1));
  await when.getByLabel("Start time").fill("10:00");
  await box.getByRole("button", { name: "Schedule bug bash" }).click();
  await expect(box).toContainText("That time has already passed");
  await when.getByLabel("Start date").fill(dayAhead(3));
  await box.getByRole("button", { name: "Schedule bug bash" }).click();
  await expect(box.getByRole("heading", { name: /Your bash is scheduled for .* at 10:00 AM PST\. Invite people\./ })).toBeVisible();

  // Add to calendar: an invite in UTC with the Join link.
  const download = page.waitForEvent("download");
  await box.getByTestId("bash-add-calendar").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`bug-bash-friday-bash-${TAG.toLowerCase()}.ics`);
  const ics = readFileSync((await file.path())!, "utf8").replace(/\r\n /g, "");
  const db = new PrismaClient();
  const bash = await db.bugBash.findFirstOrThrow({ where: { name: NAME } });
  const utc = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  expect(ics).toContain(`DTSTART:${utc(bash.startsAt)}`);
  expect(ics).toContain(`/p/${HUB}/bashes/${bash.id}?join=1`);
  await box.getByTestId("bash-invite").getByRole("button", { name: "Close" }).click();

  // The Bug bashes page: Coming up, the day and time, and a countdown in days.
  const card = page.getByTestId("live-bash").filter({ hasText: NAME });
  await expect(card).toContainText("Coming up");
  await expect(card.getByTestId("bash-when-line")).toContainText("10:00 AM PST");
  await expect(card).toContainText(/Starts in [23] days/);

  // Change time: a past one is refused, then 11:00 sticks.
  await card.getByRole("button", { name: "Change time" }).click();
  const move = card.getByTestId("bash-move");
  await move.getByLabel("Start date").fill(dayAhead(-1));
  await move.getByRole("button", { name: "Save time" }).click();
  await expect(move).toContainText("That time has already passed");
  await move.getByLabel("Start date").fill(dayAhead(3));
  await move.getByLabel("Start time").fill("11:00");
  await move.getByRole("button", { name: "Save time" }).click();
  await expect(card.getByTestId("bash-when-line")).toContainText("11:00 AM PST");
  const moved = await db.bugBash.findUniqueOrThrow({ where: { id: bash.id } });
  expect(moved.endsAt.getTime() - moved.startsAt.getTime()).toBe(bash.endsAt.getTime() - bash.startsAt.getTime());

  // The bash's own page says when, and logging waits.
  await page.goto(`/p/${HUB}/bashes/${bash.id}`);
  await expect(page.locator("main")).toContainText("11:00 AM PST, set up by Demo Admin");
  await expect(page.getByTestId("bash-add-calendar")).toBeVisible();

  // A teammate in London sees the same moment on their clock.
  const uk = await browser.newContext({ timezoneId: "Europe/London", viewport: { width: 1366, height: 900 } });
  const ukPage = await uk.newPage();
  await signIn(ukPage, "admin@example.com", "Demo Admin");
  await ukPage.goto(`/p/${HUB}/bashes`);
  await expect(ukPage.getByTestId("live-bash").filter({ hasText: NAME }).getByTestId("bash-when-line")).toContainText(
    moved.startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Europe/London", timeZoneName: "short" }),
  );
  await uk.close();

  // Cancel: asks first, then it's gone along with its empty run.
  await page.goto(`/p/${HUB}/bashes`);
  await card.getByRole("button", { name: "Cancel bash" }).click();
  await card.getByRole("button", { name: "Keep it" }).click();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Cancel bash" }).click();
  await card.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect(page.getByTestId("live-bash").filter({ hasText: NAME })).toHaveCount(0);
  expect(await db.bugBash.count({ where: { id: bash.id } })).toBe(0);
  expect(await db.testRun.count({ where: { id: bash.runId! } })).toBe(0);
  await db.$disconnect();
  await ctx.close();
});

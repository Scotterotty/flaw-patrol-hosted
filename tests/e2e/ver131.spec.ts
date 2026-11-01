import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { makeTrendsUmbrella } from "./trends-umbrella";

// ver_131: How testing is going on an umbrella's home. Manual and automated apart, Last 6
// releases by default with a menu for more, Hide folds it to one line, both saved per person.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const SHOTS = process.env.FP_SHOTS;

const resetLead = async () => {
  // Put the lead's own choices back, so each test (and other specs) see the box open with six.
  const db = new PrismaClient();
  try {
    const lead = await db.user.findUniqueOrThrow({ where: { email: "lead@example.com" }, select: { id: true, openCards: true } });
    await db.user.update({ where: { id: lead.id }, data: { openCards: lead.openCards.filter((w) => !w.startsWith("trends:")) } });
  } finally {
    await db.$disconnect();
  }
};
test.beforeEach(resetLead);
test.afterAll(resetLead);

test("How testing is going shows manual and automated apart, picks how many, and hides", async ({ page }) => {
  test.setTimeout(180_000);
  const id = await makeTrendsUmbrella(TAG);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await signIn(page, "lead@example.com", "Demo Lead");
  await page.goto(`/g/${id}`);
  const box = page.getByTestId("home-trends");
  await expect(box.getByRole("heading", { name: "How testing is going" })).toBeVisible();

  // Tiles: the newest release, manual and automated on their own.
  await expect(box.getByTestId("trends-tile-man")).toContainText("✋ Manual pass rate, RC 8");
  // RC 8 manual: 12 cases, case 3 passes on even... RC 8 fails case 3 and case 4 on both platforms: 8 of 12.
  await expect(box.getByTestId("trends-tile-man")).toContainText("67%");
  await expect(box.getByTestId("trends-tile-auto")).toContainText("🤖 Automated pass rate, RC 8");
  await expect(box.getByTestId("trends-tile-cases")).toContainText("12");
  await expect(box.getByTestId("trends-tile-bugs")).toContainText("1 critical");

  // Six releases by default: RC 3 to RC 8 on the chart.
  const chart = box.getByTestId("trends-chart");
  await expect(box.getByTestId("trends-point")).toHaveCount(6);
  await expect(chart).toContainText("RC 8");
  await expect(chart).not.toContainText("RC 2");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/trends-open.png`, fullPage: true });

  // Hover shows both rates for that release.
  await box.getByTestId("trends-point").last().hover();
  await expect(box.getByTestId("trends-tip")).toContainText("✋ Manual");
  await expect(box.getByTestId("trends-tip")).toContainText("🤖 Automated");

  // Each platform: one line per platform, manual or automated picked, never mixed.
  await box.getByRole("button", { name: "Each platform" }).click();
  await expect(box.getByRole("button", { name: "🤖 Automated" })).toBeVisible();
  await expect(chart).toContainText("Unity");
  await expect(chart).toContainText("Web");
  await box.getByRole("button", { name: "🤖 Automated" }).click();
  await expect(box.getByText("🤖 Automated results only")).toBeVisible();
  if (SHOTS) await box.screenshot({ path: `${SHOTS}/trends-platforms.png` });

  // The lists: case 3 flips, case 4 keeps failing.
  await expect(box.getByTestId("trends-list-flaky")).toContainText("Voice chat reconnects");
  await box.getByRole("tab", { name: /Keeps failing/ }).click();
  await expect(box.getByTestId("trends-list-failing")).toContainText("Upload a thumbnail");
  await expect(box.getByTestId("trends-list-failing")).toContainText("Failed 12 in a row");

  // More releases, remembered after a reload.
  await box.getByTestId("trends-count").selectOption({ label: "All releases" });
  await expect(box.getByTestId("trends-point")).toHaveCount(8);
  // By week works too.
  await box.getByRole("button", { name: "By week" }).click();
  await expect(box.getByTestId("trends-tile-man")).toContainText("this week");

  // Hide folds it to one line that still shows both pass rates.
  await box.getByTestId("trends-fold").click();
  await expect(box.getByTestId("trends-fold")).toHaveText(/Show/);
  await expect(box.getByTestId("trends-chart")).toHaveCount(0);
  await expect(box.getByTestId("trends-summary")).toContainText("✋ Manual");
  await expect(box.getByTestId("trends-summary")).toContainText("🤖 Automated");
  if (SHOTS) await box.screenshot({ path: `${SHOTS}/trends-hidden.png` });

  // Both choices are saved on the account, so they stay after a reload.
  await expect
    .poll(async () => {
      const db = new PrismaClient();
      try {
        return (await db.user.findUniqueOrThrow({ where: { email: "lead@example.com" }, select: { openCards: true } })).openCards.filter((w) => w.startsWith("trends:")).sort();
      } finally {
        await db.$disconnect();
      }
    })
    .toEqual(["trends:all", "trends:hidden"]);
  await page.reload();
  await expect(box.getByTestId("trends-fold")).toHaveText(/Show/);
  await box.getByTestId("trends-fold").click();
  await expect(box.getByTestId("trends-count")).toHaveValue("0");
});

test("a new umbrella with no results says so", async ({ page }) => {
  const db = new PrismaClient();
  let id = "";
  try {
    const lead = await db.user.findUniqueOrThrow({ where: { email: "lead@example.com" } });
    const hub = await db.project.create({ data: { key: `TE${TAG}`, name: `Empty trends ${TAG}`, members: { create: [{ userId: lead.id, role: "ADMIN" }] } } });
    id = (await db.projectGroup.create({ data: { name: `Empty trends ${TAG}`, hubProjectId: hub.id } })).id;
    await db.project.update({ where: { id: hub.id }, data: { groupId: id } });
  } finally {
    await db.$disconnect();
  }
  await signIn(page, "lead@example.com", "Demo Lead");
  await page.goto(`/g/${id}`);
  const box = page.getByTestId("home-trends");
  await expect(box.getByText("No finished runs yet")).toBeVisible();
  await expect(box.getByTestId("trends-count")).toHaveCount(0);
});

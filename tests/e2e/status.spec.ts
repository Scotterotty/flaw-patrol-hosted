import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_228: the Status page. An Admin connects TeamCity (read-only) against a stand-in
// server (mock-teamcity.mjs), and Status shows the failed nightly build first, the passing
// one under All good, a red number in the left menu and one line on Overview.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `ST${TAG}`;
const NAME = `Status ${TAG}`;
const TC = "http://localhost:3191";

let groupId = "";

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: NAME, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Windows", suiteIds: [] }] } })).id;
    await db.project.create({ data: { key: `SW${TAG}`, name: `${NAME} Windows RC 23`, groupId, platform: "Windows", rcName: "RC 23", members: { create: { userId: admin.id, role: "ADMIN" } } } });
  } finally {
    await db.$disconnect();
  }
});

test("connect TeamCity, see what needs a look on Status, and write a bug from a card", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  const menuStatus = page.locator('[data-howto="menu-status"]').filter({ visible: true });

  // Nothing connected yet: Status is in the menu anyway, and says what it's for.
  await page.goto(`/g/${groupId}`);
  await expect(menuStatus).toBeVisible();
  await expect(page.getByTestId("overview-status")).toHaveCount(0);
  await menuStatus.click();
  await expect(page.getByRole("heading", { level: 1, name: "Status" })).toBeVisible();
  await expect(page.getByTestId("status-empty")).toContainText("Nothing is connected yet.");
  await page.getByTestId("status-empty").getByRole("link", { name: "Connect TeamCity" }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${groupId}/settings#teamcity$`));

  // Settings → TeamCity: a wrong token is turned down; the right one lists the builds.
  const row = page.locator("#row-teamcity");
  if (!(await row.getByLabel("Server address", { exact: true }).isVisible())) await row.getByRole("button", { name: "Connect", exact: true }).click();
  await row.getByLabel("Server address", { exact: true }).fill(TC);
  await row.getByLabel("Access token", { exact: true }).fill("tc_wrong");
  await row.getByRole("button", { name: "Check and load builds" }).click();
  await expect(row.getByText("TeamCity turned down the access token")).toBeVisible();
  await row.getByLabel("Access token", { exact: true }).fill("tc_good");
  await row.getByRole("button", { name: "Check and load builds" }).click();
  await row.getByLabel(/Nightly Windows/).check();
  await row.getByLabel(/Android build/).check();
  await expect(row.getByText("Builds to watch (2 picked)")).toBeVisible();
  await row.getByRole("button", { name: "Save and connect" }).click();
  await expect(row.getByText("✓ Saved. Watching 2 builds on Status.")).toBeVisible();

  // The token never goes back to the browser.
  await page.reload();
  expect(await page.content()).not.toContain("tc_good");

  // Status: the failed nightly first, in plain words, with no one's name; Android under All good.
  await menuStatus.click();
  await expect(page.getByTestId("status-summary")).toHaveText("1 thing needs a look");
  const nightly = page.getByTestId("status-card-tc:Shop_NightlyWindows");
  await expect(nightly.getByRole("heading", { name: "TeamCity · Nightly Windows" })).toBeVisible();
  await expect(nightly.getByText("Failed", { exact: true })).toBeVisible();
  await expect(nightly).toContainText("Build 812 failed: Tests failed: 14 (2 new), passed: 310.");
  await expect(nightly).not.toContainText("Pat");
  await expect(nightly).toContainText("main");
  await expect(nightly.getByRole("img", { name: /Last 5 builds, newest on the right: passed, passed, passed, failed, failed/ })).toBeVisible();
  await expect(nightly.getByRole("link", { name: "Open in TeamCity ↗" })).toHaveAttribute("href", `${TC}/buildConfiguration/Shop_NightlyWindows/812`);
  const android = page.getByTestId("status-card-tc:Shop_Android");
  await expect(android).toContainText("TeamCity · Android build");
  await expect(android.getByText("Passed", { exact: true })).toBeVisible();
  await expect(page.getByTestId("status-checked")).toContainText("Checked just now");
  await page.getByTestId("status-refresh").click();
  await expect(page.getByTestId("status-summary")).toHaveText("1 thing needs a look");

  // Overview has one line, and the menu a red 1.
  await page.goto(`/g/${groupId}`);
  await expect(page.getByTestId("overview-status")).toContainText("1 thing needs a look");
  await expect(menuStatus.getByTestId("menu-alert")).toHaveText(/^1/);
  await page.getByTestId("overview-status").getByRole("link", { name: "Open Status" }).click();

  // Write a bug: the same form as everywhere, with the build and link filled in, all editable.
  await page.getByTestId("status-card-tc:Shop_NightlyWindows").getByRole("link", { name: "Write a bug" }).click();
  const box = page.getByRole("dialog", { name: "Write a bug" });
  await expect(box.getByLabel("Summary")).toHaveValue("Nightly Windows failed (build 812)");
  await expect.poll(() => box.locator("textarea").evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value).join("\n"))).toContain("Build 812 failed");
  await box.getByLabel("Summary").fill("Nightly Windows: 14 tests failed");
  await expect(box.getByLabel("Summary")).toHaveValue("Nightly Windows: 14 tests failed");

  // Old Repositories links land on Status.
  await page.goto(`/g/${groupId}/repos`);
  await expect(page).toHaveURL(new RegExp(`/g/${groupId}/status$`));
});

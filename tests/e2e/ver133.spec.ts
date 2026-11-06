import { PrismaClient } from "@prisma/client";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_133: automation results without a release. Step 2 of Upload automation results (and
// Pull from GitHub) is Where they go: + New test cycle makes a place right there, an RC test
// cycle's release is only counted when ticked, the fields line up, runs with no release say so,
// and How testing is going gets By build.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `NR${TAG}`;
const CYCLE = `NW${TAG}`;
const NAME = `Shop ${TAG}`;
let groupId = "";

const xml = (fail: boolean) => `<?xml version="1.0"?><testsuites><testsuite name="checkout" tests="2">
  <testcase classname="checkout.PayTest" name="pays_by_card" time="1.2"/>
  <testcase classname="checkout.CartTest" name="adds_an_item" time="0.4">${fail ? '<failure message="nope">boom</failure>' : ""}</testcase>
</testsuite></testsuites>`;

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: NAME, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }] } })).id;
    await db.project.create({ data: { key: CYCLE, name: `${NAME} Web RC 4`, groupId, platform: "Web", rcName: "RC 4", members: { create: { userId: admin.id, role: "ADMIN" } } } });
  } finally {
    await db.$disconnect();
  }
});

async function upload(page: Page, fail: boolean) {
  await page.goto(`/g/${groupId}/runs`);
  await page.getByRole("button", { name: "Bring in results" }).click();
  await page.getByRole("menuitem", { name: /Automated test results/ }).click();
  const box = page.getByRole("dialog", { name: "Upload automation results" });
  await box.getByLabel("Results files").setInputFiles({ name: "results.xml", mimeType: "text/xml", buffer: Buffer.from(xml(fail)) });
  await expect(box.getByText("2. Where they go")).toBeVisible();
  return box;
}

const left = async (l: Locator) => (await l.boundingBox())!.x;
const right = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return b.x + b.width;
};

test("automated results go in a new test cycle with no release, and show By build", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");

  // The only test cycle is picked; its release is off until ticked.
  let box = await upload(page, false);
  await expect(box.getByLabel(`${NAME} Web RC 4`)).toBeChecked();
  await expect(box.getByLabel("Count these toward release RC 4")).not.toBeChecked();

  // + New test cycle: named Build health, no platform, no release.
  await box.getByLabel("+ New test cycle").check();
  await expect(box.getByLabel("Count these toward release RC 4")).toHaveCount(0);
  await expect(box.getByLabel("Name", { exact: true })).toHaveValue("Build health");
  await expect(box.getByLabel("Platform (optional)")).toHaveValue("");
  await expect(box.getByLabel("Count these toward a release")).not.toBeChecked();

  // Every field lines up on the same two columns, in and out of the box.
  const name = box.getByLabel("Name", { exact: true });
  const platform = box.getByLabel("Platform (optional)");
  const build = box.getByLabel("Version", { exact: true });
  const runName = box.getByLabel("Run name");
  expect(Math.abs((await left(name)) - (await left(build)))).toBeLessThan(1);
  expect(Math.abs((await left(platform)) - (await left(runName)))).toBeLessThan(1);
  expect(Math.abs((await right(name)) - (await right(build)))).toBeLessThan(1);
  expect(Math.abs((await right(platform)) - (await right(runName)))).toBeLessThan(1);
  await box.getByRole("button", { name: "▸ More: environment" }).click();
  expect(Math.abs((await left(box.getByLabel("Environment"))) - (await left(build)))).toBeLessThan(1);
  expect(Math.abs((await right(box.getByLabel("Environment"))) - (await right(build)))).toBeLessThan(1);

  await box.getByRole("button", { name: "Next: check results" }).click();
  await expect(box.getByText("2 tests on Build health")).toBeVisible();
  await expect(box.getByText("· no release")).toBeVisible();
  await box.getByRole("button", { name: "Save 2 results" }).click();
  await expect(page).toHaveURL(/\/p\/NR[A-Z0-9]*BH\/runs\/1$/);

  const db = new PrismaClient();
  try {
    const made = await db.project.findFirstOrThrow({ where: { groupId, name: "Build health" }, include: { runs: true } });
    expect(made.key).toBe(`${HUB}BH`.slice(0, 10));
    expect(made.rcName).toBe("");
    // Made for automation, so it starts pinned with Keep in Current.
    expect(made.keepCurrent).toBe(true);
    expect(made.runs.map((r) => r.release)).toEqual([""]);
  } finally {
    await db.$disconnect();
  }

  // Into the RC test cycle with the release ticked: that run counts toward RC 4.
  box = await upload(page, true);
  await box.getByLabel(`${NAME} Web RC 4`).check();
  await box.getByLabel("Count these toward release RC 4").check();
  await box.getByRole("button", { name: "Next: check results" }).click();
  await expect(box.getByText("· counts toward release RC 4")).toBeVisible();
  await box.getByRole("button", { name: "Save 2 results" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${CYCLE}/runs/1$`));

  // Test runs: only the run with no release says so.
  await page.goto(`/g/${groupId}/runs?state=automated`);
  await expect(page.getByTestId("no-release")).toHaveCount(1);

  // How testing is going: By build has one bar per automated run, the newest one failed.
  await page.goto(`/g/${groupId}`);
  // Only the box you can see: it streams in, with a hidden copy for a moment (see ver131.spec).
  const trends = page.getByTestId("home-trends").filter({ visible: true });
  await trends.getByRole("button", { name: "By run" }).click();
  await expect(trends.getByTestId("build-bar")).toHaveCount(2);
  await expect(trends.getByTestId("build-health")).toContainText("1 of 2 passed");
  await expect(trends.getByTestId("build-health")).toContainText("Last 2 builds: 1 all passed, 1 had failures");
  await trends.getByTestId("build-bar").first().click();
  await expect(page).toHaveURL(/\/p\/NR[A-Z0-9]*BH\/runs\/1$/);
});

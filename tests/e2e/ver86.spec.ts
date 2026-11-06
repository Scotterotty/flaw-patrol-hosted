import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject, openReleaseBox } from "./projects";

// ver_86 (full test findings #14, #15, #22 and the Platforms move): Release status adds up a
// client's runs in one column, automation upload suggests same-title cases and files new
// ones under readable folders, a suite's Last result counts any run, and platforms are
// added and changed where they're used (Add test cycle, Start next release) instead of Settings.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();

async function newCase(page: Page, key: string, title: string) {
  await page.goto(`/p/${key}/cases/new`);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Step 1 action").fill("Do it");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("Release status, automation suggestions and a suite's last result from any run", async ({ page }) => {
  test.setTimeout(240_000);
  const KEY = `V${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Shop ${TAG}`, KEY);
  await newCase(page, KEY, "Pay with card");
  await newCase(page, KEY, "Sign in with email");

  // A suite with both cases, and two Web runs of RC9 that aren't from the suite: one passed both.
  const db = new PrismaClient();
  try {
    const project = await db.project.findUniqueOrThrow({ where: { key: KEY } });
    const cases = await db.testCase.findMany({ where: { projectId: project.id }, orderBy: { number: "asc" } });
    await db.testSuite.create({ data: { projectId: project.id, name: "Smoke", cases: { create: cases.map((c, i) => ({ caseId: c.id, position: i })) } } });
    const entry = (c: (typeof cases)[number], i: number, done: boolean) => ({
      caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: c.priority, steps: [],
      status: done ? ("PASSED" as const) : ("UNTESTED" as const), lastTestedAt: done ? new Date() : null,
    });
    await db.testRun.create({ data: { projectId: project.id, number: 1, name: "Full library Web", release: "RC9", entries: { create: cases.map((c, i) => entry(c, i, true)) } } });
    await db.testRun.create({ data: { projectId: project.id, number: 2, name: "Explore checkout Web", release: "RC9", entries: { create: [entry(cases[0], 0, false)] } } });
    await db.project.update({ where: { id: project.id }, data: { runSeq: 2 } });
  } finally {
    await db.$disconnect();
  }

  // #14: one Web column adding up both runs, with their names under it.
  await page.goto(`/p/${KEY}/reports/rc`);
  await expect(async () => {
    await page.getByLabel("Release", { exact: true }).selectOption({ label: "RC9" });
    await expect(page.getByRole("heading", { name: "RC9 TESTING STATUS" })).toBeVisible({ timeout: 2000 });
  }).toPass();
  await expect(page.getByRole("region", { name: "Web" })).toHaveCount(1);
  const web = page.getByRole("region", { name: "Web" });
  await expect(web).toContainText("2 of 3 cases run");
  await expect(web.getByTestId("rc-column-runs")).toHaveText("Full library Web, Explore checkout Web");

  // #22: the Smoke suite shows each case's last result from the library run, named underneath.
  await page.goto(`/p/${KEY}/suites`);
  await page.getByRole("link", { name: "Smoke" }).first().click();
  await expect(page.getByTestId("last-result-run").first()).toContainText(`R1 Full library Web · Shop ${TAG}`);
  await expect(page.getByText("Not run")).toHaveCount(0);

  // #15: a test named like an existing case is suggested; new ones go in a readable folder.
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="checkout" tests="2">
    <testcase classname="checkout.PayTest" name="pay_with_card" time="1.2"/>
    <testcase classname="checkout.CartTest" name="adds_an_item" time="0.4"/>
  </testsuite></testsuites>`;
  await page.goto(`/p/${KEY}/runs`);
  await page.getByRole("button", { name: "Bring in results" }).click();
  await page.getByRole("menuitem", { name: /Automated test results/ }).click();
  await page.getByLabel("Results files").setInputFiles({ name: "results.xml", mimeType: "text/xml", buffer: Buffer.from(xml) });
  await page.getByRole("button", { name: "Next: check results" }).click();
  // ver_91: a same-name match is linked by itself, with Undo.
  await expect(page.getByText(/1 linked to existing cases \(we matched them by name/)).toBeVisible();
  await expect(page.getByText("(matched by name)")).toBeVisible();
  await page.getByRole("button", { name: /^Save 2 results$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/runs/3$`));

  const check = new PrismaClient();
  try {
    const project = await check.project.findUniqueOrThrow({ where: { key: KEY } });
    expect(await check.testCase.count({ where: { projectId: project.id, title: "Pay with card" } })).toBe(1);
    const made = await check.testCase.findFirstOrThrow({ where: { projectId: project.id, title: "Adds an item" }, include: { folder: { include: { parent: true } } } });
    expect(made.folder?.name).toBe("Cart");
    expect(made.folder?.parent?.name).toBe("Automation");
  } finally {
    await check.$disconnect();
  }
});

test("platforms are added and changed in Add test cycle and Start next release, not Settings", async ({ page }) => {
  test.setTimeout(300_000);
  const NAME = `North ${TAG}`;
  const HUB = `N${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const make = page.getByRole("dialog");
  await make.getByLabel("Product name").fill(NAME);
  await make.getByLabel("Key").fill(HUB);
  await make.getByTestId("u-more").click();
  await make.getByLabel("Release", { exact: true }).fill("RC4");
  await make.getByLabel("Platform 1").fill("Web");
  await make.getByRole("button", { name: "＋ Add a platform" }).click();
  await make.getByLabel("Platform 2").fill("Unity");
  await make.getByRole("button", { name: `Make ${NAME} with 2 new test cycles` }).click();
  await expect(page).toHaveURL(/\/g\//);
  const home = page.url();
  await newCase(page, HUB, `Log in ${TAG}`);

  const db = new PrismaClient();
  let groupId = "";
  try {
    const hub = await db.project.findUniqueOrThrow({ where: { key: HUB } });
    const c = await db.testCase.findFirstOrThrow({ where: { projectId: hub.id } });
    const smoke = await db.testSuite.create({ data: { projectId: hub.id, name: "Smoke", cases: { create: { caseId: c.id, position: 0 } } } });
    await db.testSuite.create({ data: { projectId: hub.id, name: "Checkout", cases: { create: { caseId: c.id, position: 0 } } } });
    const group = await db.projectGroup.findFirstOrThrow({ where: { name: NAME } });
    groupId = group.id;
    await db.projectGroup.update({ where: { id: group.id }, data: { platforms: [{ name: "Web", suiteIds: [smoke.id] }, { name: "Unity", suiteIds: [] }] } });
  } finally {
    await db.$disconnect();
  }
  const platforms = async () => {
    const d = new PrismaClient();
    try {
      return ((await d.projectGroup.findUniqueOrThrow({ where: { id: groupId } })).platforms as { name: string; suiteIds: string[] }[]).map((p) => `${p.name}:${p.suiteIds.length}`);
    } finally {
      await d.$disconnect();
    }
  };

  // Settings has no Platforms row any more.
  await page.goto(`${home}/settings`);
  await expect(page.getByText("Members").first()).toBeVisible();
  await expect(page.locator("#row-platforms")).toHaveCount(0);

  // Add test cycle: the chips list the platforms; typing a new one adds it to the umbrella.
  // ver_95: Add test cycle lives in umbrella Settings (Create a run makes one too).
  await page.goto(`${home}/settings`);
  await page.getByRole("button", { name: /Add test cycle/ }).first().click();
  await page.getByRole("button", { name: /^New test cycle/ }).click();
  const box = page.getByRole("dialog", { name: `New test cycle in ${NAME}` });
  // ver_99: no platform is picked for you; + New platform adds one to the umbrella.
  await expect(box.getByRole("radio", { name: "Web", exact: true })).toHaveAttribute("aria-checked", "false");
  await box.getByRole("button", { name: "＋ New platform" }).click();
  await expect(box.getByText(`Added to ${NAME}'s platforms`)).toBeVisible();
  await box.getByLabel("New platform name").fill("Switch");
  await box.getByRole("button", { name: "Add platform" }).click();
  await expect(box.getByRole("radio", { name: /Switch/ })).toHaveAttribute("aria-checked", "true");
  await expect(box.getByLabel("Name", { exact: true })).toHaveAttribute("placeholder", `${NAME} Switch`);
  await box.getByLabel("Key").fill(`S${TAG}`);
  await box.getByRole("button", { name: `Create test cycle in ${NAME}` }).click();
  await expect(page).toHaveURL(new RegExp(`/p/S${TAG}`));
  await expect.poll(platforms).toEqual(["Web:1", "Unity:0", "Switch:0"]);

  // Start next release: change Unity's suites, rename Switch, remove it and undo.
  await page.goto(home);
  await openReleaseBox(page);
  const rc = page.getByRole("dialog", { name: "Create a run · Release candidate" });
  const row = (name: string) => rc.getByTestId("platform-row").filter({ hasText: name });
  await expect(row("Unity")).toContainText("No cases picked yet");
  // ver_89: every platform can be ticked; ticking one with no suites opens its dropdown.
  await rc.getByRole("checkbox", { name: "Unity" }).check();
  await row("Unity").getByRole("checkbox", { name: "Checkout" }).check();
  await expect(row("Unity")).toContainText("Checkout · 1 case");
  await expect(row("Unity")).toContainText("What you pick is remembered for Unity's next release.");
  await row("Unity").getByRole("button", { name: "Done" }).click();
  // Remembered when the RC starts, not before.
  await expect.poll(platforms).toEqual(["Web:1", "Unity:0", "Switch:0"]);

  await row("Switch").getByTitle("More for Switch").click();
  await rc.getByRole("button", { name: "Rename platform…" }).click();
  await rc.getByLabel("New name for Switch").fill("Switch 2");
  await rc.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(row("Switch 2")).toBeVisible();
  await expect.poll(platforms).toEqual(["Web:1", "Unity:0", "Switch 2:0"]);

  await row("Switch 2").getByTitle("More for Switch 2").click();
  await rc.getByRole("button", { name: `Remove from ${NAME}` }).click();
  await expect(row("Switch 2")).toContainText(`Removed from ${NAME}'s platforms`);
  await expect.poll(platforms).toEqual(["Web:1", "Unity:0"]);
  await row("Switch 2").getByRole("button", { name: "Undo" }).click();
  await expect(row("Switch 2").getByTitle("More for Switch 2")).toBeVisible();
  await expect.poll(platforms).toEqual(["Web:1", "Unity:0", "Switch 2:0"]);

  // The renamed platform's test cycle kept its name and follows the new platform name.
  const d = new PrismaClient();
  try {
    const cycle = await d.project.findUniqueOrThrow({ where: { key: `S${TAG}` } });
    expect(cycle.platform).toBe("Switch 2");
    expect(cycle.name).toBe(`${NAME} Switch`);
  } finally {
    await d.$disconnect();
  }
});

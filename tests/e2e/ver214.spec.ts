import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_214: clients. A test cycle's Settings gets a Clients list (a demo dry run's Web, Unreal,
// Unity iOS and "Web (remote user)"). Runs started after that run each case once per client it
// covers (guessed from its words), and the run page shows a grid: one row per case, one column per
// client, a card per case on phones. Clicking a client marks it; the runner has a tab per client and
// moves on to the next client, then the next case. Exports get a By client sheet.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `CL${TAG}`;
const EMAIL = `clients-${TAG.toLowerCase()}@example.com`;
const SHOTS = process.env.FP_SHOTS;
const AXE = require.resolve("axe-core/axe.min.js");
const RULES = ["aria-required-attr", "aria-allowed-attr", "label-content-name-mismatch", "heading-order", "target-size", "color-contrast", "button-name", "nested-interactive"];
const CASES = [
  { title: "Log in", text: "User is able to login to all clients on the appropriate environment." },
  { title: "Anchor in AR", text: "Unity iOS - Ensure that the user is able to view the space in AR, and resolve the anchor successfully." },
  { title: "Custom avatar upload", text: "User is able to upload and select a custom avatar on the Web." },
  { title: "Queen Mary splat visible", text: "Validate Gaussian Splat model of Queen Mary is visible on Web and Web Remote." },
];

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const user = await db.user.create({ data: { email: EMAIL, name: "Cleo Clients", whatsNewSeen: 999 } });
    const project = await db.project.create({ data: { key: KEY, name: `Demo Dry Run ${TAG}`, caseSeq: CASES.length, members: { create: [{ userId: user.id, role: "ADMIN" }] }, rolesChosenAt: new Date() } });
    const folder = await db.folder.create({ data: { projectId: project.id, name: "Frida Demo Space" } });
    const ids: string[] = [];
    for (const [i, c] of CASES.entries()) {
      const steps = [{ kind: "step", action: "", expected: c.text }];
      const made = await db.testCase.create({
        data: { projectId: project.id, number: i + 1, folderId: folder.id, title: c.title, versions: { create: { version: 1, title: c.title, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags: [], steps, folderPath: "Frida Demo Space" } } },
      });
      ids.push(made.id);
    }
    await db.testSuite.create({ data: { projectId: project.id, name: "Dry run", cases: { create: ids.map((caseId, position) => ({ caseId, position })) } } });
  } finally {
    await db.$disconnect();
  }
});

/** Axe's checks on the client grid (and any open dialog). */
async function problems(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (rules) => {
    // @ts-expect-error axe is added by the script tag
    const r = await window.axe.run({ include: [["[data-testid='client-grid']"]] }, { runOnly: { type: "rule", values: rules } });
    return r.violations.flatMap((v: { id: string; nodes: { target: string[]; any: { message: string }[] }[] }) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}: ${n.any[0]?.message}`));
  }, RULES);
}

const shot = async (page: Page, name: string) => SHOTS && (await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }));
const cell = (page: Page, title: string, client: string) => page.locator("table").getByRole("button", { name: new RegExp(`^${client.replace(/[()]/g, "\\$&")}\\s*:.*${title}$`) });

test("a dry run tests each case on its clients and shows them in a grid", async ({ page }) => {
  await signIn(page, EMAIL, "Cleo Clients");

  // Settings: add the four clients.
  await page.goto(`/p/${KEY}/settings#clients`);
  const box = page.getByTestId("clients-settings");
  await expect(box.getByText("No clients. Each case runs once, as usual.")).toBeVisible();
  for (const c of ["Web", "Unreal", "Unity iOS", "Web (remote user)"]) {
    await box.getByLabel("New client").fill(c);
    await box.getByRole("button", { name: "Add client" }).click();
  }
  await box.getByRole("button", { name: "Move Unreal up" }).click();
  await box.getByRole("button", { name: "Move Unreal down" }).click();
  await box.getByRole("button", { name: "Save clients" }).click();
  await expect(box.getByRole("status")).toContainText("Runs you start from now on test each case on these clients.");
  await shot(page, "settings");

  // Start a run from the suite.
  const suite = await (async () => {
    const db = new PrismaClient();
    try {
      return (await db.testSuite.findFirstOrThrow({ where: { project: { key: KEY } } })).id;
    } finally {
      await db.$disconnect();
    }
  })();
  await page.goto(`/p/${KEY}/suites/${suite}`);
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);

  // The grid: client columns, guessed clients, gray "Doesn't apply".
  const grid = page.getByTestId("client-grid");
  await expect(grid.locator("thead th")).toHaveText(["Case", "Web", "Unreal", "Unity iOS", "Web (remote user)"]);
  await expect(cell(page, "Log in", "Unreal")).toContainText("Not run");
  await expect(grid.locator("table").getByRole("img", { name: "Web: doesn't apply" })).toHaveCount(1);
  await expect(cell(page, "Anchor in AR", "Unity iOS")).toBeVisible();
  await expect(cell(page, "Queen Mary splat visible", "Web (remote user)")).toBeVisible();
  await expect(cell(page, "Queen Mary splat visible", "Unreal")).toHaveCount(0);
  await expect(grid.locator("table").getByText("User is able to upload and select a custom avatar on the Web.")).toBeVisible();
  expect(await problems(page)).toEqual([]);
  await shot(page, "grid");

  // Click a client to mark it; the box is a real dialog.
  await cell(page, "Log in", "Unreal").click();
  const sheet = page.getByRole("dialog", { name: "Unreal · Log in" });
  await expect(sheet.getByRole("link", { name: "Write a bug for Unreal" })).toBeVisible();
  await shot(page, "sheet");
  await sheet.getByRole("button", { name: "Failed" }).click();
  await expect(sheet).toBeHidden();
  await expect(cell(page, "Log in", "Unreal")).toContainText("Failed");
  for (const c of ["Web", "Unity iOS", "Web (remote user)"]) {
    await cell(page, "Log in", c).click();
    await page.getByRole("dialog").getByRole("button", { name: "Passed" }).click();
    await expect(cell(page, "Log in", c)).toContainText("Passed");
  }
  // Every client marked: the case result is the worst one.
  await page.getByRole("link", { name: "Case list" }).click();
  await expect(page.locator("tbody tr", { hasText: "Log in" })).toContainText("Failed");
  await page.getByRole("link", { name: "By client" }).click();

  // The runner: a tab per client; one tap moves to the next client, then the next case.
  await page.getByRole("link", { name: "Continue testing" }).first().click();
  await expect(page.getByRole("heading", { name: "Anchor in AR" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Clients" }).getByRole("tab")).toHaveText([/Unity iOS/]);
  await shot(page, "runner");
  await page.locator("li[data-step='0']").getByRole("button", { name: /^Passed/ }).click();
  await expect(page.getByRole("heading", { name: "Custom avatar upload" })).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.getByRole("heading", { name: "Queen Mary splat visible" })).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "Clients" }).getByRole("tab");
  await expect(tabs).toHaveText([/^Web/, /Web \(remote user\)/]);
  await page.keyboard.press("p");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  // Failed opens Report bug for that client.
  await page.locator("li[data-step='1']").getByRole("button", { name: /^Failed/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Web (remote user), step 1");
  await page.keyboard.press("Escape");
  // That was the last client of the last case: it saves and offers to close the run.
  await expect(page).toHaveURL(/finished=1/);

  // Back on the grid, every result shows.
  await page.goto(`/p/${KEY}/runs/1`);
  await expect(cell(page, "Queen Mary splat visible", "Web (remote user)")).toContainText("Failed");
  await expect(cell(page, "Anchor in AR", "Unity iOS")).toContainText("Passed");

  // Only one client: the filter narrows the grid.
  await grid.getByRole("button", { name: "Unity iOS", exact: true }).click();
  await expect(grid.locator("thead th")).toHaveText(["Case", "Unity iOS"]);
  await grid.getByRole("button", { name: "All clients" }).click();

  // The case page shows the guessed clients, and changing them sticks.
  await page.goto(`/p/${KEY}/cases/3`);
  const mine = page.getByTestId("case-clients");
  await expect(mine).toContainText("Web");
  await expect(mine).toContainText("Guessed from the case's words.");
  await mine.getByRole("button", { name: "Change" }).click();
  await mine.getByLabel("Unreal").check();
  await mine.getByRole("button", { name: "Save" }).click();
  await expect(mine).toContainText("Web and Unreal");
  await expect(mine).not.toContainText("Guessed");

  // Export: a By client sheet comes first.
  const res = await page.request.get(`/p/${KEY}/runs/1/export`);
  expect(res.status()).toBe(200);
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await res.body()) as unknown as ArrayBuffer);
  const tab = book.worksheets[0];
  expect(tab.name).toBe("By client");
  expect(tab.getRow(1).values).toEqual([undefined, "Case", "Title", "Folder", "Web", "Unreal", "Unity iOS", "Web (remote user)", "Case result", "Bugs"]);
  expect((tab.getRow(2).values as unknown[]).slice(4, 9)).toEqual(["Passed", "Failed", "Passed", "Passed", "Failed"]);
});

test("phones show a card per case with its clients", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, EMAIL, "Cleo Clients");
  await page.goto(`/p/${KEY}/runs/1`);
  const card = page.getByTestId("client-grid").locator("article", { hasText: "Queen Mary splat visible" });
  await expect(card.getByRole("button")).toHaveCount(2);
  await expect(card).toContainText("Validate Gaussian Splat model of Queen Mary is visible on Web and Web Remote.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await problems(page)).toEqual([]);
  await shot(page, "phone");
});

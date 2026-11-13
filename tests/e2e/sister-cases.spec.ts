import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// Sister cases: a demo dry run case ("Log in", tested on Web and Unreal) and the RC cases it shares
// a test with (Web and Unreal "Sign In / Out"). Case library › Sister cases suggests them; once
// linked, a dry run result fills the linked steps in the open RC run (only steps nobody marked),
// with Undo. The RC runner says "From dry run". A run started later fills in straight away.

test.describe.configure({ mode: "serial" });

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const DRY = `SD${TAG}`;
const RC = `SR${TAG}`;
const EMAIL = `sisters-${TAG.toLowerCase()}@example.com`;
const SHOTS = process.env.FP_SHOTS;
const AXE = require.resolve("axe-core/axe.min.js");
const RULES = ["aria-required-attr", "aria-allowed-attr", "label-content-name-mismatch", "heading-order", "button-name", "nested-interactive", "color-contrast", "label"];
const shot = async (page: Page, name: string) => SHOTS && (await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }));
const SIGN = [
  { kind: "step", action: "SIGN IN / OUT STEPS", expected: "" },
  { kind: "step", action: "Signing In: a user is able to sign in to their account.", expected: "User lands on the spaces list" },
  { kind: "step", action: "Signing Out: a user is able to sign out of their account.", expected: "User is back on the log in page" },
];

async function problems(page: Page, testId: string) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(
    async ([rules, id]) => {
      // @ts-expect-error axe is added by the script tag
      const r = await window.axe.run({ include: [[`[data-testid='${id}']`]] }, { runOnly: { type: "rule", values: rules } });
      return r.violations.flatMap((v: { id: string; nodes: { target: string[] }[] }) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`));
    },
    [RULES, testId] as const,
  );
}

async function withDb<T>(fn: (db: PrismaClient) => Promise<T>) {
  const db = new PrismaClient();
  try {
    return await fn(db);
  } finally {
    await db.$disconnect();
  }
}

test.beforeAll(async () => {
  await withDb(async (db) => {
    const user = await db.user.create({ data: { email: EMAIL, name: "Sam Sister", whatsNewSeen: 999 } });
    const make = async (key: string, name: string, cases: { title: string; steps: object[] }[], clients: string[] = []) => {
      const project = await db.project.create({ data: { key, name, clients, caseSeq: cases.length, members: { create: [{ userId: user.id, role: "ADMIN" }] }, rolesChosenAt: new Date() } });
      const ids: string[] = [];
      for (const [i, c] of cases.entries()) {
        const made = await db.testCase.create({
          data: { projectId: project.id, number: i + 1, title: c.title, versions: { create: { version: 1, title: c.title, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags: [], steps: c.steps, folderPath: "" } } },
        });
        ids.push(made.id);
      }
      await db.testSuite.create({ data: { projectId: project.id, name: "Everything", cases: { create: ids.map((caseId, position) => ({ caseId, position })) } } });
    };
    await make(`${DRY}`, `Demo Dry Run ${TAG}`, [{ title: "Log in", steps: [{ kind: "step", action: "", expected: "User is able to login to all clients on the appropriate environment." }] }], ["Web", "Unreal"]);
    await make(`${RC}`, `OKO RC ${TAG}`, [
      { title: "[WEB] - Account - Sign In / Out", steps: SIGN },
      { title: "[UNREAL] - Account - Sign In / Out", steps: SIGN },
    ]);
  });
});

async function startRun(page: Page, key: string, name: string) {
  const suite = await withDb(async (db) => (await db.testSuite.findFirstOrThrow({ where: { project: { key } } })).id);
  await page.goto(`/p/${key}/suites/${suite}`);
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByLabel("Run name (optional)").fill(name);
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
}

const stepsOf = (key: string, run: number, title: string) =>
  withDb(async (db) => {
    const e = await db.runEntry.findFirstOrThrow({ where: { run: { project: { key }, number: run }, title }, select: { status: true, draft: true, results: { orderBy: { createdAt: "desc" }, take: 1, select: { stepResults: true } } } });
    const list = ((e.draft as { stepResults?: { status: string }[] } | null)?.stepResults ?? (e.results[0]?.stepResults as { status: string }[] | undefined) ?? []).map((s) => s.status);
    return { status: e.status, steps: list };
  });

test("dry run results fill the linked steps of their RC sister cases", async ({ page }) => {
  await signIn(page, EMAIL, "Sam Sister");

  // Case library › Sister cases: one suggestion per client, Signing In ticked, Signing Out not.
  await page.goto(`/p/${RC}/cases`);
  await page.getByRole("link", { name: "Sister cases" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${RC}/cases/sisters`));
  await expect(page.getByRole("navigation", { name: /breadcrumb/i })).toContainText("Sister cases");
  const box = page.getByTestId("sister-cases");
  const row = box.getByTestId("sister-row").filter({ hasText: "Log in" });
  await expect(row.getByTestId("sister-suggestion")).toHaveCount(2);
  const web = row.getByTestId("sister-suggestion").filter({ hasText: "[WEB]" });
  await expect(web.getByLabel(/^Signing In/)).toBeChecked();
  await expect(web.getByLabel(/^Signing Out/)).not.toBeChecked();
  expect(await problems(page, "sister-cases")).toEqual([]);
  await shot(page, "sisters-suggested");
  await box.getByRole("button", { name: "Link all suggested (2)" }).click();
  await expect(box.getByRole("status")).toContainText("Linked 2 suggested sisters");
  await expect(row.getByTestId("sister-link")).toHaveCount(2);
  await shot(page, "sisters-linked");

  // The RC run first, then the dry run.
  await startRun(page, RC, "RC 23");
  await startRun(page, DRY, "DDR RC 23");

  // Mark Web passed on the dry run grid: the RC Web case's Signing In fills in, with Undo.
  const cell = (client: string) => page.getByTestId("client-grid").locator("table").getByRole("button", { name: new RegExp(`^${client}\\s*:.*Log in$`) });
  await cell("Web").click();
  await page.getByRole("dialog").getByRole("button", { name: "Passed" }).click();
  const toast = page.getByTestId("sister-toast");
  await expect(toast).toContainText("Also filled in the RC:");
  await expect(toast).toContainText("[WEB] - Account - Sign In / Out");
  await shot(page, "toast");
  expect(await stepsOf(RC, 1, "[WEB] - Account - Sign In / Out")).toEqual({ status: "IN_PROGRESS", steps: ["UNTESTED", "PASSED", "UNTESTED"] });
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Undone. The RC steps are back to no result.")).toBeVisible();
  expect((await stepsOf(RC, 1, "[WEB] - Account - Sign In / Out")).status).toBe("UNTESTED");

  // Again, and Unreal failed this time.
  await cell("Web").click();
  await page.getByRole("dialog").getByRole("button", { name: "Passed" }).click();
  await expect(page.getByTestId("sister-toast")).toBeVisible();
  await cell("Unreal").click();
  await page.getByRole("dialog").getByRole("button", { name: "Failed" }).click();
  await expect(page.getByTestId("sister-toast")).toContainText("[UNREAL] - Account - Sign In / Out");
  expect((await stepsOf(RC, 1, "[UNREAL] - Account - Sign In / Out")).steps).toEqual(["UNTESTED", "FAILED", "UNTESTED"]);

  // The RC runner: "From dry run" on Signing In; the tester does the rest.
  const entry = await withDb(async (db) => (await db.runEntry.findFirstOrThrow({ where: { run: { project: { key: RC }, number: 1 }, title: "[WEB] - Account - Sign In / Out" } })).id);
  await page.goto(`/p/${RC}/runs/1/execute?entry=${entry}`);
  await expect(page.locator("li[data-step='1']").getByTestId("sister-tag")).toContainText("From dry run · Sam Sister");
  await expect(page.locator("li[data-step='2']").getByTestId("sister-tag")).toHaveCount(0);
  await shot(page, "rc-runner");

  // A run started after the dry run fills in straight away.
  await startRun(page, RC, "RC 23 hotfix");
  expect((await stepsOf(RC, 2, "[WEB] - Account - Sign In / Out")).steps).toEqual(["UNTESTED", "PASSED", "UNTESTED"]);
  expect((await stepsOf(RC, 2, "[UNREAL] - Account - Sign In / Out")).steps).toEqual(["UNTESTED", "FAILED", "UNTESTED"]);

  // The case page lists its sisters.
  await page.goto(`/p/${RC}/cases/1`);
  await expect(page.getByTestId("case-sisters")).toContainText("Log in");
});

test("the Sister cases page fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, EMAIL, "Sam Sister");
  await page.goto(`/p/${RC}/cases/sisters`);
  await expect(page.getByTestId("sister-link").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, "phone");
});

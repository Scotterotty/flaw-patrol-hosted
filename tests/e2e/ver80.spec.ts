import { PrismaClient, type ResultStatus } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { withTestOko } from "./shared-oko";
import { standaloneProject } from "./projects";

// ver_80: Flaky badges and the Flaky only filter, Edit fields… on ticked cases,
// and the umbrella's Bug template row with Import… / Change… and an empty test cycles box.


// The OKO layout is a company template since ver_96; these tests get their own copy.
withTestOko();
const run = Date.now().toString(36).slice(-4).toUpperCase();
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;

async function newCase(page: import("@playwright/test").Page, key: string, title: string) {
  await page.goto(`/p/${key}/cases/new`);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Step 1 action").fill("Do it");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("flaky cases get a badge and a filter, and ticked cases can be edited together", async ({ page }) => {
  const KEY = `FK${run}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Flaky ${run}`, KEY);
  await newCase(page, KEY, "Sign in with a saved account");
  await newCase(page, KEY, "Reset a password");

  // Four runs: the first case flips Passed, Failed, Passed, Failed; the second always passes.
  const db = new PrismaClient();
  try {
    const project = await db.project.findUniqueOrThrow({ where: { key: KEY }, include: { cases: { orderBy: { number: "asc" } } } });
    const [flaky, steady] = project.cases;
    const verdicts: ResultStatus[] = ["PASSED", "FAILED", "PASSED", "FAILED"];
    for (const [i, status] of verdicts.entries()) {
      const r = await db.testRun.create({ data: { projectId: project.id, number: i + 1, name: `Run ${i + 1}`, state: "COMPLETED" } });
      for (const [c, s] of [[flaky, status], [steady, "PASSED"]] as const) {
        const e = await db.runEntry.create({ data: { runId: r.id, caseId: c.id, caseVersion: 1, position: c.number, title: c.title, priority: c.priority, steps: [], status: s } });
        await db.testResult.create({ data: { entryId: e.id, runId: r.id, caseId: c.id, caseVersion: 1, status: s, stepResults: [], createdAt: new Date(Date.now() - (10 - i) * 60_000) } });
      }
    }
  } finally {
    await db.$disconnect();
  }

  await page.goto(`/p/${KEY}/cases`);
  const rowOf = (title: string) => page.getByRole("row").filter({ hasText: title });
  await expect(rowOf("Sign in with a saved account").getByTitle(/^Flaky: .* 3 times/)).toBeVisible();
  await expect(rowOf("Reset a password").getByText("Flaky")).toHaveCount(0);
  await page.getByRole("link", { name: "1 flaky" }).click();
  await expect(page).toHaveURL(/flagged=flaky/);
  await expect(page.getByLabel("Flag")).toHaveValue("flaky");
  await expect(page.getByRole("link", { name: "Reset a password" })).toHaveCount(0);
  await page.getByRole("link", { name: "Sign in with a saved account" }).click();
  await expect(page.getByText("Flaky · flipped 3 times in its last 10 runs")).toBeVisible();

  // The run page lists it with the badge too.
  await page.goto(`/p/${KEY}/runs/4`);
  await expect(page.getByRole("row").filter({ hasText: "Sign in with a saved account" }).getByText("Flaky")).toBeVisible();

  // Edit fields… on both cases: priority and tags, one new version each.
  await page.goto(`/p/${KEY}/cases`);
  await page.getByLabel("Select all").check();
  await page.getByRole("button", { name: "Edit fields…" }).click();
  const dialog = page.getByTestId("bulk-edit");
  await dialog.getByLabel("Priority").selectOption("CRITICAL");
  await dialog.getByLabel("Add tags").fill("smoke");
  await dialog.getByLabel("Add tags").press("Enter");
  await expect(dialog.getByRole("status")).toHaveText("2 cases: priority set to Critical on 2, tag smoke added to 2. Each changed case gets a new version.");
  await dialog.getByRole("button", { name: "Update 2 cases" }).click();
  await expect(page.getByText("Updated 2 cases.")).toBeVisible();
  await expect(rowOf("Reset a password")).toContainText("Critical");
  await expect(rowOf("Reset a password")).toContainText("smoke");
  await expect(rowOf("Reset a password")).toContainText("v2");

  // Taking the tag off one case again.
  await rowOf("Reset a password").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Edit fields…" }).click();
  await dialog.getByLabel("Remove tags").fill("smoke,");
  await expect(dialog.getByRole("status")).toContainText("tag smoke removed from 1");
  await dialog.getByRole("button", { name: "Update 1 case" }).click();
  await expect(page.getByText("Updated 1 case.")).toBeVisible();
  await expect(rowOf("Reset a password")).not.toContainText("smoke");
  await expect(rowOf("Reset a password")).toContainText("v3");
});

test("the umbrella's Bug template row leads to the import", async ({ page }) => {
  const NAME = `Payments ${run}`;
  const HUB = `PY${run}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Product name").fill(NAME);
  await dialog.getByLabel("Key").fill(HUB);
  await dialog.getByTestId("u-more").click();
  await dialog.getByLabel("Release", { exact: true }).fill("R1");
  await dialog.getByLabel("Platform 1").fill("Web");
  await dialog.getByRole("button", { name: `Make ${NAME} with 1 new test cycle` }).click();
  await expect(page).toHaveURL(/\/g\//);
  const settingsUrl = `${page.url()}/settings`;
  // Umbrellas made before ver_89 keep the OKO bug layout; this test stands in for one.
  const pre = new PrismaClient();
  await pre.projectGroup.update({ where: { id: page.url().split("/g/")[1].split(/[/?#]/)[0] }, data: { okoLayout: true } }).finally(() => pre.$disconnect());

  // Before Jira: the first bug template is the plain one, with nothing to change yet (ver_144:
  // no separate Jira bug layout row), and the Jira row shows no grayed choices.
  await page.goto(`${settingsUrl}#bug-templates`);
  const row = page.getByTestId("bug-templates").getByTestId("bug-template-row").first();
  await expect(row).toContainText("Plain bug");
  await expect(row.getByRole("button", { name: "Change layout…" })).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "Jira bug layout" })).toHaveCount(0);
  await page.goto(`${settingsUrl}#jira`);
  await expect(page.getByTestId("bug-template-locked")).toHaveCount(0);

  // Connect Jira on the hub; Import… then opens the import with it picked.
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("QA");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText("Connected as QA Bot.")).toBeVisible();
  await page.goto(`${settingsUrl}#bug-templates`);
  await row.getByRole("button", { name: "Change layout…" }).click();
  await expect(page).toHaveURL(/#template$/);
  await page.goto(`${settingsUrl}#import-template`);
  const settings = page.getByTestId("bug-template-settings");
  await expect(settings.getByLabel("Import a template from Jira")).toBeChecked();
  await expect(settings.getByLabel("Example bug")).toBeFocused();

  // Picking the OKO layout turns the row into Change….
  await settings.getByLabel(/OKO bug layout/).check();
  await settings.getByRole("button", { name: "Use OKO bug layout" }).click();
  await expect(settings.getByText(/Saved\. New bugs from here use OKO bug layout\./)).toBeVisible();
  await page.goto(`${settingsUrl}#bug-templates`);
  await expect(row).toContainText("OKO bug layout");
  await expect(row).toContainText("Shared by a workspace admin");
  await expect(row.getByRole("button", { name: "Change layout…" })).toBeVisible();
  // ver_117: the Test cycles table's Jira chip says the test cycle uses the umbrella's Jira and bug template.
  await expect(page.getByTestId("cycle-settings").getByTitle(/Jira connection and bug template, set above/)).toHaveCount(1);

  // With no test cycles left, the box says so.
  const db = new PrismaClient();
  try {
    await db.project.updateMany({ where: { name: `${NAME} Web R1` }, data: { groupId: null } });
  } finally {
    await db.$disconnect();
  }
  await page.reload();
  await expect(page.getByText("No test cycles yet")).toBeVisible();
});

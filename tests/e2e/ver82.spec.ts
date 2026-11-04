import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject, pickKind } from "./projects";

// ver_82: Jira story links and coverage, Slack alerts, automation results upload,
// Ctrl+K search, the Roles card, and making a test cycle inside Create a run.

const run = Date.now().toString(36).slice(-4).toUpperCase();
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;

async function newCase(page: Page, key: string, title: string, action = "Do it") {
  await page.goto(`/p/${key}/cases/new`);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Step 1 action").fill(action);
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

async function connectJira(page: Page, key: string) {
  await page.goto(`/p/${key}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("QA");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText(`Connected to ${JIRA}, Jira project QA`)).toBeVisible();
}

const slackFor = async (hook: string) => ((await (await fetch(`${JIRA}/__slack`)).json()) as { hook: string; text: string }[]).filter((m) => m.hook === hook).map((m) => m.text);

test("stories, Slack alerts and a regression from one run", async ({ page }) => {
  test.setTimeout(300_000);
  const KEY = `SA${run}`;
  const hook = `/slack/${KEY}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Stories ${run}`, KEY);
  await connectJira(page, KEY);
  await expect(page.getByRole("button", { name: "Save requirements" })).toBeVisible();

  // Slack: one channel, tested before saving, with Run started switched on.
  const card = page.locator("#slack");
  await card.getByRole("button", { name: "＋ Add channel" }).click();
  await card.getByLabel(/Slack webhook link/).fill(`${JIRA}${hook}`);
  await card.getByLabel(/Channel name/).fill("qa-alerts");
  await card.getByRole("button", { name: "Send test message" }).click();
  await expect(card.getByText(/^Sent\./)).toBeVisible();
  await expect.poll(() => slackFor(hook)).toContain("👋 Flaw Patrol is connected");
  await card.getByRole("button", { name: "Next: pick alerts" }).click();
  await card.getByRole("switch", { name: "Run started" }).check();
  await card.getByRole("button", { name: "Save channel" }).click();
  await expect(card.getByText("#qa-alerts")).toBeVisible();
  await expect(card.getByText(/Regression, Serious bug \(B or worse\), Someone asks to join, Run finished, Bug bash ended, Release testing done, Run started/)).toBeVisible();

  await newCase(page, KEY, `Join from an invite ${run}`);
  await newCase(page, KEY, `Expired invite ${run}`);

  // Link a story on the case page.
  await page.goto(`/p/${KEY}/cases/1`);
  await page.getByRole("button", { name: "+ Link requirement" }).click();
  await page.getByLabel("Find a Jira requirement").fill("invite link");
  await page.getByRole("option", { name: /QA-201/ }).click();
  await expect(page.getByRole("link", { name: "QA-201 ↗" })).toBeVisible();

  // And many at once from the case list.
  await page.goto(`/p/${KEY}/cases`);
  await page.getByRole("row").filter({ hasText: `Expired invite ${run}` }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Link to requirement…" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Find a Jira requirement").fill("expire");
  await modal.getByRole("option", { name: /QA-202/ }).click();
  await modal.getByRole("button", { name: "Link 1 case" }).click();
  await expect(page.getByText("Linked QA-202 to 1 case.")).toBeVisible();

  // Stories page: the RC 22 release lists a story with no cases too.
  await page.goto(`/p/${KEY}/stories`);
  await page.getByRole("link", { name: "RC 22" }).click();
  await expect(page.getByRole("link", { name: /No cases\s*1/ })).toBeVisible();
  await expect(page.getByText("Space thumbnails load lazily")).toBeVisible();

  // A passing result from an earlier run, so failing now is a regression.
  const db = new PrismaClient();
  try {
    const project = await db.project.findUniqueOrThrow({ where: { key: KEY }, include: { cases: { orderBy: { number: "asc" } } } });
    const c = project.cases[0];
    const r = await db.testRun.create({ data: { projectId: project.id, number: 1, name: "Earlier", state: "COMPLETED" } });
    const e = await db.runEntry.create({ data: { runId: r.id, caseId: c.id, caseVersion: 1, position: 1, title: c.title, priority: c.priority, steps: [], status: "PASSED" } });
    await db.testResult.create({ data: { entryId: e.id, runId: r.id, caseId: c.id, caseVersion: 1, status: "PASSED", stepResults: [], createdAt: new Date(Date.now() - 3_600_000) } });
    await db.project.update({ where: { id: project.id }, data: { runSeq: 1 } });
  } finally {
    await db.$disconnect();
  }

  await page.goto(`/p/${KEY}/runs`);
  await page.getByRole("button", { name: "Create a run" }).click();
  const box = page.getByRole("dialog", { name: "Create a run" });
  await box.getByRole("button", { name: /Every case/ }).click();
  await box.getByLabel("Run name").fill(`Invites ${run}`);
  await box.getByLabel("Release", { exact: true }).fill("RC 22");
  await box.getByRole("button", { name: /^Create (run|smoke test)$/ }).click();
  await expect.poll(() => slackFor(hook)).toContainEqual(expect.stringContaining("Run started"));

  // The runner shows the story; the bug box links the new bug to it in Jira.
  await page.goto(`/p/${KEY}/runs/2/execute`);
  await expect(page.getByRole("link", { name: "QA-201 ↗" })).toBeVisible();
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Failed" }).click();
  await page.getByRole("button", { name: "Report bug in Jira" }).click();
  const bug = page.getByRole("dialog");
  await expect(bug.getByRole("checkbox", { name: /Link to requirement QA-201 in Jira/ })).toBeChecked();
  await bug.getByLabel("Severity").selectOption({ label: "B - Critical" });
  await bug.getByRole("button", { name: "File bug in Jira" }).click();
  await expect(bug).toBeHidden();
  await page.getByRole("button", { name: "Save and next" }).click();
  await expect(page.getByRole("heading", { name: `Expired invite ${run}` })).toBeVisible();
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" }).click();
  await page.getByRole("button", { name: "Save and finish" }).click();

  const links = (await (await fetch(`${JIRA}/__links`)).json()) as { to: string; type: string }[];
  expect(links).toContainEqual(expect.objectContaining({ to: "QA-201", type: "Relates" }));
  await expect.poll(() => slackFor(hook)).toContainEqual(expect.stringContaining("Regression"));
  await expect.poll(() => slackFor(hook)).toContainEqual(expect.stringContaining("B - Critical bug filed"));
  await expect.poll(() => slackFor(hook)).toContainEqual(expect.stringContaining("Run finished"));
  // ver_132: the post says what failed (Counts and what failed is the default), regressions first.
  const posts = (await (await fetch(`${JIRA}/__slack`)).json()) as { hook: string; text: string }[];
  const finished = JSON.stringify(posts.find((m) => m.hook === hook && m.text.includes("Run finished")));
  expect(finished).toContain("What failed");
  expect(finished).toContain("REGRESSION");
  expect(finished).toContain("See what failed");
  await expect.poll(() => slackFor(hook)).toContainEqual(expect.stringContaining("RC 22 testing done"));

  // Reports › Stories for this test cycle, and the bell on the run page.
  await page.goto(`/p/${KEY}/reports/stories?release=RC%2022`);
  await expect(page.getByText(/2 of 3/)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "QA-201" })).toContainText("1 failed");
  await expect(page.getByRole("row").filter({ hasText: "QA-202" })).toContainText("1/1 passed");
  await page.goto(`/p/${KEY}/runs/2`);
  await expect(page.getByRole("link", { name: /Slack: #qa-alerts/ })).toBeVisible();

  // Pause all stops posting.
  await page.goto(`/p/${KEY}/settings`);
  await card.getByRole("button", { name: "Pause all" }).click();
  await expect(card.getByRole("button", { name: "Resume all" })).toBeVisible();
});

test("automation results upload, Ctrl+K search and the Roles card", async ({ page }) => {
  test.setTimeout(240_000);
  const KEY = `AU${run}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Auto ${run}`, KEY);
  await newCase(page, KEY, `Sign in with SSO ${run}`);

  const xml = `<?xml version="1.0"?><testsuites><testsuite name="Login" tests="2" failures="1">
    <testcase classname="LoginTests" name="${KEY}-1 signs in" time="1.2"/>
    <testcase classname="LoginTests" name="remembers the user" time="0.4"><failure message="Expected true">stack line</failure></testcase>
  </testsuite></testsuites>`;
  await page.goto(`/p/${KEY}/runs`);
  await page.getByRole("button", { name: "Bring in results" }).click();
  await page.getByRole("menuitem", { name: /Automated test results/ }).click();
  await page.getByLabel("Results files").setInputFiles({ name: "results.xml", mimeType: "text/xml", buffer: Buffer.from(xml) });
  await page.getByRole("button", { name: "Next: check results" }).click();
  await page.getByRole("button", { name: /^Save 2 results$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/runs/1$`));
  await expect(page.getByText("Expected true")).toBeVisible();
  await page.goto(`/p/${KEY}/runs`);
  await expect(page.getByRole("link", { name: /Automated/ })).toBeVisible();

  // Ctrl+K finds the case and opens it.
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Search" });
  await search.getByLabel("Search cases, runs, bugs, test cycles and pages").fill(`SSO ${run}`);
  await expect(search.getByRole("option", { name: new RegExp(`Sign in with SSO ${run}`) })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases/1`));

  // Roles card (ver_96): Everyone is the default; Tighter saves like any preset.
  await page.goto(`/p/${KEY}/settings`);
  const roles = page.locator("#roles");
  const fold = roles.getByRole("button", { name: /^What can they do/ });
  if ((await fold.getAttribute("aria-expanded")) === "false") await fold.click();
  const preset = roles.getByRole("group", { name: "Preset" });
  await expect(preset.getByRole("button", { name: /^Everyone/ })).toHaveAttribute("aria-pressed", "true");
  await preset.getByRole("button", { name: "Tighter" }).click();
  await roles.getByRole("button", { name: "Save", exact: true }).click();
  await expect(roles.getByText("Saved", { exact: true })).toBeVisible();
});

test("an umbrella with no test cycles makes one inside Create a run, and lists Slack in its setup", async ({ page }) => {
  test.setTimeout(240_000);
  const HUB = `UC${run}`;
  const NAME = `Empty ${run}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  const db = new PrismaClient();
  let groupId = "";
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: `${NAME} case library`, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id } })).id;
  } finally {
    await db.$disconnect();
  }
  await newCase(page, HUB, `Open the app ${run}`);

  await page.goto(`/g/${groupId}`);
  await expect(page.getByText("Send alerts to Slack (optional)")).toBeVisible();
  await page.goto(`/g/${groupId}/settings`);
  await expect(page.locator("#row-slack").getByRole("button", { name: "Set up" })).toBeVisible();

  await page.goto(`/g/${groupId}/runs`);
  await page.getByRole("button", { name: "Create a run" }).click();
  const box = page.getByRole("dialog", { name: "Create a run" });
  await pickKind(page);
  await box.getByRole("button", { name: /Whole Case library/ }).click();
  // ver_95: the New test cycle form is open when there are none, and it's made on Start.
  await box.getByLabel("Name", { exact: true }).fill("RC 1 Web");
  await expect(box.getByText("RC 1 Web (new)")).toBeVisible();
  await box.getByLabel("Run name").fill(`First ${run}`);
  await box.getByRole("button", { name: /^Create (run|smoke test)$/ }).click();
  // ver_116: the box says "Making First …" at once, so wait for the run page itself.
  await expect(page).toHaveURL(/\/runs\/\d+/, { timeout: 60_000 });
  await expect(page.getByText(`First ${run}`).filter({ visible: true }).first()).toBeVisible();

  // The new test cycle follows the umbrella's Slack channels.
  const db2 = new PrismaClient();
  const cycle = await db2.project.findFirstOrThrow({ where: { groupId, name: "RC 1 Web" } });
  await db2.$disconnect();
  await page.goto(`/p/${cycle.key}/settings`);
  await expect(page.locator("#slack").getByText(`Following ${NAME}`)).toBeVisible();
});

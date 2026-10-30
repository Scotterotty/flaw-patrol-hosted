import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_93: testing without test cases (Charters page with tours and checklists, bug bashes,
// the Risk board and Plan this release), and Playwright screenshots and replays from a zip.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;

async function connectJira(page: Page, key: string) {
  await page.goto(`/p/${key}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("QA");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText(`Connected to ${JIRA}, Jira project QA`)).toBeVisible();
}

test("a charter from a tour, then a bug bash from start to report", async ({ page }) => {
  test.setTimeout(300_000);
  const KEY = `BB${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Bash ${TAG}`, KEY);

  // Charters: the gallery fills in a tour; only the area is left to type.
  await page.goto(`/p/${KEY}/charters`);
  await page.getByRole("link", { name: /Charters/ }).first().waitFor();
  await page.goto(`/p/${KEY}/charters/new`);
  await page.getByRole("button", { name: /Money tour/ }).click();
  await page.getByLabel("Area to explore").fill("Checkout");
  await expect(page.getByText("The path shown in demos, end to end")).toBeVisible();
  await page.getByRole("button", { name: "Use this charter" }).click();
  await expect(page).toHaveURL(/cases\/new\?charter=1/);
  await page.getByRole("button", { name: "Create charter" }).first().click();
  await expect(page.getByText("The path shown in demos, end to end")).toBeVisible();

  // Start a bug bash with two areas.
  await page.goto(`/p/${KEY}/bashes`);
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Name").fill(`RC ${TAG}`);
  await box.getByLabel("Add an area").fill("Checkout");
  await box.getByLabel("Add an area").press("Enter");
  await box.getByLabel("Add an area").fill("Search");
  await box.getByLabel("Add an area").press("Enter");
  await box.getByRole("button", { name: "Start bug bash" }).click();
  await expect(box.getByLabel("Join link")).toBeVisible();
  await box.getByRole("link", { name: "Open the bash" }).click();

  // The live pill shows in the top bar while it's on.
  await expect(page.getByRole("link", { name: /Bug bash live/ }).first()).toBeVisible();

  // Join, pick an area, log two bugs; the second sounds like the first.
  await page.goto(`/p/${KEY}/bashes`);
  await page.getByRole("link", { name: "Join" }).first().click();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Start exploring" }).click();
  const find = page.getByLabel("What did you find?");
  await find.fill("Order placed twice after reconnecting");
  await page.getByRole("button", { name: "Log bug" }).click();
  await expect(page.getByText("Order placed twice after reconnecting").first()).toBeVisible();
  await find.fill("Total shows the wrong currency");
  await page.getByRole("radiogroup", { name: "How bad?" }).getByRole("radio", { name: "High" }).click();
  await page.getByRole("button", { name: "Log bug" }).click();
  await expect(page.getByText("Total shows the wrong currency").first()).toBeVisible();

  // The owner ends early and wraps up; with no Jira, bugs are kept in Flaw Patrol.
  const db = new PrismaClient();
  const bash = await db.bugBash.findFirstOrThrow({ where: { project: { key: KEY } } });
  await db.$disconnect();
  await page.goto(`/p/${KEY}/bashes/${bash.id}`);
  await page.getByRole("button", { name: "End early" }).click();
  await page.getByRole("button", { name: "Yes, end it" }).click();
  await page.getByRole("button", { name: /File 2 bugs|Wrap up/ }).click();
  await expect(page).toHaveURL(new RegExp(`/bashes/${bash.id}/report`));
  await expect(page.getByRole("heading", { name: `Bug bash · RC ${TAG}` })).toBeVisible();
  await expect(page.getByText("Bugs found")).toBeVisible();
  await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();

  // The bash's run counts like any run, and Ctrl+K finds bug bashes.
  await page.goto(`/p/${KEY}/runs?state=closed`);
  await expect(page.getByText(`Bug bash · RC ${TAG}`)).toBeVisible();
});

test("the Risk board guesses, moves a card and plans the RC", async ({ page }) => {
  test.setTimeout(300_000);
  const KEY = `RB${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Risk ${TAG}`, KEY);
  await connectJira(page, KEY);
  const db = new PrismaClient();
  try {
    const p = await db.project.findUniqueOrThrow({ where: { key: KEY } });
    await db.project.update({ where: { id: p.id }, data: { caseSeq: 1 } });
    await db.testCase.create({ data: { projectId: p.id, number: 1, title: `Join from an invite ${TAG}`, jiraStories: ["QA-201"], versions: { create: { version: 1, title: `Join from an invite ${TAG}`, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags: [], steps: [{ action: "Open the invite", expected: "Joined" }] } } } });
  } finally {
    await db.$disconnect();
  }

  await page.goto(`/p/${KEY}/stories?release=RC%2022`);
  await page.getByRole("link", { name: "Risk board" }).last().click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/risk`));
  await page.getByRole("link", { name: "RC 22" }).click();
  const board = page.getByRole("grid", { name: "Risk board for RC 22" });
  // QA-202: High priority, 8 points and no tests, so top right.
  const top = board.getByRole("gridcell", { name: /^High likelihood, High impact/ });
  await expect(top.getByText("QA-202")).toBeVisible();
  await board.getByRole("button", { name: /QA-203/ }).click();
  const card = page.getByRole("dialog");
  await expect(card.getByText("Low priority in Jira")).toBeVisible();
  await card.getByLabel("How much it would hurt").selectOption("3");
  await expect(card.getByText("Moved by", { exact: false })).toBeVisible();
  await card.getByRole("button", { name: "✕" }).or(card.getByRole("button", { name: /Close/ })).first().click();

  const check = new PrismaClient();
  try {
    await expect.poll(async () => (await check.riskRating.findFirst({ where: { project: { key: KEY }, issueKey: "QA-203" } }))?.impact).toBe(3);
  } finally {
    await check.$disconnect();
  }

  // Plan this release: QA-201's case goes into the run, QA-202 gets a new charter.
  await page.getByRole("button", { name: "Copy for Confluence" }).isVisible();
  await page.getByRole("button", { name: "Plan this release" }).click();
  // ver_96: one card per requirement with labeled choices.
  const plan = page.getByRole("dialog", { name: /Plan a test run for RC 22/ });
  await expect(plan.getByTestId("plan-QA-201").getByRole("radio", { name: /Run its 1 case/ })).toBeChecked();
  await expect(plan.getByTestId("plan-QA-202").getByRole("radio", { name: "Explore it with a charter" })).toBeChecked();
  await plan.getByRole("button", { name: /^Create test run \(\d+ items?\)$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/runs/\\d+`));
  await expect(page.getByText("QA-202:").first()).toBeVisible();
});

test("a Playwright zip brings in screenshots and a replay that opens in Flaw Patrol", async ({ page }) => {
  test.setTimeout(300_000);
  const KEY = `PW${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Replays ${TAG}`, KEY);
  await page.goto(`/p/${KEY}/runs`);
  await page.getByRole("button", { name: /Upload automation results/ }).click();
  const zip = readFileSync(join(__dirname, "fixtures", "playwright-results-1187.zip"));
  await page.getByLabel("Results files").setInputFiles({ name: "playwright-results.zip", mimeType: "application/zip", buffer: zip });
  await page.getByRole("button", { name: "Next: check results" }).click();
  await expect(page.getByTestId("media-kept")).toContainText("replay");
  await page.getByRole("button", { name: /^Save \d+ results$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/runs/1$`));
  const media = page.getByTestId("test-media").first();
  await expect(media.getByRole("img", { name: /Screenshot: .*discount/ }).first()).toBeVisible();
  const replay = media.getByRole("link", { name: /Open step-by-step replay/ }).first();
  const href = await replay.getAttribute("href");
  expect(href).toMatch(new RegExp(`/p/${KEY}/replay/`));
  await page.goto(href!);
  await expect(page.getByTestId("replay-frame")).toBeVisible();
  const res = await page.request.get("/trace-viewer/index.html");
  expect(res.ok()).toBe(true);
});

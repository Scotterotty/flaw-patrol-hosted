import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_87 (full test findings #9, #11, #26, #29, A3, A4): an invite message after Add, test cycles
// with their own label in the left menu, the Stories report opening on the newest cycles' release,
// a roomier runner, links in sentences underlined, and a Skip to content link.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;

async function newUmbrella(page: Page, name: string, key: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const make = page.getByRole("dialog");
  await make.getByLabel("Product name").fill(name);
  await make.getByLabel("Key").fill(key);
  await make.getByLabel("Release", { exact: true }).fill("4.2");
  await make.getByLabel("Platform 1").fill("Web");
  await make.getByRole("button", { name: "＋ Add a platform" }).click();
  await make.getByLabel("Platform 2").fill("iOS");
  await make.getByRole("button", { name: `Make ${name} with 2 new test cycles` }).click();
  await expect(page).toHaveURL(/\/g\//);
  return page.url();
}

test("invite message, Test cycles label, roomier runner, underlined links and Skip to content", async ({ page, context }) => {
  test.setTimeout(300_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1366, height: 768 });
  const NAME = `Kite ${TAG}`;
  const HUB = `K${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  const home = await newUmbrella(page, NAME, HUB);

  // #9: the setup list asks you to invite your team, and Add gives a message to send.
  const setup = page.getByRole("listitem").filter({ hasText: "Invite your team" });
  await expect(setup.getByRole("link", { name: "Invite" })).toHaveAttribute("href", /\/settings#members$/);
  await setup.getByRole("link", { name: "Invite" }).click();
  await page.getByLabel("Add someone by email").fill(`lee.${TAG.toLowerCase()}@acme.test`);
  await page.getByRole("combobox", { name: "Role", exact: true }).selectOption("LEAD");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const note = page.getByRole("status").filter({ hasText: "was added as Lead" });
  // ver_114: the message carries their one-time invite link, not the plain sign-in page.
  await expect(note).toContainText("Send them this so they can get in:");
  const message = (await note.getByTestId("invite-message").textContent()) ?? "";
  expect(message).toMatch(new RegExp(`^You're invited to ${NAME} in Flaw Patrol\\. Open this link to choose your password and sign in: http://localhost:3100/invite/\\S+ \\(works once, for 7 days\\)$`));
  await note.getByRole("button", { name: "Copy message" }).click();
  await expect(note.getByText("Copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(message);
  await page.goto(home);
  await expect(page.getByRole("listitem").filter({ hasText: "Invite your team" })).toContainText("2 people");

  // #11: the RC's test cycles sit under their own label, named by platform; cycle settings are under Settings.
  const db = new PrismaClient();
  let web = "";
  try {
    const hub = await db.project.findUniqueOrThrow({ where: { key: HUB } });
    const group = await db.projectGroup.findUniqueOrThrow({ where: { hubProjectId: hub.id } });
    const cycle = await db.project.findFirstOrThrow({ where: { groupId: group.id, platform: "Web" } });
    web = cycle.key;
    const c = await db.testCase.create({ data: { projectId: hub.id, number: 1, title: "Sign in with email" } });
    await db.project.update({ where: { id: hub.id }, data: { caseSeq: 1 } });
    const steps = Array.from({ length: 12 }, (_, i) => ({ action: `Step ${i + 1}: do the next thing`, expected: "It works" }));
    const me = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    await db.testRun.create({
      data: {
        projectId: cycle.id,
        number: 1,
        name: "Smoke Web",
        release: "4.2",
        entries: { create: [{ caseId: c.id, caseVersion: 1, position: 0, title: c.title, priority: c.priority, steps, status: "UNTESTED", assigneeId: me.id }] },
      },
    });
    await db.project.update({ where: { id: cycle.id }, data: { runSeq: 1 } });
  } finally {
    await db.$disconnect();
  }
  await page.goto(`/p/${web}/runs/1/execute`);
  const nav = page.getByRole("navigation", { name: `${NAME} umbrella` }).first();
  await expect(nav.getByText("Test cycles · 4.2")).toBeVisible();
  await expect(nav.getByRole("link", { name: "Web", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "iOS", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Test cycle settings" })).toHaveCount(0);
  const settingsLinks = await nav.getByRole("list").last().getByRole("link").allTextContents();
  // ver_95: every current test cycle keeps its settings link, in Test cycles order.
  expect(settingsLinks[0]).toBe(`${NAME} settings`);
  expect([...settingsLinks.slice(1)].sort()).toEqual(["Web 4.2 settings", "iOS 4.2 settings"].sort());

  // #29: the "You're on this case" bar is above the title, and the comment box has its own full-width line.
  const bar = page.getByText("You're testing this case.");
  const title = page.getByRole("heading", { name: "Sign in with email" });
  await expect(bar).toBeVisible();
  expect((await bar.boundingBox())!.y + 20).toBeLessThan((await title.boundingBox())!.y);
  await expect(page.locator("[data-steps-scroll]").getByText("You're testing this case.")).toBeVisible();
  const comment = page.getByRole("textbox", { name: "Comment" });
  const report = page.getByRole("button", { name: "Report bug for case" });
  expect((await comment.boundingBox())!.width).toBeGreaterThan(500);
  expect((await report.boundingBox())!.y).toBeGreaterThan((await comment.boundingBox())!.y);

  // #29: on a long page the left menu's background runs all the way down.
  await page.goto(`/p/${web}/settings`);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const menu = page.getByRole("navigation", { name: `${NAME} umbrella` }).first();
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const column = await menu.evaluate((n) => (n.parentElement as HTMLElement).getBoundingClientRect().height + window.scrollY + 48);
  expect(column).toBeGreaterThanOrEqual(pageHeight - 2);
  await expect(menu).toBeInViewport();

  // A3: a link inside a sentence is underlined; menu links aren't.
  const inSentence = page.getByRole("link", { name: `Change in ${NAME} settings` });
  await expect(inSentence).toHaveCSS("text-decoration-line", "underline");
  await expect(menu.getByRole("link", { name: "Bugs" })).toHaveCSS("text-decoration-line", "none");

  // A4: the first Tab stop is Skip to content; Enter jumps to the page, so the next Tab is inside it.
  await page.goto(`/p/${web}/runs/1`);
  await expect(page.getByRole("link", { name: /Start testing|Continue testing/ }).first()).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("main"))).toBe(true);
});

test("Stories report opens on the release the newest test cycles test, or All", async ({ page }) => {
  test.setTimeout(240_000);
  const KEY = `ST${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Stories ${TAG}`, KEY);
  await page.goto(`/p/${KEY}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("QA");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText(`Connected to ${JIRA}, Jira project QA`)).toBeVisible();

  // No RC anywhere yet: All, not whichever release Jira lists first.
  const releases = page.getByRole("group", { name: "Jira release" });
  await page.goto(`/p/${KEY}/reports/stories`);
  await expect(releases.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("heading", { name: "All linked requirements · requirement coverage" })).toBeVisible();

  // Its newest run tests RC 22: the report opens on RC 22, listed first.
  const db = new PrismaClient();
  try {
    const project = await db.project.findUniqueOrThrow({ where: { key: KEY } });
    await db.testRun.create({ data: { projectId: project.id, number: 1, name: "Smoke", release: "rc22" } });
    await db.project.update({ where: { id: project.id }, data: { runSeq: 1 } });
  } finally {
    await db.$disconnect();
  }
  await page.goto(`/p/${KEY}/reports/stories`);
  await expect(releases.getByRole("link").first()).toHaveText("RC 22");
  await expect(releases.getByRole("link", { name: "RC 22" })).toHaveAttribute("aria-current", "true");
  await releases.getByRole("link", { name: "All" }).click();
  await expect(page).toHaveURL(/release=all/);
  await expect(releases.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "true");
});

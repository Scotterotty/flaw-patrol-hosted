import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_113: the Glossary. One shared list in every menu; Look it up on selected text adds a
// term from where you found it; known terms are underlined with their meaning on hover;
// Viewers can ask the team but not edit; an answer puts a dot on Glossary for whoever asked.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `GL${TAG}`;
const WORD = `Zork${TAG}`;
const OTHER = `Quux${TAG}`;
const ASKED = `Blorp${TAG}`;
const VIEWER = `viewer-${TAG.toLowerCase()}@example.com`;

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 113 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    await db.user.update({ where: { id: admin.id }, data: { glossaryUnderline: true } });
    const viewer = await db.user.create({ data: { email: VIEWER, name: `Vera ${TAG}`, whatsNewSeen: 113 } });
    const project = await db.project.create({
      data: { key: KEY, name: `Words ${TAG}`, caseSeq: 1, members: { create: [{ userId: admin.id, role: "ADMIN" }, { userId: viewer.id, role: "VIEWER" }] } },
    });
    const steps = [
      { kind: "step", number: "1", action: `Open the ${WORD} panel`, expected: `The ${WORD} panel shows the ${OTHER} list` },
      { kind: "step", number: "2", action: `Press ${ASKED}`, expected: "Nothing breaks" },
    ];
    await db.testCase.create({ data: { projectId: project.id, number: 1, title: "Glossary words", versions: { create: { version: 1, title: "Glossary words", preconditions: "", priority: "HIGH", type: "MANUAL", tags: [], steps } } } });
  } finally {
    await db.$disconnect();
  }
});

test.afterAll(async () => {
  const db = new PrismaClient();
  try {
    await db.glossaryTerm.deleteMany({ where: { term: { contains: TAG } } });
  } finally {
    await db.$disconnect();
  }
});

const menu = (page: Page) => page.locator("nav").filter({ hasText: "Library" }).first();

/** Select one word on the page the way a person would drag over it. */
async function selectWord(page: Page, word: string) {
  await page.evaluate((w) => {
    const walk = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n as Text;
      const i = t.data.indexOf(w);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(t, i);
      r.setEnd(t, i + w.length);
      const s = document.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
      return;
    }
    throw new Error(`No ${w} on the page`);
  }, word);
}

test("add a term from the Glossary page, see it underlined in steps, hide and bring back the underlines", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${KEY}`);
  await menu(page).getByRole("link", { name: /^Glossary\b/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/glossary`));
  await page.getByRole("button", { name: "+ Add a term" }).click();
  const box = page.getByRole("dialog", { name: "Add a term" });
  await box.getByLabel("Term", { exact: true }).fill(WORD);
  await box.getByLabel("Other names").fill(`zk${TAG}`);
  await box.getByLabel("What it means").fill("The side panel that lists every open order.");
  await box.getByRole("button", { name: "Add term" }).click();
  await expect(box).toBeHidden();
  const row = page.getByTestId("glossary-row").filter({ hasText: WORD });
  await expect(row).toContainText("The side panel that lists every open order.");
  await expect(row).toContainText(`also called: zk${TAG}`);
  await expect(row).toContainText("Added by");
  // Adding the same word again is refused.
  await page.getByRole("button", { name: "+ Add a term" }).click();
  await box.getByLabel("Term", { exact: true }).fill(WORD.toLowerCase());
  await box.getByLabel("What it means").fill("Again, the same word twice.");
  await box.getByRole("button", { name: "Add term" }).click();
  await expect(box.getByRole("alert")).toContainText("is already in the Glossary");
  await box.getByRole("button", { name: "Close" }).click();

  await page.goto(`/p/${KEY}/cases/1`);
  const marks = page.getByTestId("glossary-term").filter({ hasText: WORD });
  // Once per step: the action and the expected result each get one.
  await expect(marks).toHaveCount(2);
  await marks.first().hover();
  const card = page.getByTestId("glossary-hover");
  await expect(card).toContainText("The side panel that lists every open order.");
  await card.getByRole("button", { name: "Hide underlines" }).click();
  await expect(page.getByTestId("glossary-term")).toHaveCount(0);

  await page.goto(`/p/${KEY}/glossary`);
  const sw = page.getByRole("switch");
  await expect(sw).not.toBeChecked();
  await page.getByText("Underline terms everywhere").click();
  await expect(sw).toBeChecked();
  await page.goto(`/p/${KEY}/cases/1`);
  await expect(page.getByTestId("glossary-term").filter({ hasText: WORD })).toHaveCount(2);
});

test("select a word and press G to add it, with where it was found", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${KEY}/cases/1`);
  // Underlines draw once the Glossary has loaded; select after that, as a person would.
  await expect(page.getByTestId("glossary-term").filter({ hasText: WORD })).toHaveCount(2);
  await selectWord(page, OTHER);
  await expect(page.getByTestId("glossary-lookup")).toContainText("Look it up / Add to Glossary");
  await page.keyboard.press("g");
  const box = page.getByRole("dialog", { name: `Add "${OTHER}" to the Glossary` });
  await expect(box.getByLabel("Term", { exact: true })).toHaveValue(OTHER);
  await expect(box).toContainText("Found on");
  await box.getByLabel("What it means").fill("A list of orders waiting to ship.");
  await box.getByRole("button", { name: "Add term" }).click();
  await expect(box).toBeHidden();
  await expect(page.getByTestId("glossary-term").filter({ hasText: OTHER })).toHaveCount(1);
  // A known word opens its meaning.
  await page.evaluate(() => document.getSelection()?.removeAllRanges());
  await page.getByTestId("glossary-term").filter({ hasText: OTHER }).click();
  await expect(page.getByTestId("glossary-hover")).toContainText("A list of orders waiting to ship.");
  await page.getByTestId("glossary-hover").getByRole("link", { name: "Open in Glossary" }).click();
  await expect(page).toHaveURL(/glossary\?term=/);
  await expect(page.getByTestId("glossary-row").filter({ hasText: OTHER })).toContainText("from");
});

test("a Viewer asks the team, an Admin answers, and the Viewer sees the answer", async ({ browser }) => {
  const viewer = await browser.newPage();
  await signIn(viewer, VIEWER, `Vera ${TAG}`);
  await viewer.goto(`/p/${KEY}/glossary`);
  await expect(viewer.getByRole("button", { name: "+ Add a term" })).toHaveCount(0);
  await viewer.goto(`/p/${KEY}/cases/1`);
  await expect(viewer.getByTestId("glossary-term").filter({ hasText: OTHER })).toHaveCount(1);
  await selectWord(viewer, ASKED);
  await expect(viewer.getByTestId("glossary-lookup")).toContainText("Ask the team");
  await viewer.getByTestId("glossary-lookup").click();
  const ask = viewer.getByRole("dialog", { name: `Ask the team about "${ASKED}"` });
  await expect(ask.getByLabel("What it means")).toHaveCount(0);
  await ask.getByLabel("Your question").fill("Which button is this?");
  await ask.getByRole("button", { name: "Ask the team" }).click();
  await expect(ask).toBeHidden();

  const admin = await browser.newPage();
  await signIn(admin, "admin@example.com", "Demo Admin");
  await admin.goto(`/p/${KEY}/glossary`);
  await admin.getByRole("button", { name: /^Needs an answer/ }).click();
  const q = admin.getByTestId("glossary-row").filter({ hasText: ASKED });
  await expect(q).toContainText("Needs an answer");
  await expect(q).toContainText("Which button is this?");
  await q.getByRole("button", { name: "Answer it" }).click();
  await admin.getByLabel("What it means").fill("The red button that saves a draft order.");
  await admin.getByRole("button", { name: "Save answer" }).click();
  await admin.getByRole("button", { name: /^All/ }).click();
  await expect(admin.getByTestId("glossary-row").filter({ hasText: ASKED })).toContainText("The red button that saves a draft order.");

  await viewer.goto(`/p/${KEY}`);
  await expect(viewer.getByTestId("menu-note").first()).toBeVisible();
  await menu(viewer).getByRole("link", { name: /^Glossary\b/ }).click();
  const mine = viewer.getByTestId("glossary-row").filter({ hasText: ASKED });
  await expect(mine).toContainText("New answer to your question");
  await expect(mine).toContainText("answered by");
  // Viewers can't edit, and the dot is gone once they've seen it.
  await expect(mine.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await viewer.reload();
  await expect(viewer.getByTestId("menu-note")).toHaveCount(0);
  await mine.getByRole("button", { name: "History" }).click();
  const history = viewer.getByTestId("glossary-history");
  await expect(history).toContainText("Answered by Demo Admin");
  await expect(history).toContainText(`Asked by Vera ${TAG}`);
  await viewer.close();
  await admin.close();
});

test("only Admins delete other people's terms", async ({ page }) => {
  const db = new PrismaClient();
  try {
    const viewer = await db.user.findUniqueOrThrow({ where: { email: VIEWER } });
    await db.glossaryTerm.create({ data: { term: `Gone${TAG}`, key: `gone${TAG}`.toLowerCase(), slug: `gone-${TAG}`.toLowerCase(), meaning: "A word that will be deleted soon.", createdById: viewer.id } });
  } finally {
    await db.$disconnect();
  }
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${KEY}/glossary`);
  const row = page.getByTestId("glossary-row").filter({ hasText: `Gone${TAG}` });
  await row.getByRole("button", { name: "Delete" }).click();
  await row.getByRole("button", { name: "Yes, delete" }).click();
  await expect(row).toHaveCount(0);
});

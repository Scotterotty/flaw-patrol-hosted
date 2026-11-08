import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_126, from the ver_123 functionality audit:
// 1. Umbrellas can't be deleted, only archived; renaming one and moving its test cycles follow the
//    umbrella's own Roles card, so someone who isn't on it can't do either, even by calling the action.
// 2. I saw it again adds a row to the table in the Jira bug's description and leaves the rest as Jira has it.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;

/** Calls a server action by id from the signed-in page, as a crafted request would, and returns what came back. */
const callAction = (page: Page, action: string, args: unknown[]) =>
  page.evaluate(
    async ([action, args]) => {
      const r = await fetch("/", { method: "POST", headers: { "Next-Action": action as string, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" }, body: JSON.stringify(args) });
      return await r.text();
    },
    [action, args] as const,
  );

test("an umbrella has no Delete, and someone not on it can't delete or rename it", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const db = new PrismaClient();
  let umbrellaId = "";
  let plainId = "";
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const tester = await db.user.findUniqueOrThrow({ where: { email: "tester@example.com" } });
    const hub = await db.project.create({
      data: { key: `UM${TAG}`, name: `Umb ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }, { userId: tester.id, role: "TESTER" }] } },
    });
    const group = await db.projectGroup.create({ data: { name: `Umb ${TAG}`, hubProjectId: hub.id } });
    umbrellaId = group.id;
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
    plainId = (await db.projectGroup.create({ data: { name: `Plain ${TAG}` } })).id;
  } finally {
    await db.$disconnect();
  }

  await signIn(page, "admin@example.com", "Demo Admin");
  // Umbrella Settings → Rename: no Delete, a pointer to Archive instead.
  await page.goto(`/g/${umbrellaId}/settings`);
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("umbrella-archive-hint")).toHaveText("To put this umbrella away, use Archive in its Settings.");
  await expect(dialog.getByRole("button", { name: "Delete group…" })).toHaveCount(0);
  // Renaming still works for someone the Roles card allows; the request gives us updateGroup's id.
  const renamed = page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await dialog.getByLabel("Group name").fill(`Umb ${TAG} renamed`);
  await dialog.getByRole("button", { name: "Save" }).click();
  const updateAction = (await renamed).headers()["next-action"];
  await expect(dialog).toBeHidden();

  // A plain group still has Delete group; its request gives us deleteGroup's id.
  await page.goto(`/g/${plainId}`);
  await page.getByRole("button", { name: "Edit group" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete group…" }).click();
  const deleted = page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await page.getByRole("dialog").getByRole("button", { name: "Delete group", exact: true }).click();
  const deleteAction = (await deleted).headers()["next-action"];
  await expect(page).toHaveURL(/\/$/);

  // Even an admin calling deleteGroup on the umbrella is turned away.
  expect(await callAction(page, deleteAction, [umbrellaId])).toContain("Umbrellas can't be deleted");

  // Someone who isn't on the umbrella (a Lead elsewhere) can't delete or rename it by calling the actions.
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const outsider = await ctx.newPage();
  await signIn(outsider, "lead@example.com", "Dana Lead");
  expect(await callAction(outsider, deleteAction, [umbrellaId])).toContain("Umbrellas can't be deleted");
  const answer = await callAction(outsider, updateAction, [umbrellaId, { name: `Taken ${TAG}`, description: "", projectIds: [] }]);
  expect(answer).not.toContain('"ok":true');
  await ctx.close();

  const after = new PrismaClient();
  try {
    const g = await after.projectGroup.findUnique({ where: { id: umbrellaId } });
    expect(g?.name).toBe(`Umb ${TAG} renamed`);
    expect(await after.projectGroup.findUnique({ where: { id: plainId } })).toBeNull();
  } finally {
    await after.$disconnect();
  }
});

test("I saw it again adds only a row to the Jira bug's table and keeps edits made in Jira", async ({ page }) => {
  test.setTimeout(180_000);
  const KEY = `SA${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Seen again ${TAG}`, KEY);
  await page.goto(`/p/${KEY}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("QA");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByTestId("jira-reporter-check")).toBeVisible();

  // A bug already in Jira with a Repro history table, which someone then edited in Jira.
  const cellRow = (cells: string[], header = false) => ({
    type: "tableRow",
    content: cells.map((t) => ({ type: header ? "tableHeader" : "tableCell", attrs: {}, content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] })),
  });
  const description = {
    type: "doc",
    version: 1,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Edited in Jira: only on iPad" }] },
      { type: "paragraph", content: [{ type: "text", text: "Repro history", marks: [{ type: "strong" }] }] },
      { type: "table", attrs: {}, content: [cellRow(["Who", "Repros"], true), cellRow(["Demo Admin", "3/3"])] },
      { type: "paragraph", content: [{ type: "text", text: "Filed from Flaw Patrol: " }, { type: "text", text: "run R1", marks: [{ type: "link", attrs: { href: "http://localhost/p/x/runs/1" } }] }] },
    ],
  };
  const made = await fetch(`${JIRA}/rest/api/3/issue`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from("qa-bot@example.com:secret-token").toString("base64")}` }, body: JSON.stringify({ fields: { project: { key: "QA" }, summary: `Pay closes ${TAG}`, description } }) });
  const { key } = (await made.json()) as { key: string };

  const db = new PrismaClient();
  try {
    const project = await db.project.findUniqueOrThrow({ where: { key: KEY } });
    await db.defect.create({
      data: {
        projectId: project.id,
        number: 1,
        title: `Pay closes ${TAG}`,
        externalKey: key,
        externalUrl: `${JIRA}/browse/${key}`,
        templateName: "Crash or freeze",
        answers: [{ id: "h1", heading: "Repro history", source: "table", text: "", columns: [{ name: "Who", fill: "who" }, { name: "Repros", fill: "write" }], rows: [["Demo Admin", "3/3"]], growing: true }],
      },
    });
    await db.project.update({ where: { id: project.id }, data: { defectSeq: 1 } });
  } finally {
    await db.$disconnect();
  }

  await page.goto(`/p/${KEY}/bugs`);
  await page.getByRole("button", { name: /What was reported \(Crash or freeze\) · Repro history: 1 row/ }).click();
  const answers = page.getByTestId("bug-answers");
  await answers.getByRole("button", { name: "I saw it again" }).click();
  await answers.getByTestId("bug-rows").getByTestId("new-row").getByLabel("Repros").fill("1/3");
  await answers.getByRole("button", { name: "Save row" }).click();
  await expect(answers).toContainText("Row added.");

  const issues = (await (await fetch(`${JIRA}/__issues`)).json()) as Record<string, { description: { content: { type: string; content?: unknown[] }[] } }>;
  const now = issues[key].description;
  const words = JSON.stringify(now);
  expect(words).toContain("Edited in Jira: only on iPad");
  expect(words).toContain("http://localhost/p/x/runs/1");
  expect(now.content).toHaveLength(4);
  const table = now.content.find((n) => n.type === "table")!;
  expect(table.content).toHaveLength(3);
  expect(JSON.stringify(table.content![2])).toContain("1/3");
});

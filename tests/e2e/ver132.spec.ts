import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { backToRun, signIn } from "./auth";

// ver_132: email digests. An email group made in Workspace settings, an umbrella's Email digests
// sending to it, a run that finishes emailing the testers, the group's person and its outside
// address (once each), the Stop link, Emails I get, Send me a sample, and deleting the group.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Digests ${TAG}`;
const HUB = `DG${TAG}`;
const CYCLE = `DC${TAG}`;
const GROUP = `Leads ${TAG}`;
const OUTSIDE = `producer-${TAG.toLowerCase()}@example.com`;
const SSO = `http://localhost:${process.env.MOCK_SSO_PORT ?? 3195}`;
let groupId = "";

type Sent = { to: string[]; subject: string; raw: string };
const mails = async () => (await (await fetch(`${SSO}/__mail`)).json()) as Sent[];

/** Headers say =?UTF-8?Q?…?= or =?UTF-8?B?…?= for anything outside plain ASCII. */
function decodeHeader(v: string) {
  return v.replace(/=\?utf-8\?([qb])\?([^?]*)\?=\s*/gi, (_, enc: string, s: string) =>
    enc.toLowerCase() === "b" ? Buffer.from(s, "base64").toString("utf8") : Buffer.from(s.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8"),
  );
}
/** The readable text of a message: quoted-printable undone, and base64 parts decoded. */
function body(raw: string) {
  const qp = Buffer.from(raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
  const b64 = [...raw.matchAll(/(?:^[A-Za-z0-9+/=]{40,}\n)+/gm)].map((m) => Buffer.from(m[0].replace(/\s/g, ""), "base64").toString("utf8")).join("\n");
  return `${qp}\n${b64}`;
}
const subjectOf = (m: Sent) => decodeHeader(/^Subject: ((?:.*)(?:\n[ \t].*)*)/im.exec(m.raw)?.[1]?.replace(/\n[ \t]+/g, " ") ?? m.subject);

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.workspace.upsert({
      where: { id: 1 },
      create: { id: 1, mailMode: "smtp", mailHost: "localhost", mailPort: 3194, mailSecurity: "none", mailFromAddress: "flaw-patrol@example.com" },
      update: { mailMode: "smtp", mailHost: "localhost", mailPort: 3194, mailSecurity: "none", mailUser: "", mailPassEncrypted: null, mailFromAddress: "flaw-patrol@example.com" },
    });
    await db.user.updateMany({ where: { email: { in: ["admin@example.com", "lead@example.com"] } }, data: { digestPrefs: {} } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: `${NAME} case library`, caseSeq: 2, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id } })).id;
    await db.project.update({ where: { id: hub.id }, data: { groupId } });
    const cycle = await db.project.create({ data: { key: CYCLE, name: `${NAME} iOS`, platform: "iOS", groupId, runSeq: 2, members: { create: { userId: admin.id, role: "ADMIN", fromUmbrella: true } } } });
    const steps = [{ number: "1", action: "Open the app", expected: "It opens" }];
    const cases = [];
    for (const [i, title] of [`Log in with Apple ${TAG}`, `Check out ${TAG}`].entries())
      cases.push(await db.testCase.create({ data: { projectId: hub.id, number: i + 1, title, versions: { create: { version: 1, title, preconditions: "", priority: "HIGH", type: "MANUAL", tags: [], steps } } } }));
    // An earlier finished run where both passed: failing now is a regression, and the pass rate drops.
    const earlier = await db.testRun.create({
      data: { projectId: cycle.id, number: 1, name: "Smoke test", state: "COMPLETED", completedAt: new Date(Date.now() - 86_400_000), createdAt: new Date(Date.now() - 90_000_000), entries: { create: cases.map((c, i) => ({ caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: "HIGH" as const, steps, status: "PASSED" as const })) } },
      include: { entries: true },
    });
    for (const e of earlier.entries) await db.testResult.create({ data: { entryId: e.id, runId: earlier.id, caseId: e.caseId, caseVersion: 1, status: "PASSED", stepResults: [], testerId: admin.id, testerName: "Demo Admin", createdAt: new Date(Date.now() - 86_400_000) } });
    await db.testRun.create({
      data: { projectId: cycle.id, number: 2, name: "Smoke test", build: "4.2.0", createdById: admin.id, createdBy: "Demo Admin", entries: { create: cases.map((c, i) => ({ caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: "HIGH" as const, steps })) } },
    });
  } finally {
    await db.$disconnect();
  }
});

test.afterAll(async () => {
  const db = new PrismaClient();
  try {
    await db.workspace.update({ where: { id: 1 }, data: { mailMode: "off", mailHost: "", mailFromAddress: "" } });
    await db.user.updateMany({ where: { email: { in: ["admin@example.com", "lead@example.com"] } }, data: { digestPrefs: {} } });
  } finally {
    await db.$disconnect();
  }
});

async function mark(page: Page, status: "Passed" | "Failed") {
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: status }).click();
}

test("email digests: a group, a finished run, the Stop link, Emails I get and a sample", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await fetch(`${SSO}/__mail`, { method: "DELETE" });

  // Workspace settings → Email groups: one person and one outside address.
  await page.goto("/workspace#email-groups");
  const groups = page.getByRole("region", { name: "Email groups" });
  await groups.getByRole("button", { name: "＋ New email group" }).click();
  const editor = groups.getByRole("group", { name: "New email group" });
  await editor.getByLabel("Name").fill(GROUP);
  await editor.getByLabel("Add a person or address").fill("lead@ex");
  await editor.getByRole("button", { name: /lead@example\.com/ }).click();
  await editor.getByLabel("Add a person or address").fill(OUTSIDE.toUpperCase());
  await editor.getByLabel("Add a person or address").press("Enter");
  await expect(editor.getByText(OUTSIDE)).toBeVisible();
  await editor.getByRole("button", { name: "Save group" }).click();
  await expect(groups.getByRole("listitem").filter({ hasText: GROUP })).toContainText("not used yet");

  // Umbrella Settings → Email digests: off until set up, then sending to the group as well.
  await page.goto(`/g/${groupId}/settings`);
  const row = page.locator("#row-email-digests");
  await expect(row).toContainText("Off. Email a summary when a run finishes or a bug bash ends.");
  await row.getByRole("button", { name: "Set up" }).click();
  const card = page.getByRole("region", { name: "Email digests" });
  await expect(card.getByLabel("People who tested in the run or joined the bug bash")).toBeChecked();
  await expect(card.getByLabel("Whoever started it")).toBeChecked();
  await card.getByLabel("Add a group or an email address").fill(TAG);
  await card.getByRole("button", { name: `Add ${GROUP}` }).click();
  await expect(card.getByRole("button", { name: new RegExp(`${GROUP} \\(2\\)`) })).toBeVisible();
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card.getByText("Saved. Email digests are on.")).toBeVisible();
  await expect(row).toContainText(`Run finished, Bug bash ended and Release testing done to people who tested or joined, whoever started it and ${GROUP}`);

  // Finish the run: one regression, one pass.
  await page.goto(`/p/${CYCLE}/runs/2/execute`);
  await mark(page, "Failed");
  await page.getByRole("button", { name: "Save and next" }).click();
  await expect(page.getByRole("heading", { name: `Check out ${TAG}` })).toBeVisible();
  await mark(page, "Passed");
  await page.getByRole("button", { name: "Save and finish" }).click();
  await backToRun(page);

  // One email each: the tester (who also started it), the group's person and its outside address.
  await expect.poll(async () => (await mails()).map((m) => m.to.join()).sort(), { timeout: 30_000 }).toEqual(["admin@example.com", "lead@example.com", OUTSIDE].sort());
  const sent = await mails();
  for (const m of sent) expect(subjectOf(m)).toBe(`Smoke test on ${NAME} iOS finished: 50% pass, 1 regression`);
  const mine = body(sent.find((m) => m.to.includes("admin@example.com"))!.raw);
  expect(mine).toContain(`Log in with Apple ${TAG} (REGRESSION)`);
  expect(mine).toContain("2 run · 1 passed · 1 failed · 0 blocked · 50% pass · ▼ 50% vs last run");
  expect(mine).toContain("You get this because you tested in this run.");
  expect(mine).toContain("Stop run emails:");
  expect(body(sent.find((m) => m.to.includes("lead@example.com"))!.raw)).toContain(`You get this because you're in the ${GROUP} email group.`);
  const outside = body(sent.find((m) => m.to.includes(OUTSIDE))!.raw);
  expect(outside).not.toContain("Change which emails I get");
  const stop = /Stop these emails: (\S+)/.exec(outside)![1];

  // The Stop link asks first, works without signing in, and remembers the address.
  const stranger = await page.context().browser()!.newContext();
  const p2 = await stranger.newPage();
  // Links point at the Flaw Patrol that sent them; the test server is on 3100.
  const u = new URL(stop);
  await p2.goto(`http://localhost:3100${u.pathname}${u.search}`);
  await expect(p2.getByRole("heading", { name: "Stop run summary emails?" })).toBeVisible();
  await p2.getByRole("button", { name: "Stop these emails" }).click();
  await expect(p2.getByText("✓ Stopped. You won't get these emails from Flaw Patrol again.")).toBeVisible();
  await p2.goto("http://localhost:3100/stop-emails?t=forged.link");
  await expect(p2.getByRole("heading", { name: "This stop link doesn't work" })).toBeVisible();
  await stranger.close();
  const db = new PrismaClient();
  try {
    expect((await db.workspace.findUniqueOrThrow({ where: { id: 1 } })).digestStopped).toContain(OUTSIDE);
  } finally {
    await db.$disconnect();
  }

  // Your account → Emails I get: Runs to None saves at once.
  await page.goto("/account#emails");
  const prefs = page.locator("#emails");
  await expect(prefs.getByRole("radio", { name: "Runs I tested in" })).toBeChecked();
  await prefs.getByRole("radio", { name: "None" }).first().check();
  await expect(prefs.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(page.locator("#emails")).toContainText("No runs · Bashes I joined · release done on");

  // Send me a sample: the newest run, to me only.
  await fetch(`${SSO}/__mail`, { method: "DELETE" });
  await page.goto(`/g/${groupId}/settings`);
  await page.locator("#row-email-digests").getByRole("button", { name: "Change" }).click();
  await page.getByRole("region", { name: "Email digests" }).getByRole("button", { name: "Send me a sample" }).click();
  await expect(page.getByText("Sent a sample of Smoke test to admin@example.com.")).toBeVisible();
  await expect.poll(async () => (await mails()).map((m) => `${m.to.join()} ${subjectOf(m)}`)).toEqual([`admin@example.com Sample: Smoke test on ${NAME} iOS finished: 50% pass, 1 regression`]);

  // Deleting the group (admins only) says which umbrellas use it.
  await page.goto("/workspace#email-groups");
  const list = page.getByRole("region", { name: "Email groups" });
  await expect(list.getByRole("listitem").filter({ hasText: GROUP })).toContainText(`used by ${NAME}`);
  await list.getByRole("listitem").filter({ hasText: GROUP }).getByRole("button", { name: "Edit" }).click();
  await list.getByRole("button", { name: "Delete group" }).click();
  await expect(list.getByText(`Delete ${GROUP}? ${NAME} stop sending to it.`)).toBeVisible();
  await list.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(list.getByText(GROUP)).toHaveCount(0);
});

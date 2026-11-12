import { PrismaClient } from "@prisma/client";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { signIn } from "./auth";

// ver_164: share results with Qase, both ways, against the stand-in in mock-qase.mjs.
// Settings → Qase connects, Link cases links by title, and the test cycle's Qase bar syncs.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Qase ${TAG}`;
const CYCLE = `QW${TAG}`;
const QASE = "http://localhost:3192";
let groupId = "";
let entryOf: Record<string, string> = {};

const qaseState = async (request: APIRequestContext) => (await (await request.get(`${QASE}/__state`)).json()) as { runs: { id: number; title: string; cases: number[] }[]; results: { case_id: number; status: string; comment: string; run_id: number }[] };

test.beforeAll(async ({ request }) => {
  await request.post(`${QASE}/__reset`);
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 164 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const titles = ["Sign in with Google", "Pay with a saved card", "Crop the profile picture", "Login with Google SSO"];
    const hub = await db.project.create({ data: { key: `QH${TAG}`, name: NAME, caseSeq: titles.length, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const cases = await Promise.all(
      titles.map((title, i) =>
        db.testCase.create({ data: { projectId: hub.id, number: i + 1, title, versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags: [], steps: [{ kind: "step", action: "Do it", expected: "It works" }] } } } }),
      ),
    );
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web" }] } })).id;
    const web = await db.project.create({ data: { key: CYCLE, name: `${NAME} Web RC 1`, groupId, platform: "Web", runSeq: 1, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const run = await db.testRun.create({
      data: {
        projectId: web.id,
        number: 1,
        name: `Web pass ${TAG}`,
        createdBy: "Demo Admin",
        entries: { create: cases.map((c, i) => ({ caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: "MEDIUM" as const, steps: [{ kind: "step", action: "Do it", expected: "It works" }] })) },
      },
      include: { entries: true },
    });
    entryOf = Object.fromEntries(run.entries.map((e) => [e.title, e.id]));
  } finally {
    await db.$disconnect();
  }
});

test("connect Qase, link cases by title, and share results both ways", async ({ page, request }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");

  // 1. Settings → Qase: a wrong token says so; the right one lists the Qase projects.
  await page.goto(`/g/${groupId}/settings`);
  const row = page.locator("#row-qase");
  await expect(row.getByText("Not connected. Share test results with a Qase project, both ways.")).toBeVisible();
  await row.getByRole("button", { name: "Connect", exact: true }).click();
  await row.getByLabel("Qase API token").fill("qase_wrong");
  await row.getByRole("button", { name: "Check token and load projects" }).click();
  await expect(row.getByText("Qase didn't accept the API token")).toBeVisible();
  await row.getByLabel("Qase API token").fill("qase_good");
  await row.getByRole("button", { name: "Check token and load projects" }).click();
  await row.getByLabel("Qase project").selectOption("OKO");
  await expect(row.getByTestId("qase-send")).toBeChecked();
  await expect(row.getByTestId("qase-bring")).toBeChecked();
  await row.getByText(/How results match up/).click();
  await expect(row.getByLabel("Retest")).toHaveValue("blocked");
  await row.getByRole("button", { name: "Save and connect" }).click();
  await expect(row.getByText("✓ Connected to Qase project OKO (OKO).")).toBeVisible();
  await expect(row.getByText("✓ Connected", { exact: true })).toBeVisible();
  await expect(row.getByTestId("qase-hook")).toContainText("/api/qase/hook/");
  const hook = (await row.getByTestId("qase-hook").textContent())!.trim();

  // 2. Link cases: three titles match Qase; the fourth gets a pick, closest first.
  await row.getByTestId("qase-link-cases").click();
  await expect(page.getByRole("heading", { name: "Link cases to Qase" })).toBeVisible();
  await expect(page.getByTestId("qase-link-summary")).toContainText("3 of 4 linked");
  await expect(page.getByTestId("qase-link-summary")).toContainText("3 just linked by title.");
  const pick = page.getByTestId("qase-pick");
  const select = pick.getByLabel("Qase case for Login with Google SSO");
  // Sign in with Google (OKO-12) is taken, so Microsoft is the closest one left.
  await expect(select.locator("option").nth(1)).toHaveText("OKO-13 Sign in with Microsoft");
  await select.selectOption({ label: "OKO-13 Sign in with Microsoft" });
  await expect(page.getByTestId("qase-link-summary")).toContainText("4 of 4 linked");
  await expect(page.getByText("Nothing to pick. Every case is linked or not shared on purpose.")).toBeVisible();

  // 3. The test cycle's Qase bar: Sync now makes a Qase run named after the cycle.
  await page.goto(`/p/${CYCLE}`);
  const bar = page.getByTestId("qase-bar");
  await expect(bar).toContainText("Shares with Qase.");
  await bar.getByRole("button", { name: "Sync now" }).click();
  await expect(bar.getByText("Synced with Qase: 0 sent, 0 new from Qase.")).toBeVisible();
  await expect(bar).toContainText(`✓ Shared with Qase run “${NAME} Web RC 1”`);
  let qase = await qaseState(request);
  const made = qase.runs.find((r) => r.title === `${NAME} Web RC 1`)!;
  expect(made.cases.sort((a, b) => a - b)).toEqual([12, 13, 51, 88]);

  // 4. Flaw Patrol → Qase: a saved result is sent once, marked as coming from Flaw Patrol.
  const db = new PrismaClient();
  try {
    const e = await db.runEntry.findUniqueOrThrow({ where: { id: entryOf["Sign in with Google"] } });
    await db.testResult.create({ data: { entryId: e.id, runId: e.runId, caseId: e.caseId, caseVersion: 1, status: "RETEST", stepResults: [{ status: "RETEST", actual: "" }], comment: "Spinner never stops", testerName: "Demo Admin" } });
    await db.runEntry.update({ where: { id: e.id }, data: { status: "RETEST", lastTestedAt: new Date() } });
  } finally {
    await db.$disconnect();
  }
  await bar.getByRole("button", { name: "Sync now" }).click();
  await expect(bar.getByText("Synced with Qase: 1 sent, 0 new from Qase.")).toBeVisible();
  qase = await qaseState(request);
  expect(qase.results).toHaveLength(1);
  expect(qase.results[0]).toMatchObject({ case_id: 12, status: "blocked", run_id: made.id, comment: "From Flaw Patrol · Demo Admin\n\nSpinner never stops" });
  // Sent once: the next sync doesn't send it again, and doesn't bring it back.
  await bar.getByRole("button", { name: "Sync now" }).click();
  await expect(bar.getByText("Synced with Qase: 0 sent, 0 new from Qase.")).toBeVisible();
  expect((await qaseState(request)).results).toHaveLength(1);

  // 5. Qase → Flaw Patrol: a result saved in Qase comes into the run with a Qase tag.
  const froze = (await (await request.post(`${QASE}/__result`, { data: { run_id: made.id, case_id: 88, status: "failed", comment: "Card form froze" } })).json()) as { hash: string };
  // An old Qase result for a case tested here since: newest wins, so it stays out.
  await request.post(`${QASE}/__result`, { data: { run_id: made.id, case_id: 12, status: "passed", end_time: "2020-01-01 10:00:00" } });
  await bar.getByRole("button", { name: "Sync now" }).click();
  await expect(bar.getByText("Synced with Qase: 0 sent, 1 new from Qase.")).toBeVisible();
  await page.goto(`/p/${CYCLE}/runs/1`);
  const paid = page.getByRole("row").filter({ hasText: "Pay with a saved card" }).or(page.locator("li").filter({ hasText: "Pay with a saved card" })).first();
  await expect(paid.getByTestId("from-qase")).toBeVisible();
  await expect(paid.getByText("Failed", { exact: true })).toBeVisible();
  await expect(page.getByTestId("from-qase")).toHaveCount(1);

  // ver_228: each Qase step's result comes in. Qase said Passed but its step failed: Failed here.
  await request.post(`${QASE}/__result`, { data: { run_id: made.id, case_id: 51, status: "passed", steps: [{ status: 2, comment: "Crop box is stuck" }] } });
  // A Qase result edited after it came in (now passed) updates the result it made here.
  await request.post(`${QASE}/__result`, { data: { hash: froze.hash, status: "passed", steps: [{ status: 1, comment: "" }] } });
  await page.goto(`/p/${CYCLE}`);
  await bar.getByRole("button", { name: "Sync now" }).click();
  await expect(bar.getByText("Synced with Qase: 0 sent, 2 new from Qase.")).toBeVisible();
  await page.goto(`/p/${CYCLE}/runs/1`);
  const crop = page.getByRole("row").filter({ hasText: "Crop the profile picture" }).or(page.locator("li").filter({ hasText: "Crop the profile picture" })).first();
  await expect(crop.getByTestId("from-qase")).toBeVisible();
  await expect(crop.getByText("Failed", { exact: true })).toBeVisible();
  await expect(paid.getByText("Passed", { exact: true })).toBeVisible();
  await expect(page.getByTestId("from-qase")).toHaveCount(2);
  const db2 = new PrismaClient();
  try {
    const step = (await db2.testResult.findFirstOrThrow({ where: { entryId: entryOf["Crop the profile picture"], fromQase: true } })).stepResults as { status: string; actual: string }[];
    expect(step).toEqual([{ status: "FAILED", actual: "Crop box is stuck" }]);
  } finally {
    await db2.$disconnect();
  }

  // 6. Qase's webhook link: the right secret is accepted, anything else is Not found.
  expect((await request.post(hook, { data: { event_name: "result.created" } })).status()).toBe(200);
  expect((await request.post(hook.replace(/hook\/.*/, "hook/not-the-right-secret-123"), { data: {} })).status()).toBe(404);
});

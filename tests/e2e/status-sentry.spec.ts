import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_258: Status's Sentry card sorts errors by build. Each build being tested (results in the
// last 7 days) gets a row with its RC tag, new errors, and how many are already in bugs. The card
// is red only for new errors not in a bug yet. Other builds and No build cover the last day, and a
// run with no build is left out with an Add its build link. Sentry is the stand-in in mock-sentry.mjs.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Sentry builds ${TAG}`;
const BUILD = `24.0.${Date.now() % 100000}`;

/** Seals the token the way src/lib/crypto.ts does, with the server's AUTH_SECRET. */
function seal(plain: string) {
  const env = (() => {
    try {
      return readFileSync(".env", "utf8");
    } catch {
      return "";
    }
  })();
  const secret = process.env.AUTH_SECRET ?? env.match(/^AUTH_SECRET="?([^"\n]*)"?/m)?.[1] ?? "";
  const key = createHash("sha256").update(`secret-box:${secret}`).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

let groupId = "";
let failedResult = "";
let projectId = "";
let adminId = "";

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    adminId = admin.id;
    const hub = await db.project.create({ data: { key: `SB${TAG}`, name: NAME, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Unreal", suiteIds: [] }] } })).id;
    const p = await db.project.create({ data: { key: `SU${TAG}`, name: `${NAME} Unreal RC 24`, groupId, platform: "Unreal", rcName: "RC 24", members: { create: { userId: admin.id, role: "ADMIN" } } } });
    projectId = p.id;
    await db.sentryConfig.create({ data: { projectId: hub.id, baseUrl: "http://localhost:3193", org: "acme", tokenEncrypted: seal("good-token"), projects: [{ id: "11", slug: "mobile-ios" }], buildField: "build" } });
    const c = await db.testCase.create({ data: { projectId: p.id, number: 1, title: "Open the map" } });
    const run = async (number: number, build: string, at: Date) => {
      const r = await db.testRun.create({ data: { projectId: p.id, number, name: `RC 24 pass ${number}`, build, release: "RC 24", createdAt: at } });
      const e = await db.runEntry.create({ data: { runId: r.id, caseId: c.id, caseVersion: 1, position: 0, title: c.title, priority: "MEDIUM", steps: [], status: "FAILED" } });
      return db.testResult.create({
        data: {
          entryId: e.id,
          runId: r.id,
          caseId: c.id,
          caseVersion: 1,
          status: "FAILED",
          stepResults: [],
          testerName: "Demo Admin",
          createdAt: at,
          sentry: [{ id: "9001", shortId: "APP-IOS-3F2", title: "TypeError", url: "http://localhost:3193/issues/9001/", project: "mobile-ios", count: 14, firstSeen: at.toISOString(), fresh: true, frames: [], release: "", environment: "" }],
        },
      });
    };
    // Being tested: results today. Not being tested: results 10 days ago. And a run with no build.
    failedResult = (await run(1, BUILD, new Date())).id;
    await run(2, "1.0.0", new Date(Date.now() - 10 * 86_400_000));
    await run(3, "", new Date());
  } finally {
    await db.$disconnect();
  }
});

test("the Sentry card sorts errors by build, and goes green once they're in a bug", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${groupId}/status`);

  // Red: one new error in the build being tested, not in a bug yet.
  await expect(page.getByTestId("status-summary")).toHaveText("1 thing needs a look");
  const card = page.getByTestId("status-card-sentry");
  await expect(card.getByRole("heading", { name: "Sentry · by build" })).toBeVisible();
  await expect(card).toContainText(`1 new error not in a bug yet in build ${BUILD}.`);
  const rows = card.getByTestId("sentry-build-row");
  await expect(rows).toHaveCount(1);
  const row = rows.first();
  await expect(row).toContainText(`Build ${BUILD}`);
  await expect(row).toContainText("Unreal");
  await expect(row.getByText("RC 24", { exact: true })).toBeVisible();
  await expect(row).toContainText("1 new error");
  await expect(row).toContainText("1 not in a bug yet");
  await expect(row).toContainText("98.6% of sessions had no crash");
  await expect(row).toContainText(`Sentry calls it mobile-ios@${BUILD}+812`);
  await expect(row.getByRole("link", { name: "Open in Sentry ↗" })).toHaveAttribute("href", /first-release/);
  // The old build (tested 10 days ago) isn't on the card.
  await expect(card).not.toContainText("Build 1.0.0");

  // Everything else in the last day, with links to Sentry.
  await expect(card.getByTestId("sentry-other")).toContainText("Other builds");
  await expect(card.getByTestId("sentry-other")).toContainText("2 errors");
  await expect(card.getByTestId("sentry-none")).toContainText("No build");
  await expect(card.getByTestId("sentry-none")).toContainText("1 error");
  await expect(card.getByTestId("sentry-none").getByRole("link", { name: "See them in Sentry ↗" })).toHaveAttribute("href", /has%3Arelease/);

  // The run with no build is left out, with a way to add it.
  await expect(card.getByTestId("sentry-missing")).toContainText("The newest Unreal RC 24 run has no build, so it's left out.");
  const add = card.getByTestId("sentry-missing").getByRole("link", { name: "Add its build" });
  await expect(add).toHaveAttribute("href", `/p/SU${TAG}/runs/3`);

  // Write a bug opens the same form, with the build filled in.
  await row.getByRole("link", { name: "Write a bug" }).click();
  const box = page.getByRole("dialog", { name: "Write a bug" });
  await expect(box.getByLabel("Summary")).toHaveValue(`New Sentry errors in build ${BUILD} (Unreal RC 24)`);

  // Once the error is in a bug, the card goes green (after the minute it keeps an answer, or Refresh).
  const db = new PrismaClient();
  try {
    const bug = await db.defect.create({ data: { projectId, number: 1, title: "Map crashes", createdById: adminId, createdBy: "Demo Admin" } });
    await db.defectLink.create({ data: { defectId: bug.id, resultId: failedResult } });
  } finally {
    await db.$disconnect();
  }
  await page.goto(`/g/${groupId}/status`);
  await page.waitForTimeout(10_500);
  await page.getByTestId("status-refresh").click();
  await expect(page.getByTestId("status-summary")).toHaveText("All good");
  const green = page.getByTestId("status-card-sentry");
  await expect(green).toContainText("New errors in the builds you're testing are all in bugs.");
  await expect(green.getByTestId("sentry-build-row")).toContainText("It's already in a bug");
  await expect(green.getByRole("link", { name: "Write a bug" })).toHaveCount(0);
});

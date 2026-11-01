import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_124 (persona audit #4 to #10): Report bug for case starts from what failed, a failed step's
// note stays in view, Stop testing, Bring in results, the Reports summary, the Viewer note with
// Ask for Member access, and bug bashes that don't add cases or count as runs.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `PA${TAG}`;
const NAME = `Persona ${TAG}`;
const VIEWER = `vic.${TAG.toLowerCase()}@example.com`;
const ids = { entry: "" };

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 124 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const vic = await db.user.upsert({ where: { email: VIEWER }, create: { email: VIEWER, name: `Vic ${TAG}`, whatsNewSeen: 999 }, update: {} });
    const project = await db.project.create({
      data: { key: KEY, name: NAME, caseSeq: 1, runSeq: 1, members: { create: [{ userId: admin.id, role: "ADMIN" }, { userId: vic.id, role: "VIEWER" }] } },
    });
    const title = "Customer can log in with email and password";
    const steps = [
      { number: "1", action: "Open /login", expected: "The sign-in form shows" },
      { number: "2", action: "Enter the customer email and password, press Sign in", expected: "Redirected to the home page, signed in" },
      { number: "3", action: "Open Account", expected: "The account page shows the customer's name" },
    ];
    const c = await db.testCase.create({ data: { projectId: project.id, number: 1, title, versions: { create: { version: 1, title, preconditions: "", priority: "HIGH", type: "MANUAL", tags: [], steps } } } });
    const run = await db.testRun.create({
      data: { projectId: project.id, number: 1, name: "Login check", build: "2.1.0 (412)", environment: "Staging", createdBy: "Demo Admin", entries: { create: [{ caseId: c.id, caseVersion: 1, position: 0, title, priority: "HIGH", steps }] } },
      include: { entries: true },
    });
    ids.entry = run.entries[0].id;
  } finally {
    await db.$disconnect();
  }
});

test("a failed step stays in view, and Report bug for case starts from it", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${KEY}/runs/1/execute?entry=${ids.entry}`);
  await expect(page.getByText("Mark a step to start testing. Your teammates will see you're on this case.")).toBeVisible();

  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" }).click();
  await page.getByRole("group", { name: "Step 2 status" }).getByRole("button", { name: "Failed" }).click();
  // Clicking Failed puts the cursor in the note box, and it's on screen.
  const note = page.getByLabel("Step 2 actual result");
  await expect(note).toBeFocused();
  await expect(note).toBeInViewport();
  await note.fill("Stays on the login page, no error shown");
  await expect(page.getByRole("button", { name: "Go to step 2" })).toBeVisible();

  // Claiming is in plain words, with what Stop testing does written under it.
  await expect(page.getByRole("button", { name: "Stop testing" })).toBeVisible();
  await expect(page.getByTestId("stop-testing-help")).toContainText("Your marks so far are kept");

  // Whole-case bug: the summary comes from step 2, not the case title, and What happened is filled in.
  await page.getByRole("button", { name: "Report bug for case" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Summary")).toHaveValue("Customer can log in with email and password: Enter the customer email and password, press Sign in: Stays on the login page, no error shown");
  const happened = dialog.getByLabel("What happened");
  await expect(happened).toHaveValue(/Build: 2\.1\.0 \(412\)/);
  await expect(happened).toHaveValue(/Expected: Redirected to the home page, signed in/);
  await expect(happened).toHaveValue(/Actual: Stays on the login page, no error shown/);
  await dialog.getByRole("button", { name: "Save bug" }).click();
  await expect(dialog).toBeHidden();

  await page.goto(`/p/${KEY}/bugs`);
  await page.getByText("What happened", { exact: true }).first().click();
  await expect(page.getByText(/Actual: Stays on the login page/)).toBeVisible();
});

test("Test runs has one Bring in results menu, and Reports opens with a summary", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${KEY}/runs`);
  await expect(page.getByRole("link", { name: "Import a run" })).toHaveCount(0);
  await page.getByRole("button", { name: "Bring in results" }).click();
  await expect(page.getByRole("menuitem", { name: /Automated test results/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /Results from a spreadsheet/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/runs/import`));

  await page.goto(`/p/${KEY}/reports?range=all`);
  await expect(page.getByTestId("report-summary-line")).toHaveText(/^All time: 1 run\./);
  await expect(page.getByTestId("tile-notrun")).toContainText("in open runs");
  await expect(page.getByRole("button", { name: "Copy summary" })).toBeVisible();
  await expect(page.getByRole("link", { name: "People", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Testers", exact: true })).toHaveCount(0);
});

async function startBash(page: Page) {
  await page.goto(`/p/${KEY}/bashes`);
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Name").fill(`Checkout ${TAG}`);
  await box.getByLabel("Add an area").fill("Cart");
  await box.getByLabel("Add an area").press("Enter");
  await box.getByRole("button", { name: "Start bug bash" }).click();
  await expect(box.getByRole("link", { name: "Open the bash" })).toBeVisible();
}

test("a Viewer is told so and can ask for Member access; a bug bash adds no cases or runs", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await signIn(v, VIEWER, `Vic ${TAG}`);
  await v.goto(`/p/${KEY}/bashes`);
  const viewerNote = v.getByTestId("viewer-note");
  await expect(viewerNote).toContainText(`You're a Viewer in ${NAME}.`);
  await expect(viewerNote).toContainText("Demo Admin");
  await expect(v.getByText("When someone starts a bug bash, you can join it here.")).toBeVisible();
  await viewerNote.getByRole("button", { name: "Ask for Member access" }).click();
  await expect(viewerNote).toContainText("You asked for Member access.");

  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${KEY}/settings`);
  await expect(page.getByRole("region", { name: "Asking to join" })).toContainText(`Vic ${TAG} is a Viewer and asks for Member access in ${NAME}`);

  // ✕ hides the note, and it stays hidden.
  await viewerNote.getByRole("button", { name: "Hide this note" }).click();
  await v.reload();
  await expect(v.getByRole("heading", { name: "Bug bashes" })).toBeVisible();
  await expect(v.getByTestId("viewer-note")).toHaveCount(0);
  await ctx.close();

  // A live bug bash: Test cases and Runs in progress don't change, and it gets its own tile.
  await startBash(page);
  await page.goto(`/p/${KEY}`);
  await expect(page.getByRole("main").getByRole("link", { name: /^Runs in progress\s*1/ })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: /^Test cases\s*1/ })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: /Live bug bash\s*1\s*Checkout/ })).toBeVisible();
  await page.goto(`/p/${KEY}/charters`);
  await expect(page.getByText("Bug bash: Cart")).toHaveCount(0);
});

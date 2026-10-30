import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";
import { WHATS_NEW } from "../../src/content/whats-new";

// ver_88: the What's new window after sign-in, the bug box's + Add menu (captures
// from other steps, Take screenshot, Upload a file), and GitHub repos with no
// workflow saved showing the picker.

test.use({
  launchOptions: {
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    args: ["--auto-accept-this-tab-capture", "--auto-select-desktop-capture-source=Flaw Patrol", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function setSeen(email: string, value: number | null) {
  const db = new PrismaClient();
  try {
    await db.user.update({ where: { email }, data: { whatsNewSeen: value } });
    return (await db.user.findUniqueOrThrow({ where: { email } })).whatsNewSeen;
  } finally {
    await db.$disconnect();
  }
}

test("What's new opens once after a new version, filtered by role, and can be opened again", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  // This test is about the window itself, so stop signIn's helper from closing it.
  await page.removeLocatorHandler(page.getByTestId("whats-new-window"));
  await setSeen("admin@example.com", null);
  await page.goto("/");
  const win = page.getByTestId("whats-new-window");
  await expect(win).toBeVisible();
  await expect(win.getByRole("heading", { name: "What's new in Flaw Patrol" })).toBeVisible();
  // The window shows the newest versions (up to five); older ones fold under the newest.
  await expect(win).toContainText(`Version ${WHATS_NEW[0].version}`);
  await win.locator("summary", { hasText: "Version 92" }).click();
  // Workspace admins see Workspace settings (ver_92).
  await expect(win.getByText("Company sign-in, invite emails, the activity log")).toBeVisible();
  // Esc counts as seen, like Got it.
  await page.keyboard.press("Escape");
  await expect(win).toBeHidden();
  await expect.poll(async () => (await setSeenRead("admin@example.com")) ?? 0).toBeGreaterThanOrEqual(88);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.getByTestId("whats-new-window")).toHaveCount(0);

  // Reopen any time from the account menu.
  await page.getByTitle(/your account/).click();
  await page.getByRole("menuitem", { name: "What's new" }).click();
  await expect(page).toHaveURL(/\/whats-new$/);
  await expect(page.getByRole("region", { name: "Version 88" })).toContainText("No wrong reporter warning when the Jira token is yours");

  // A tester doesn't see admin-only changes; Got it closes it.
  await page.context().clearCookies();
  await signIn(page, "tester@example.com", "Sam Tester");
  await setSeen("tester@example.com", 91);
  await page.goto("/");
  await expect(win).toBeVisible();
  await expect(win.getByText("Bug bashes").first()).toBeVisible();
  // Workspace and admin-only changes are left out for a tester (version 92 had only those).
  await expect(win.locator("summary", { hasText: "Version 92" })).toHaveCount(0);
  await expect(win.getByText("Company sign-in, invite emails, the activity log")).toHaveCount(0);
  await expect(win.getByText("Once email is set up, adding someone emails them an invite")).toHaveCount(0);
  await win.getByRole("button", { name: "Got it" }).click();
  await expect(win).toBeHidden();
  await expect.poll(async () => await setSeenRead("tester@example.com")).toBe(WHATS_NEW[0].version);
});

// Whatever happens above, don't leave the window open for the specs that run after this one.
test.afterAll(async () => {
  for (const email of ["admin@example.com", "tester@example.com"]) await setSeen(email, WHATS_NEW[0].version);
});

async function setSeenRead(email: string) {
  const db = new PrismaClient();
  try {
    return (await db.user.findUniqueOrThrow({ where: { email } })).whatsNewSeen;
  } finally {
    await db.$disconnect();
  }
}

test("the bug box's + Add menu brings in other steps' files, takes a screenshot and uploads", async ({ page }) => {
  test.setTimeout(240_000);
  const KEY = `BC${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Captures ${TAG}`, KEY);
  await page.goto(`/p/${KEY}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("QA");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText("Connected as QA Bot.")).toBeVisible();

  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Checkout");
  await page.getByLabel("Step 1 action").fill("Open the cart");
  await page.getByRole("button", { name: "+ Add step" }).click();
  await page.getByLabel("Step 2 action").fill("Pay");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("All");
  await page.getByRole("button", { name: /^Add all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Start test run" }).click();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Checkout", level: 1 })).toBeVisible();

  // A screenshot on step 1, pasted in as a file.
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Failed" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach file" }).first().click();
  await (await chooser).setFiles({ name: "cart-empty.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("link", { name: "cart-empty.png" })).toBeVisible();

  // File a bug from step 2: step 1's screenshot is offered under From this case.
  await page.getByRole("group", { name: "Step 2 status" }).getByRole("button", { name: "Failed" }).click();
  await page.getByLabel("Step 2 actual result").fill("Pay does nothing");
  await page.getByRole("button", { name: "Report bug in Jira" }).nth(1).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Attach to the Jira issue")).toBeVisible();
  await expect(dialog.getByTestId("bug-file")).toHaveCount(0);
  await dialog.getByRole("button", { name: "+ Add ▾" }).click();
  const menu = dialog.getByRole("menu", { name: "+ Add" });
  await expect(menu.getByText("FROM THIS CASE")).toBeVisible();
  await expect(menu.getByRole("checkbox", { name: /cart-empty\.png/ })).toBeChecked();
  await expect(menu).toContainText("Step 1");
  await menu.getByRole("button", { name: "Add 1" }).click();
  await expect(menu).toBeHidden();
  const picked = dialog.getByTestId("bug-file").filter({ hasText: "cart-empty.png" });
  await expect(picked).toContainText("Step 1");
  await expect(picked.getByRole("checkbox")).toBeChecked();
  // Esc closes only the menu, not the bug box.
  await dialog.getByRole("button", { name: "+ Add ▾" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("menu")).toHaveCount(0);
  await expect(dialog).toBeVisible();

  // Take screenshot right in the bug box: it lands on the bug and on step 2.
  await dialog.getByRole("button", { name: "+ Add ▾" }).click();
  await dialog.getByRole("menuitem", { name: "📷 Take screenshot" }).click();
  const shot = dialog.getByTestId("bug-file").filter({ hasText: `${KEY}-1 step 2 screenshot.png` });
  await expect(shot).toContainText("Step 2");
  // Upload a file from the same menu.
  await dialog.getByLabel("+ Add: upload a file").setInputFiles({ name: "console.log", mimeType: "text/plain", buffer: Buffer.from("TypeError") });
  await expect(dialog.getByTestId("bug-file").filter({ hasText: "console.log" })).toBeVisible();

  await dialog.getByRole("button", { name: "File bug in Jira" }).click();
  await expect(dialog).toBeHidden();
  const issues = (await (await fetch(`${JIRA}/__issues`)).json()) as Record<string, { files?: string[] }>;
  const filed = Object.values(issues).find((i) => i.files?.includes("console.log"))!;
  expect(filed.files).toEqual(expect.arrayContaining(["cart-empty.png", "console.log"]));
  expect(filed.files!.some((f) => f.includes("screenshot"))).toBe(true);
  // The new screenshot went on step 2 in the runner too.
  await expect(page.getByRole("link", { name: `${KEY}-1 step 2 screenshot.png` })).toBeVisible();
});

test("a GitHub repo with no workflow saved says Setup not finished and shows the picker", async ({ page }) => {
  const db = new PrismaClient();
  let groupId = "";
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: `GN${TAG}`, name: `Repo ${TAG}`, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    groupId = (await db.projectGroup.create({ data: { name: `Repo ${TAG}`, hubProjectId: hub.id, platforms: [] } })).id;
  } finally {
    await db.$disconnect();
  }
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${groupId}/settings`);
  const row = page.locator("#row-github");
  await row.getByRole("button", { name: "Connect to GitHub" }).click();
  await row.getByLabel("Repository", { exact: true }).fill("Scotterotty/flaw-patrol-ci-demo");
  await row.getByLabel("Access token", { exact: true }).fill("github_pat_good");
  await row.getByRole("button", { name: "Save and test" }).click();
  await expect(row.getByText("workflow Tests · nothing pulled yet")).toBeVisible();

  // An older connection with no workflow saved (made before ver_88).
  const db2 = new PrismaClient();
  try {
    await db2.gitHubRepo.updateMany({ where: { groupId }, data: { workflowId: null, workflowName: "" } });
  } finally {
    await db2.$disconnect();
  }
  await page.reload();
  await expect(row).toContainText("Setup not finished: pick which workflow's test results to pull");
  await row.getByRole("button", { name: "GitHub", exact: true }).click();
  await expect(row.getByTestId("github-setup-unfinished")).toBeVisible();
  await expect(row.getByLabel("Workflow", { exact: true })).toHaveValue("398809765");
  await row.getByRole("button", { name: "Save", exact: true }).click();
  await expect(row.getByText("workflow Tests · nothing pulled yet")).toBeVisible();
});

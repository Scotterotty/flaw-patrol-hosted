import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_161: requirements from several Jira projects ("These projects" in Settings), Show stories from
// and + Add another release on the Requirements page and the Risk board, and the folder ⋯ menu.

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

test("requirements from two Jira projects, one or several releases, on both views", async ({ page }) => {
  test.setTimeout(240_000);
  const KEY = `MP${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Multi ${TAG}`, KEY);
  await connectJira(page, KEY);
  const db = new PrismaClient();
  try {
    const p = await db.project.findUniqueOrThrow({ where: { key: KEY } });
    await db.project.update({ where: { id: p.id }, data: { caseSeq: 1 } });
    await db.testCase.create({ data: { projectId: p.id, number: 1, title: `Join from an invite ${TAG}`, jiraStories: ["QA-201"], versions: { create: { version: 1, title: `Join from an invite ${TAG}`, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags: [], steps: [{ action: "Open the invite", expected: "Joined" }] } } } });
  } finally {
    await db.$disconnect();
  }

  // Settings: These projects takes chips. A key Jira doesn't know is refused right away.
  await page.goto(`/p/${KEY}/settings#stories`);
  const box = page.locator("#stories");
  await box.getByRole("radio", { name: "These projects" }).check();
  const add = box.getByLabel("Add a Jira project");
  await add.fill("ZZ");
  await add.press("Enter");
  await expect(box.getByRole("alert")).toContainText("Jira doesn't have a project ZZ");
  await add.fill("QA");
  await add.press("Enter");
  await expect(box.getByTestId("requirement-project").filter({ hasText: "QA" })).toBeVisible();
  await add.fill("rp");
  await add.press("Enter");
  await expect(box.getByTestId("requirement-project").filter({ hasText: "RP" })).toBeVisible();
  await expect(box.getByText("Loaded from Jira projects QA and RP.")).toBeVisible();
  await box.getByRole("button", { name: "Save requirements" }).click();
  await expect(box.getByText("Saved.")).toBeVisible();
  const check = new PrismaClient();
  try {
    await expect.poll(async () => ((await check.jiraConfig.findFirst({ where: { project: { key: KEY } } }))?.stories as { projects?: string[] } | null)?.projects).toEqual(["QA", "RP"]);
  } finally {
    await check.$disconnect();
  }

  // Requirements page: both projects' stories, and Show stories from narrows it to one.
  await page.goto(`/p/${KEY}/stories?release=RC%2022`);
  await expect(page.getByText(/from Jira projects QA and RP/)).toBeVisible();
  const from = page.getByRole("group", { name: "Show stories from" });
  await expect(from.getByRole("link", { name: "All projects" })).toHaveAttribute("aria-current", "true");
  // Hide done is on at first: QA-201 is Done in Jira, so it's hidden until the switch is turned off.
  const hideDone = page.getByRole("switch", { name: /Hide done \(1\)/ });
  await expect(hideDone).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("RP-41", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("QA-201", { exact: true })).toHaveCount(0);
  await hideDone.click();
  await expect(page).toHaveURL(/done=show/);
  await expect(page.getByRole("switch", { name: /Hide done/ })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("QA-201", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("RP-41", { exact: true }).first()).toBeVisible();
  await from.getByRole("link", { name: "RP", exact: true }).click();
  await expect(page).toHaveURL(/proj=RP/);
  await expect(page.getByText("RP-41", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("QA-201", { exact: true })).toHaveCount(0);
  await from.getByRole("link", { name: "All projects" }).click();

  // Any release lists every requirement Jira has in both projects, not only linked ones,
  // across several pages of Jira results (the stand-in sends 5 a page).
  await page.getByRole("group", { name: "Jira release" }).getByRole("link", { name: "Any release" }).click();
  for (const key of ["QA-202", "QA-204", "RP-41", "RP-42"]) await expect(page.getByText(key, { exact: true }).first()).toBeVisible();
  await page.goto(`/p/${KEY}/stories?release=RC%2022&done=show`);

  // RC 22 is in both projects, so it's one button. Web 22 is RP's own name: add it next to RC 22.
  const releases = page.getByRole("group", { name: "Jira release" });
  await expect(releases.getByRole("link", { name: "RC 22", exact: true })).toHaveCount(1);
  await releases.getByText("+ Add another release").click();
  await releases.getByRole("menuitem", { name: "Web 22" }).click();
  await expect(page).toHaveURL(/release=RC\+22&release=Web\+22|release=RC%2022&release=Web%2022/);
  await expect(page.getByText("RP-42", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("RP-41", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "RC 22 + Web 22 runs" })).toBeVisible();

  // The Risk board keeps both releases; a move is saved under the release the card is in.
  await page.getByRole("navigation", { name: "Requirements view" }).getByRole("link", { name: "Risk board" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/risk\\?release=RC`));
  const board = page.getByRole("grid", { name: "Risk board for RC 22 + Web 22" });
  await expect(board.getByRole("button", { name: /RP-42/ })).toBeVisible();
  await expect(board.getByRole("button", { name: /QA-201/ })).toBeVisible();
  await expect(page.getByRole("group", { name: "Show stories from" })).toBeVisible();
  await board.getByRole("button", { name: /RP-42/ }).click();
  const card = page.getByRole("dialog");
  await card.getByLabel("How much it would hurt").selectOption("1");
  await expect(card.getByText("Moved by", { exact: false })).toBeVisible();
  const moved = new PrismaClient();
  try {
    await expect.poll(async () => (await moved.riskRating.findFirst({ where: { project: { key: KEY }, issueKey: "RP-42" } }))?.release).toBe("Web 22");
  } finally {
    await moved.$disconnect();
  }
  await card.getByRole("button", { name: "✕" }).or(card.getByRole("button", { name: /Close/ })).first().click();

  // Take Web 22 off again: one release, and the board is RC 22's only.
  await page.getByRole("group", { name: "Release" }).getByRole("link", { name: /Web 22, remove it/ }).click();
  await expect(page.getByRole("grid", { name: "Risk board for RC 22" })).toBeVisible();
  await expect(page.getByRole("button", { name: /RP-42/ })).toHaveCount(0);

  // Show stories from on the board too.
  await page.getByRole("group", { name: "Show stories from" }).getByRole("link", { name: "QA", exact: true }).click();
  await expect(page).toHaveURL(/proj=QA/);
  await expect(page.getByRole("button", { name: /RP-41/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /QA-201/ })).toBeVisible();

  // Linking a requirement to a case searches every picked project.
  await page.goto(`/p/${KEY}/cases/1`);
  await page.getByRole("button", { name: "+ Link requirement" }).click();
  await page.getByLabel("Find a Jira requirement").fill("Web sign");
  await expect(page.getByRole("listbox", { name: "Requirements" }).getByText(/RP-42/)).toBeVisible();
});

test("folder actions live in one ⋯ menu, and the rename box stays inside the sidebar", async ({ page }) => {
  const KEY = `FM${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Folders ${TAG}`, KEY);
  const folders = page.locator("aside");

  await folders.getByRole("button", { name: "+ New" }).click();
  await page.getByPlaceholder("Folder name").fill("Unity");
  await page.getByPlaceholder("Folder name").press("Enter");
  const unity = folders.locator('[data-folder="Unity"]');
  await expect(unity).toBeVisible();

  // ⋯ shows on hover and opens the menu with words.
  await unity.hover();
  await unity.getByRole("button", { name: "More for Unity" }).click();
  const menu = page.getByRole("menu", { name: "Unity folder" });
  await expect(menu.getByRole("menuitem")).toHaveText(["New subfolder", "Rename", "Move…", "Delete…"]);
  await menu.getByRole("menuitem", { name: "New subfolder" }).click();
  await page.getByPlaceholder("Folder name").fill("RC Tests");
  await page.getByPlaceholder("Folder name").press("Enter");
  const sub = folders.locator('[data-folder="RC Tests"]');
  await expect(sub).toBeVisible();

  // Right-click opens the same menu. The rename box lines up inside the sidebar.
  await sub.click({ button: "right" });
  await page.getByRole("menu", { name: "RC Tests folder" }).getByRole("menuitem", { name: "Rename" }).click();
  const input = page.getByPlaceholder("Folder name");
  await expect(input).toHaveValue("RC Tests");
  const side = await folders.boundingBox();
  const field = await input.boundingBox();
  expect(field!.x + field!.width).toBeLessThanOrEqual(side!.x + side!.width);
  await input.fill("UNITY RC Tests");
  await input.press("Enter");
  await expect(folders.locator('[data-folder="UNITY RC Tests"]')).toBeVisible();

  // Escape closes the menu.
  await unity.hover();
  await unity.getByRole("button", { name: "More for Unity" }).click();
  await expect(page.getByRole("menu", { name: "Unity folder" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Unity folder" })).toHaveCount(0);
});

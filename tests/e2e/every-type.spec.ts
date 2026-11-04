import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// Every issue type (Settings → Jira → Requirements): a Jira release shows every ticket with that
// Fix Version in the requirement projects, not only the ticked types. Sub-tasks stay out.

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

test("Every issue type pulls every ticket with the release's Fix Version, except Sub-tasks", async ({ page }) => {
  test.setTimeout(180_000);
  const KEY = `ET${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Every type ${TAG}`, KEY);
  await connectJira(page, KEY);

  // Requirements come from WEB only, with the usual types (Story and Task).
  await page.goto(`/p/${KEY}/settings#stories`);
  const box = page.locator("#stories");
  await box.getByRole("radio", { name: "These projects" }).check();
  const add = box.getByLabel("Add a Jira project");
  await add.fill("WEB");
  await add.press("Enter");
  await expect(box.getByTestId("requirement-project").filter({ hasText: "WEB" })).toBeVisible();
  await expect(box.getByRole("radio", { name: /Only these/ })).toBeChecked();
  await box.getByRole("button", { name: "Save requirements" }).click();
  await expect(box.getByText("Saved.")).toBeVisible();

  // RC 22 shows the Story only: the Improvement isn't a ticked type.
  await page.goto(`/p/${KEY}/stories?release=RC%2022&done=show`);
  await expect(page.getByText("WEB-41", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("WEB-43", { exact: true })).toHaveCount(0);

  // Every issue type: the checkboxes stay as they were but can't be changed.
  await page.goto(`/p/${KEY}/settings#stories`);
  await box.getByRole("radio", { name: /Every issue type/ }).check();
  await expect(box.getByRole("checkbox", { name: "Story" })).toBeDisabled();
  await box.getByRole("button", { name: "Save requirements" }).click();
  await expect(box.getByText("Saved.")).toBeVisible();
  const db = new PrismaClient();
  try {
    await expect.poll(async () => ((await db.jiraConfig.findFirst({ where: { project: { key: KEY } } }))?.stories as { allTypes?: boolean; types?: string[] } | null)).toMatchObject({ allTypes: true, types: ["Story", "Task"] });
  } finally {
    await db.$disconnect();
  }

  // Now RC 22 has the Improvement too, with a type button to narrow it. The Sub-task stays out.
  await page.goto(`/p/${KEY}/stories?release=RC%2022&done=show`);
  await expect(page.getByText("WEB-41", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("WEB-43", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("WEB-44", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Type" }).getByRole("link", { name: "Improvement", exact: true })).toBeVisible();

  // Back to Only these: the old ticks come back, and the Improvement goes away again.
  await page.goto(`/p/${KEY}/settings#stories`);
  await expect(box.getByRole("radio", { name: /Every issue type/ })).toBeChecked();
  await box.getByRole("radio", { name: /Only these/ }).check();
  await expect(box.getByRole("checkbox", { name: "Story" })).toBeChecked();
  await expect(box.getByRole("checkbox", { name: "Epic" })).not.toBeChecked();
  await box.getByRole("button", { name: "Save requirements" }).click();
  await expect(box.getByText("Saved.")).toBeVisible();
  await page.goto(`/p/${KEY}/stories?release=RC%2022&done=show`);
  await expect(page.getByText("WEB-41", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("WEB-43", { exact: true })).toHaveCount(0);
});

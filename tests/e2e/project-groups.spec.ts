import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const RC = `RC ${TAG}`;

async function newProject(page: Page, key: string, name: string) {
  await page.goto("/");
  await standaloneProject(page, name, key);
  await expect(page).toHaveURL(new RegExp(`/p/${key}/`));
}

async function suiteAndRun(page: Page, key: string, suite: string, run: string) {
  await page.goto(`/p/${key}/cases/new`);
  await page.getByLabel("Title").fill("Sign in");
  await page.getByLabel("Step 1 action").fill("Sign in works");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.goto(`/p/${key}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill(suite);
  await page.getByRole("button", { name: /^Add all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page).not.toHaveURL(/\/suites\/new/);
  await page.goto(`/p/${key}/suites`);
  await page.getByRole("link", { name: suite }).click();
  await page.getByRole("button", { name: "Start test run" }).click();
  await page.getByLabel("Run name").fill(run);
  await page.getByLabel("Release", { exact: true }).fill(RC);
  await page.getByLabel("Build").fill("1.0.0");
  await page.getByLabel("Open the first case when it starts").uncheck();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
}

test("project groups: one card, a page with every suite, archived on request", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  const web = `Grp Web ${TAG}`;
  const unity = `Grp Unity ${TAG}`;
  const group = `OKO ${TAG}`;
  await newProject(page, `GW${TAG}`, web);
  await suiteAndRun(page, `GW${TAG}`, `Web smoke ${TAG}`, "Web regression");
  await newProject(page, `GU${TAG}`, unity);
  await suiteAndRun(page, `GU${TAG}`, `Unity smoke ${TAG}`, "Unity regression");

  // Groups can't be made any more (ver_70); ones made before stay. Make one the old way, straight in the database.
  const db = new PrismaClient();
  await db.projectGroup.create({
    data: { name: group, description: "Web and Unity clients", projects: { connect: [{ key: `GW${TAG}` }, { key: `GU${TAG}` }] } },
  });
  await db.$disconnect();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New group" })).toHaveCount(0);

  // One group card with chips; the projects no longer have cards of their own.
  await expect(page.getByRole("heading", { level: 3, name: group })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: web })).toHaveCount(0);
  await expect(page.getByRole("link", { name: web, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Star ${group}` }).click();
  await expect(page.getByRole("region", { name: "Starred" }).getByRole("heading", { name: group })).toBeVisible();

  // The group page lists both projects' suites.
  await page.getByRole("link", { name: group, exact: true }).click();
  await expect(page).toHaveURL(/\/g\//);
  await expect(page.getByRole("heading", { name: group })).toBeVisible();
  await expect(page.getByRole("link", { name: `Web smoke ${TAG}` })).toBeVisible();
  await expect(page.getByRole("link", { name: `Unity smoke ${TAG}` })).toBeVisible();
  await page.getByLabel("Test cycle").selectOption({ label: unity });
  await expect(page.getByRole("link", { name: `Web smoke ${TAG}` })).toHaveCount(0);
  await expect(page.getByRole("link", { name: `Unity smoke ${TAG}` })).toBeVisible();
  await page.getByRole("link", { name: "Test runs" }).click();
  await expect(page.getByText("Unity regression")).toBeVisible();
  await page.getByLabel("Test cycle").selectOption("");
  await expect(page.getByText("Web regression")).toBeVisible();

  // Project pages show the group in the breadcrumb.
  await page.goto(`/p/GW${TAG}`);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: group })).toBeVisible();

  // Archive Web: the group page hides it until Include archived is ticked.
  await page.goto("/");
  const groupId = (await page.getByRole("link", { name: group, exact: true }).getAttribute("href"))!;
  await page.goto(`/p/GW${TAG}/settings`);
  const archive = page.getByTestId("archive-card");
  await archive.getByRole("button", { name: "Archive…" }).click();
  await archive.getByRole("button", { name: "Yes, archive" }).click();
  await expect(archive.getByRole("button", { name: "Restore…" })).toBeVisible();
  await page.goto(groupId);
  await expect(page.getByRole("link", { name: `Web smoke ${TAG}` })).toHaveCount(0);
  await page.getByLabel(/Include archived test cycles/).check();
  await expect(page.getByRole("link", { name: `Web smoke ${TAG}` })).toBeVisible();

  // Rename through Edit group.
  await page.getByRole("button", { name: "Edit group" }).click();
  await page.getByRole("dialog").getByLabel("Group name").fill(`${group} renamed`);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: `${group} renamed` })).toBeVisible();

  // Delete the group: its projects stay, and no "Move to group" is offered once no groups are left.
  await page.goto(groupId);
  await page.getByRole("button", { name: "Edit group" }).click();
  await page.getByRole("button", { name: "Delete group…" }).click();
  await page.getByRole("button", { name: "Delete group", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 3, name: unity })).toBeVisible();
  await page.getByRole("button", { name: `More for ${unity}` }).click();
  await expect(page.getByRole("menuitem", { name: /Move to group/ })).toHaveCount(0);
});

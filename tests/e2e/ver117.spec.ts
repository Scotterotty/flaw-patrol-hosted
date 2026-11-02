import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_117: test cycles under an umbrella have no settings page of their own. The umbrella's Settings
// has a Test cycles table (Team, Jira, Slack), Change opens a test cycle's choices below its row,
// and old test cycle settings links open that row.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();

async function newUmbrella(page: Page, name: string, key: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const make = page.getByRole("dialog");
  await make.getByLabel("Product name").fill(name);
  await make.getByLabel("Key").fill(key);
  await make.getByLabel("Release", { exact: true }).fill("5.0");
  await make.getByLabel("Platform 1").fill("Web");
  await make.getByRole("button", { name: "＋ Add a platform" }).click();
  await make.getByLabel("Platform 2").fill("iOS");
  await make.getByRole("button", { name: `Make ${name} with 2 new test cycles` }).click();
  await expect(page).toHaveURL(/\/g\//);
  return page.url();
}

test("one Settings page holds every test cycle's settings", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  const NAME = `Gull ${TAG}`;
  const HUB = `GU${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  const home = await newUmbrella(page, NAME, HUB);
  const groupId = home.split("/g/")[1].split(/[/?#]/)[0];
  const db = new PrismaClient();
  let web = "";
  try {
    const group = await db.projectGroup.findUniqueOrThrow({ where: { id: groupId } });
    web = (await db.project.findFirstOrThrow({ where: { groupId: group.id, platform: "Web" } })).key;
  } finally {
    await db.$disconnect();
  }

  await page.goto(`/g/${groupId}/settings`);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByTestId("settings-scope")).toContainText(`every test cycle in ${NAME}`);

  // The left menu has one Settings link, no per-cycle ones.
  const nav = page.getByRole("navigation", { name: `${NAME} umbrella` }).first();
  expect(await nav.getByRole("list").last().getByRole("link").allTextContents()).toEqual(["Settings"]);

  // Both test cycles are rows, following the umbrella.
  const table = page.getByTestId("cycle-settings");
  await expect(table.getByRole("heading", { name: "Test cycles" })).toBeVisible();
  await expect(table.getByRole("button", { name: "Web 5.0", exact: true })).toBeVisible();
  await expect(table.getByRole("button", { name: "iOS 5.0", exact: true })).toBeVisible();
  await expect(page.getByText("Where each test cycle files bugs")).toHaveCount(0);

  // Change opens the row's choices; keeping members separate marks Team as its own.
  await table.getByRole("button", { name: "Change Web 5.0" }).click();
  await expect(page).toHaveURL(new RegExp(`#cycle-${web.toLowerCase()}$`));
  await expect(table.getByRole("heading", { name: `Web 5.0: what's different from ${NAME}` })).toBeVisible();
  await expect(table.getByLabel("Name")).toHaveValue(`${NAME} Web 5.0`);
  await table.getByRole("switch", { name: /Keep members separate/ }).check();
  await expect(table.getByText(/Its own · \d+ (person|people)/)).toBeVisible();
  await table.getByRole("button", { name: "Hide Web 5.0" }).click();
  await expect(table.getByRole("heading", { name: /what's different/ })).toHaveCount(0);

  // ⋯ has Rename and Archive.
  await table.getByRole("button", { name: "More for iOS 5.0" }).click();
  await expect(page.getByRole("menuitem", { name: "Rename…" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await expect(table.getByRole("heading", { name: `iOS 5.0: what's different from ${NAME}` })).toBeVisible();
  await table.getByRole("button", { name: "More for iOS 5.0" }).click();
  await page.getByRole("menuitem", { name: "Archive…" }).click();
  const card = page.getByTestId("archive-card");
  await expect(card.getByRole("list", { name: "Test cycles to archive" }).getByRole("checkbox", { name: /iOS 5\.0/ })).toBeChecked();
  await expect(card.getByRole("list", { name: "Test cycles to archive" }).getByRole("checkbox", { name: /Web 5\.0/ })).not.toBeChecked();

  // An old test cycle settings link opens its row in the umbrella's Settings.
  await page.goto(`/p/${web}/settings#jira`);
  await expect(page).toHaveURL(new RegExp(`/g/${groupId}/settings#cycle-${web.toLowerCase()}$`));
  await expect(page.getByRole("heading", { name: `Web 5.0: what's different from ${NAME}` })).toBeVisible();

  // #roles still goes to the umbrella's Roles card.
  await page.goto(`/p/${web}/settings#roles`);
  await expect(page).toHaveURL(new RegExp(`/g/${groupId}/settings#roles$`));

  // Other settings explains the two other places.
  const others = page.getByTestId("other-settings");
  await expect(others.getByRole("link", { name: "Your account" })).toHaveAttribute("href", "/account");
  await expect(others.getByRole("link", { name: "Workspace settings" })).toHaveAttribute("href", "/workspace");
});

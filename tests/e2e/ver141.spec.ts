import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_141: Found-in version. Settings → Jira turns it on; the bug box picks the run's release as
// the Jira version (matched loosely); a release Jira doesn't have goes in the description; the
// Bugs page shows and filters by it.

const run = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `F${run}`;
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;
type Issue = { summary: string; description: unknown; fields: Record<string, unknown> };
const newest = async (): Promise<[string, Issue]> => {
  const all = Object.entries((await (await fetch(`${JIRA}/__issues`)).json()) as Record<string, Issue>).filter(([k]) => k.startsWith("RP-"));
  return all.sort(([a], [b]) => Number(a.split("-")[1]) - Number(b.split("-")[1])).at(-1)!;
};

test("found-in version goes into Jira and shows on the Bugs page", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Found in ${run}`, KEY);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases`));

  await page.goto(`/p/${KEY}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("RP");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();

  // 1. Turn it on: the check reads Jira's create screen and versions.
  const box = page.getByTestId("jira-found-in");
  await expect(box).toBeVisible();
  await box.getByRole("switch", { name: "Put the release being tested into new Jira bugs" }).click();
  await expect(box.getByLabel("Jira field")).toHaveValue("versions");
  await expect(box.getByTestId("found-in-check")).toContainText("RP's create screen has Found in version.");
  await expect(box.getByTestId("found-in-check")).toContainText("Jira has 3 versions: RC 23, RC 22, RC 21.");
  await box.getByRole("button", { name: "Save found-in version" }).click();
  await expect(box.getByText("Saved. New bugs get a found-in version.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("jira-found-in").getByRole("switch")).toHaveAttribute("aria-checked", "true");

  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Pay with saved card");
  await page.getByLabel("Step 1 action").fill("Tap Pay");
  await page.getByLabel("Step 1 expected result").fill("Order is placed");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Pay with saved card" })).toBeVisible();
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Checkout");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  // Written loosely on purpose: Jira's version is "RC 22".
  await page.getByLabel("Release", { exact: true }).fill("rc22");
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/runs/1$`));
  await page.getByRole("link", { name: "Start testing" }).click();
  await expect(page).toHaveURL(/\/execute\?entry=/);
  const executeUrl = page.url();
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Failed" }).click();
  await page.getByLabel("Step 1 actual result").fill("Spinner never stops");

  // 2. The bug box picks Jira's RC 22 for the run's "rc22".
  await page.getByRole("button", { name: "Report bug in Jira" }).first().click();
  let dialog = page.getByRole("dialog");
  const line = dialog.getByTestId("found-in");
  await expect(line.getByLabel("Found in")).toHaveValue("RC 22");
  await expect(line.getByTestId("found-in-why")).toHaveText("From this run's release · goes in Jira's Found in version");
  // Released versions only show when asked.
  await expect(line.getByRole("option", { name: "RC 21 (released)" })).toHaveCount(0);
  await line.getByLabel("Show older versions").check();
  await expect(line.getByRole("option", { name: "RC 21 (released)" })).toHaveCount(1);
  await dialog.getByRole("button", { name: "File bug in Jira" }).click();
  await expect(dialog).toBeHidden();
  let [key, issue] = await newest();
  expect(issue.fields.versions).toEqual([{ name: "RC 22" }]);
  expect(JSON.stringify(issue.description)).not.toContain("Found in:");
  const first = key;

  // 3. A release Jira doesn't have: said in the box, then put in the description.
  await page.goto(`/p/${KEY}/runs/1`);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Edit details" }).click();
  const edit = page.getByRole("dialog", { name: "Edit run details" });
  await edit.getByLabel("Release", { exact: true }).fill("2.6 beta");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toBeHidden();
  await page.goto(executeUrl);
  await page.getByRole("button", { name: "Report bug in Jira" }).first().click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Found in")).toHaveValue("2.6 beta");
  await expect(dialog.getByTestId("found-in-missing")).toContainText(`"2.6 beta" isn't a version in Jira, so it goes in the description instead.`);
  await expect(dialog.getByTestId("found-in-missing").getByRole("button", { name: "Use RC 23" })).toBeVisible();
  await dialog.getByRole("button", { name: "File bug in Jira" }).click();
  await expect(dialog).toBeHidden();
  [key, issue] = await newest();
  expect(key).not.toBe(first);
  expect(issue.fields.versions).toBeUndefined();
  expect(JSON.stringify(issue.description)).toContain("Found in: 2.6 beta (not a version in Jira, so it isn't in Found in version)");

  // 4. Leave it out: no version and no line.
  await page.getByRole("button", { name: "Report bug in Jira" }).first().click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Found in").selectOption({ label: "Leave it out" });
  await expect(dialog.getByTestId("found-in-why")).toHaveText("Not set in Jira");
  await dialog.getByRole("button", { name: "File bug in Jira" }).click();
  await expect(dialog).toBeHidden();
  [, issue] = await newest();
  expect(issue.fields.versions).toBeUndefined();
  expect(JSON.stringify(issue.description)).not.toContain("Found in:");

  // 5. The Bugs page shows the version and filters by it.
  await page.goto(`/p/${KEY}/bugs`);
  await expect(page.getByTestId("bug-found-in").filter({ hasText: "Version RC 22" })).toHaveCount(1);
  await expect(page.getByTestId("bug-found-in").filter({ hasText: "Version 2.6 beta" })).toHaveCount(1);
  await page.getByLabel("Found in version").selectOption({ label: "Found in RC 22" });
  await expect(page).toHaveURL(/version=RC(\+|%20)22/);
  await expect(page.getByTestId("bug-found-in")).toHaveCount(1);
  await expect(page.getByRole("link", { name: first })).toBeVisible();
});

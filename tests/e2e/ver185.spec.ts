import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_185: a file over Jira's size limit (24 MB for the team's Jira) is flagged in the
// bug box and starts unticked, so the bug and its other files still reach Jira.
// Files go up one at a time, so one Jira refuses never takes the others down.

const run = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `Z${run}`;
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;
type Issue = { summary: string; files?: string[] };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const BIG = Buffer.alloc(25 * 1024 * 1024, 7);

test("a file too big for Jira is flagged, left unticked, and the bug still files with the rest", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Big files ${run}`, KEY);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases`));

  await page.goto(`/p/${KEY}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("RP");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByTestId("jira-reporter-check")).toBeVisible();

  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Map closes slowly");
  await page.getByLabel("Step 1 action").fill("Close the map");
  await page.getByLabel("Step 1 expected result").fill("Inventory opens");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Map closes slowly" })).toBeVisible();
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Smoke");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByLabel("Release", { exact: true }).fill("rc1");
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/runs/1$`));
  await page.getByRole("link", { name: "Start testing" }).click();
  await expect(page).toHaveURL(/\/execute\?entry=/);

  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Failed" }).click();
  await page.getByLabel("Step 1 actual result").fill("Inventory freezes");
  await page.getByRole("button", { name: "Report bug in Jira" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("+ Add: upload a file").setInputFiles([
    { name: "step-shot.png", mimeType: "image/png", buffer: PNG },
    { name: "long-clip.webm", mimeType: "video/webm", buffer: BIG },
  ]);
  const files = dialog.getByTestId("bug-file");
  const small = files.filter({ hasText: "step-shot.png" });
  const big = files.filter({ hasText: "long-clip.webm" });
  await expect(big).toBeVisible({ timeout: 90_000 });
  await expect(big.getByTestId("too-big-for-jira")).toHaveText("Too big for Jira (24 MB max). Record a shorter clip, or file without it.");
  await expect(big.getByRole("checkbox")).not.toBeChecked();
  await expect(small.getByRole("checkbox")).toBeChecked();
  await expect(small.getByTestId("too-big-for-jira")).toHaveCount(0);

  const summary = `Inventory freezes ${run}`;
  await dialog.getByLabel("Summary").fill(summary);
  await dialog.getByRole("button", { name: "File bug in Jira" }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  const issue = Object.values((await (await fetch(`${JIRA}/__issues`)).json()) as Record<string, Issue>).find((i) => i.summary === summary)!;
  expect(issue.files).toEqual(["step-shot.png"]);

  // Ticked anyway: the bug still files, the small file still goes, and the filer is told why the big one didn't.
  await page.getByRole("button", { name: "Report bug in Jira" }).first().click();
  const again = dialog.getByTestId("bug-file").filter({ hasText: "long-clip.webm" });
  await again.getByRole("checkbox").check();
  const before = new Set(Object.keys(await (await fetch(`${JIRA}/__issues`)).json()));
  await dialog.getByLabel("Summary").fill(`Inventory freezes again ${run}`);
  await dialog.getByRole("button", { name: "File bug in Jira" }).click();
  await expect(dialog.getByText(/long-clip\.webm \(25 MB\) is too big for Jira \(24 MB max\), so it stayed in Flaw Patrol\./)).toBeVisible({ timeout: 60_000 });
  const added = Object.entries((await (await fetch(`${JIRA}/__issues`)).json()) as Record<string, Issue>).filter(([k]) => !before.has(k));
  expect(added.map(([, i]) => i.files)).toEqual([["step-shot.png"]]);
});

import { expect, test, type Page } from "@playwright/test";
import { signIn, backToRun } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `C${Date.now().toString(36).slice(-4).toUpperCase()}`;
const RC = `RC ${KEY}`;

async function startRun(page: Page, name: string, release: string, build: string) {
  await page.goto(`/p/${KEY}/suites`);
  await page.getByRole("link", { name: "Both" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByLabel("Run name").fill(name);
  await page.getByLabel("Release", { exact: true }).fill(release);
  await page.getByLabel("Build").fill(build);
  await page.getByLabel("CSP version").fill("7.0.0");
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
  return page.url();
}

test("Release status gathers each client's run of a release, ready for Confluence", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/");
  await standaloneProject(page, `RC ${KEY}`, KEY);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases`));
  for (const title of ["Sign in", "Upload"]) {
    await page.goto(`/p/${KEY}/cases/new`);
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Step 1 action").fill(`${title} works`);
    await page.getByRole("button", { name: "Create case" }).first().click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Both");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page).not.toHaveURL(/\/suites\/new/);

  // Web: one case passed, one blocked by a showstopper. Unity: not started. A third run is another RC.
  const web = await startRun(page, "Web regression", RC.toLowerCase().replace(" ", ""), "4.20.0");
  await startRun(page, "Unity regression", RC, "1.61.0");
  await startRun(page, "Unreal old", `${RC}-old`, "6.3.0");

  await page.goto(web + "/execute");
  await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" }).click();
  await page.getByRole("button", { name: "Save and next" }).click();
  await expect(page.getByRole("heading", { name: "Upload", level: 1 })).toBeVisible();
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Blocked" }).click();
  await page.getByRole("button", { name: "Report bug" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Summary").fill("Upload button missing");
  await dialog.getByLabel("Severity").selectOption({ label: "Critical" });
  await dialog.getByRole("button", { name: "Save bug" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Save and finish" }).click();
  await backToRun(page);

  // A project that isn't under an umbrella has Release status under Reports.
  await page.goto(`/p/${KEY}/reports`);
  await page.getByRole("link", { name: "Release status" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/reports/rc`));
  // Picking before the page has finished loading does nothing, so try until it takes.
  await expect(async () => {
    await page.getByLabel("Release", { exact: true }).selectOption({ label: RC });
    await expect(page.getByRole("heading", { name: `${RC.toUpperCase()} TESTING STATUS` })).toBeVisible({ timeout: 2000 });
  }).toPass();
  // "rcXXXX" and "RC XXXX" are the same release; the "-old" run isn't.
  const webCol = page.getByRole("region", { name: "Web" });
  const unityCol = page.getByRole("region", { name: "Unity" });
  await expect(webCol).toContainText("100%");
  await expect(webCol).toContainText("2 of 2 cases run");
  await expect(webCol).toContainText("DONE");
  await expect(webCol).toContainText("1 passed · 1 blocked");
  await expect(webCol).toContainText("1 bug: Critical");
  await expect(webCol).toContainText("4.20.0 · CSP 7.0.0");
  await expect(unityCol).toContainText("NOT STARTED");
  await expect(unityCol).toContainText("0%");
  await expect(page.getByRole("region", { name: "Unreal" })).toHaveCount(0);
  const bugRow = page.getByRole("row").filter({ hasText: "Upload button missing" });
  // No Jira here, so bugs use the plain names (ver_91).
  await expect(bugRow).toContainText("Critical");
  await expect(bugRow).toContainText("Web");

  // Export → Copy for Confluence puts a formatted table on the clipboard (one Export menu since ver_91).
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: /Copy for Confluence/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Copied" }).first()).toBeVisible();
  const html = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return (await item.getType("text/html")).text();
  });
  expect(html).toContain(`${RC.toUpperCase()} TESTING STATUS`);
  expect(html).toContain("<table>");
  expect(html).toContain("Upload button missing");

  // Image (PNG) gives a picture.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: /Image \(PNG\)/ }).click();
  expect((await download).suggestedFilename()).toMatch(/_status\.png$/);

  // Untick Unity; add the other RC's run. Both choices are remembered.
  await page.getByRole("button", { name: /^Runs:/ }).click();
  const picker = page.getByRole("group", { name: "Runs in the report" });
  await picker.getByLabel(/Unity regression/).uncheck();
  await expect(unityCol).toHaveCount(0);
  await picker.getByLabel("Add a run").selectOption({ label: `Unreal old · RC ${KEY} · R3 · ${RC}-old` });
  await expect(page.getByRole("region", { name: "Unreal" })).toBeVisible();
  // Old /rc links still work.
  await page.goto("/rc");
  await expect(page.getByLabel("Release", { exact: true })).toHaveValue(RC);
  await expect(page.getByRole("region", { name: "Unity" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Unreal" })).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { signIn, openAccount } from "./auth";
import { standaloneProject } from "./projects";

// Bugs filed from Flaw Patrol show the tester as the Jira Reporter (matched by
// email), fall back to naming them in the description, and plain Save keeps
// the tester on the case they're running.

const run = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `J${run}`;
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;
type Issue = { reporter: string | null; description: unknown };
const issues = async (): Promise<Record<string, Issue>> => (await fetch(`${JIRA}/__issues`)).json();
const newest = async () => {
  const all = Object.entries(await issues()).filter(([k]) => k.startsWith("RP-"));
  return all.sort(([a], [b]) => Number(a.split("-")[1]) - Number(b.split("-")[1])).at(-1)!;
};

test("bug reporter is the tester, and plain Save stays on the case", async ({ page }) => {
  const alerts: string[] = [];
  page.on("dialog", (d) => {
    alerts.push(d.message());
    d.accept();
  });
  await fetch(`${JIRA}/__reporter/on`);
  await signIn(page, "admin@example.com", "Demo Admin");

  await standaloneProject(page, `Reporter ${run}`, KEY);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases`));

  await page.goto(`/p/${KEY}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("RP");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  const check = page.getByTestId("jira-reporter-check");
  await expect(check.getByText(`QA Bot's account can set the Reporter`)).toBeVisible();
  await expect(check.getByText("1 of 1 members found in Jira by email.")).toBeVisible();

  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Pay twice");
  await page.getByLabel("Step 1 action").fill("Tap Pay twice");
  await page.getByLabel("Step 1 expected result").fill("Payment sheet opens");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Pay twice" })).toBeVisible();
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Smoke");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Start test run" }).click();
  await page.getByLabel("Release", { exact: true }).fill("rc1");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/runs/1$`));
  await page.getByRole("link", { name: "Start testing" }).click();
  await expect(page).toHaveURL(/\/execute\?entry=/);
  const executeUrl = page.url();

  const fileBug = async () => {
    await page.getByRole("button", { name: "Report bug in Jira" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("jira-reporter")).toBeVisible();
    return dialog;
  };
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Failed" }).click();
  await page.getByLabel("Step 1 actual result").fill("Nothing happens");

  // 1. Found by email: the tester is the Reporter.
  let dialog = await fileBug();
  await expect(dialog.getByTestId("jira-reporter")).toContainText("Reporter in Jira: Demo Admin (you)");
  await dialog.getByRole("button", { name: "File bug in Jira" }).click();
  await expect(dialog).toBeHidden();
  let [key, issue] = await newest();
  expect(issue.reporter).toBe("acc-admin");
  expect(JSON.stringify(issue.description)).not.toContain("Reported by");

  // 2. Jira won't let the token owner set it: filed anyway, name in the description, and the tester is told in the dialog.
  await fetch(`${JIRA}/__reporter/off`);
  dialog = await fileBug();
  await dialog.getByRole("button", { name: "File bug in Jira" }).click();
  const notes = dialog.getByTestId("bug-filed-notes");
  await expect(notes).toBeVisible();
  [key, issue] = await newest();
  expect(issue.reporter).toBeNull();
  expect(JSON.stringify(issue.description)).toContain("Demo Admin (via Flaw Patrol)");
  await expect(notes).toContainText(`set you as the reporter of ${key}`);
  expect(alerts.join("\n")).not.toContain("set you as the reporter");
  await notes.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await fetch(`${JIRA}/__reporter/on`);

  // 3. Plain Save keeps you on this case.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await page.waitForTimeout(1000);
  expect(page.url()).toBe(executeUrl);
  await expect(page.getByRole("group", { name: "Step 1 status" })).toBeVisible();

  // 4. No Jira account under your email: warned first, filed as the token owner, named in the description.
  await openAccount(page, "#jira");
  await page.getByLabel("Jira email (only if different)").fill("nobody@example.com");
  await page.getByRole("button", { name: "Save and check" }).click();
  await expect(page.getByText(`No Jira account on ${JIRA} has the email nobody@example.com`)).toBeVisible();
  await page.goto(executeUrl);
  dialog = await fileBug();
  // One quiet line (ver_85), not a warning box.
  await expect(dialog.getByTestId("jira-reporter")).toContainText("Reporter in Jira: QA Bot (your name goes in the description)");
  await expect(dialog.getByTestId("jira-reporter").getByRole("link", { name: "Set your Jira email" })).toBeVisible();
  await expect(dialog.getByText("Reported by: Demo Admin (via Flaw Patrol)")).toBeVisible();
  await dialog.getByRole("button", { name: "File bug in Jira" }).click();
  await expect(dialog).toBeHidden();
  [, issue] = await newest();
  expect(issue.reporter).toBeNull();
  expect(JSON.stringify(issue.description)).toContain("Demo Admin (via Flaw Patrol)");

  // Settings lists who isn't found.
  await page.goto(`/p/${KEY}/settings`);
  await expect(check.getByText("0 of 1 members found in Jira by email.")).toBeVisible();
  await expect(check.getByText("nobody@example.com")).toBeVisible();

  // 5. The token owner filing their own bug is matched, even when Jira won't let the token set Reporters.
  await fetch(`${JIRA}/__reporter/off`);
  await openAccount(page, "#jira");
  await page.getByLabel("Jira email (only if different)").fill("qa-bot@example.com");
  await page.getByRole("button", { name: "Save and check" }).click();
  await expect(page.getByText("Found in Jira: QA Bot")).toBeVisible();
  await page.goto(executeUrl);
  dialog = await fileBug();
  await expect(dialog.getByTestId("jira-reporter")).toContainText("Reporter in Jira: QA Bot (you)");
  await expect(dialog.getByText("Reported by:")).toHaveCount(0);
  await dialog.getByRole("button", { name: "File bug in Jira" }).click();
  await expect(dialog).toBeHidden();
  [, issue] = await newest();
  expect(issue.reporter).toBeNull();
  expect(JSON.stringify(issue.description)).not.toContain("Reported by");
  await page.goto(`/p/${KEY}/settings`);
  await expect(check.getByText("1 of 1 members found in Jira by email.")).toBeVisible();
  await fetch(`${JIRA}/__reporter/on`);

  // 6. A different Jira email whose address Jira hides still matches.
  await openAccount(page, "#jira");
  await page.getByLabel("Jira email (only if different)").fill("hidden@example.com");
  await page.getByRole("button", { name: "Save and check" }).click();
  await expect(page.getByText("Found in Jira: Hidden Email Person")).toBeVisible();
  // Back to their own email.
  await page.getByLabel("Jira email (only if different)").fill("");
  await page.getByRole("button", { name: "Save and check" }).click();
  await expect(page.getByText("Found in Jira: Demo Admin")).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// Import a bug template from Jira (ver_79): paste one example bug (QA-418 in the
// mock), check what was found, save, and file a bug in that layout.

const run = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `IT${run}`;
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;
type Issue = { summary: string; description: { content: { type: string; content?: { text?: string }[] }[] }; fields: Record<string, unknown> };

test("import a bug template from an example Jira bug", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await fetch(`${JIRA}/__reporter/on`);
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Mobile ${run}`, KEY);

  await page.goto(`/p/${KEY}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("QA");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText("Connected as QA Bot.")).toBeVisible();

  // ver_144: the layout is changed from Bug templates → Change layout… on the first template.
  await page.locator("#bug-templates").getByRole("button", { name: "Change layout…" }).click();
  const settings = page.getByTestId("bug-template-settings");
  await expect(settings.getByLabel("Plain layout")).toBeChecked();
  await settings.getByLabel("Import a template from Jira").check();
  await expect(settings.getByText("How to import your template")).toBeVisible();
  // A bug from another Jira project is refused.
  await settings.getByLabel("Example bug").fill("OB-1");
  await settings.getByRole("button", { name: "Read template" }).click();
  await expect(settings.getByText(/Jira has no bug OB-1|is in Jira project OB/)).toBeVisible();
  await settings.getByLabel("Example bug").fill(`${JIRA}/browse/QA-418`);
  await settings.getByRole("button", { name: "Read template" }).click();

  const found = settings.getByTestId("template-found");
  await expect(found).toContainText("[MOBILE] - Login - Password field hides the Show button");
  await expect(found.getByLabel("Steps to Reproduce on each new bug")).toHaveValue("steps");
  await expect(found.getByLabel("Expected Result on each new bug")).toHaveValue("expected");
  await expect(found.getByLabel("Notes on each new bug")).toHaveValue("tester");
  await expect(found.getByLabel("Component on each new bug")).toHaveValue("default");
  await expect(found.getByLabel("Default Component")).toHaveValue("Mobile app");
  await expect(found.getByLabel("Reproducibility on each new bug")).toHaveValue("tester");
  await expect(found.getByLabel("Found in version on each new bug")).toHaveValue("release");
  await expect(found.getByLabel("Labels on each new bug")).toHaveValue("empty");
  await expect(found.getByText("Assignee")).toHaveCount(0);
  await found.getByLabel("Environment on each new bug").selectOption("empty");
  await found.getByRole("button", { name: "Save template" }).click();
  await expect(settings.getByText("Template saved from QA-418. New bugs from this test cycle use it.")).toBeVisible();
  await page.reload();
  await expect(settings.getByTestId("template-saved")).toContainText("[Tag] - Feature - Summary");
  await expect(settings.getByTestId("template-saved")).toContainText("4 description sections · 3 Jira fields");

  // A case and a run, then a failed step's bug in the imported layout.
  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("[IOS] - Login - Show password");
  await page.getByLabel("Step 1 action").fill("Type a password");
  await page.getByLabel("Step 1 expected result").fill("The Show button stays");
  await page.getByRole("button", { name: "Create case" }).first().click();
  // Wait for the case to save before leaving the page.
  await expect(page).not.toHaveURL(/\/cases\/new/);
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Smoke");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByLabel("Release", { exact: true }).fill("4.12");
  await page.getByLabel("Build").fill("4.12.0.88");
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await page.getByRole("link", { name: "Start testing" }).click();
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Failed" }).click();
  await page.getByLabel("Step 1 actual result").fill("The Show button hides");
  await page.getByRole("button", { name: "Report bug in Jira" }).first().click();

  const form = page.getByRole("dialog").getByTestId("imported-template");
  await expect(form.getByLabel("Tag")).toHaveValue("IOS");
  await expect(form.getByLabel("Feature")).toHaveValue("Show password");
  await form.getByLabel("Feature").fill("Login");
  await expect(form.getByLabel("Steps to Reproduce")).toHaveValue("1. Type a password");
  await expect(form.getByLabel("Expected Result")).toHaveValue("The Show button stays");
  await expect(form.getByLabel("Actual Result")).toHaveValue("The Show button hides");
  await expect(form.getByLabel("Environment")).toHaveCount(0);
  await expect(form.getByRole("group", { name: "Component" }).getByRole("button", { name: "Mobile app" })).toHaveAttribute("aria-pressed", "true");
  await expect(form.getByRole("group", { name: "Found in version" }).getByRole("button", { name: "4.12" })).toHaveAttribute("aria-pressed", "true");
  await form.getByLabel("Reproducibility").selectOption("Sometimes");
  await form.getByLabel("Notes").fill("Only on iPhone");
  await form.getByLabel("Summary").fill("Show button hides while typing");
  await expect(form.getByTestId("imported-title")).toHaveText("[IOS] - Login - Show button hides while typing");
  // Severity starts on Choose… (ver_85): the bug can't be filed until the tester picks one.
  await expect(form.getByLabel("Severity")).toHaveValue("");
  await expect(page.getByRole("dialog").getByRole("button", { name: "File bug in Jira" })).toBeDisabled();
  await form.getByLabel("Severity").selectOption({ index: 3 });
  await page.getByRole("dialog").getByRole("button", { name: "File bug in Jira" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const all = (await (await fetch(`${JIRA}/__issues`)).json()) as Record<string, Issue>;
  const issue = Object.values(all).find((i) => i.summary === "[IOS] - Login - Show button hides while typing")!;
  expect(issue).toBeTruthy();
  expect(issue.fields.components).toEqual([{ name: "Mobile app" }]);
  expect(issue.fields.customfield_12001).toEqual({ value: "Sometimes" });
  expect(issue.fields.versions).toEqual([{ name: "4.12" }]);
  const text = JSON.stringify(issue.description);
  for (const h of ["Steps to Reproduce", "Expected Result", "Actual Result", "Notes", "Only on iPhone"]) expect(text).toContain(h);
  expect(text).not.toContain("Environment");
});

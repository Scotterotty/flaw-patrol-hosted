import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";
import { withTestOko } from "./shared-oko";

// The team bug template (OB-5292): turned on per project in Settings → Jira,
// filled in from the run and case, Context and User name & ID remembered per
// tester, attachments under the description (screenshots first, then logs),
// and every file but a dxdiag listed in the Reproduction History.

const run = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `T${run}`;
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;
type Issue = { summary: string; description: unknown; files: string[]; fields: Record<string, unknown> };
const newest = async () => {
  const all = Object.entries((await (await fetch(`${JIRA}/__issues`)).json()) as Record<string, Issue>).filter(([k]) => k.startsWith("OB-"));
  return all.sort(([a], [b]) => Number(a.split("-")[1]) - Number(b.split("-")[1])).at(-1)!;
};
withTestOko();
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("bugs follow the team template", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await fetch(`${JIRA}/__reporter/on`);
  await signIn(page, "admin@example.com", "Demo Admin");

  await standaloneProject(page, `OKO Unreal ${run}`, KEY);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases`));

  // Connect Jira and turn the template on: the fields are checked and defaults guessed from the name.
  await page.goto(`/p/${KEY}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("OB");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText("Connected as QA Bot.")).toBeVisible();
  // The OKO bug layout is a company template shared by email ending (ver_96): pick it, then set its defaults.
  // ver_144: the layout is changed from Bug templates → Change layout… on the first template.
  await page.locator("#bug-templates").getByRole("button", { name: "Change layout…" }).click();
  const settings = page.getByTestId("bug-template-settings");
  await expect(settings.getByLabel("Plain layout")).toBeChecked();
  await settings.getByLabel(/OKO bug layout/).check();
  await settings.getByRole("button", { name: "Use OKO bug layout" }).click();
  await expect(settings.getByText("Check this place's defaults below.")).toBeVisible();
  const fields = settings.getByTestId("template-fields");
  await expect(fields.getByText("Client/SKUs")).toBeVisible();
  await expect(fields.getByTestId("fields-written")).toContainText("Bug Workaround");
  await expect(fields.getByTestId("fields-filled")).toContainText("Team");
  // Priority is set to Not Prioritized on every bug (ver_143), so Jira's required Priority isn't a warning anymore.
  await expect(fields.getByTestId("fields-filled")).toContainText("Not Prioritized");
  await expect(settings.getByTestId("fields-required")).toHaveCount(0);
  // ver_144: Jira Priority sits in the Jira connection, next to Severity.
  await expect(page.getByLabel("Jira Priority on new bugs")).toHaveValue("Not Prioritized");
  // Severity is only on this Jira's Edit screen: it's filled just after the bug is created.
  await expect(fields.getByTestId("fields-filled").getByRole("listitem").filter({ hasText: "Severity" })).toContainText("just after");
  await expect(fields.getByTestId("fields-later")).toBeVisible();
  await expect(fields.getByTestId("fields-filled").getByRole("listitem").filter({ hasText: "Stakeholder Priority" })).toContainText("Not Prioritized");
  await expect(fields.getByTestId("fields-filled").getByRole("listitem").filter({ hasText: "To Be Automated?" })).toContainText("Maybe");
  await expect(fields.getByTestId("fields-written")).not.toContainText("Last Reproduced");
  await expect(settings.getByLabel("Tag at the start of bug titles")).toHaveValue("UNREAL");
  await expect(settings.getByLabel("Jira Team", { exact: true })).toHaveValue("Unreal");
  await expect(settings.getByRole("group", { name: "Default Client/SKUs" }).getByRole("button", { name: "Unreal" })).toHaveAttribute("aria-pressed", "true");
  await settings.getByRole("group", { name: "Default Client/SKUs" }).getByRole("button", { name: "Windows" }).click();
  await settings.getByRole("button", { name: /^(Save defaults|Use the OKO bug layout)$/ }).click();
  await expect(settings.getByText("Saved. New bugs from here use these defaults.")).toBeVisible();
  await page.reload();
  await page.locator("#bug-templates").getByRole("button", { name: "Change layout…" }).click();
  await expect(settings.getByLabel(/OKO bug layout/)).toBeChecked();
  await expect(settings.getByTestId("template-saved")).toContainText("[UNREAL] - Feature - Brief summary");

  // A qTest-style case and a run with build, CSP and environment.
  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("[UNREAL] - In Space - UI - Assets Panel");
  await page.getByLabel("Step 1 action").fill("Delete the selected asset");
  await page.getByLabel("Step 1 expected result").fill("The asset is removed");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "In Space - UI - Assets Panel" })).toBeVisible();
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Smoke");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByLabel("Release", { exact: true }).fill("RC22");
  await page.getByLabel("Environment").fill("o2QA");
  await page.getByLabel("Version", { exact: true }).fill("2.22.0.4417");
  await page.getByLabel("CSP version").fill("0.22.1");
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await page.getByRole("link", { name: "Start testing" }).click();
  await expect(page).toHaveURL(/\/execute\?entry=/);

  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Failed" }).click();
  await page.getByLabel("Step 1 actual result").fill("The asset is still listed");
  await page.getByRole("button", { name: "Report bug in Jira" }).first().click();
  let dialog = page.getByRole("dialog");
  const form = dialog.getByTestId("bug-template");
  await expect(form).toBeVisible();

  // Filled in from the run and the case.
  await expect(form.getByLabel("Client(s)")).toHaveValue("UNREAL");
  await expect(form.getByLabel("Feature")).toHaveValue("Assets Panel");
  await expect(form.getByLabel("Build #")).toHaveValue("Version 2.22.0.4417 - CSP 0.22.1");
  await expect(form.getByLabel("What happened")).toHaveValue("The asset is still listed");
  // Repro steps start empty for the tester, and "1." then Enter auto-numbers.
  await expect(form.getByLabel("Repro steps")).toHaveValue("");
  const steps = form.getByLabel("Repro steps");
  await steps.click();
  await steps.pressSequentially("1. Open the panel");
  await steps.press("Enter");
  await steps.pressSequentially("Delete the asset");
  await expect(steps).toHaveValue("1. Open the panel\n2. Delete the asset");
  await expect(form.locator("#h-client")).toHaveValue("Unreal\n2.22.0.4417");
  // Starts from the run environment (plus a remembered tenant on a reused database).
  await expect(form.getByLabel("Env & tenant")).toHaveValue(/^o2QA/);
  await expect(form.getByRole("group", { name: "Oly Environment" }).getByRole("button", { name: "o2QA" })).toHaveAttribute("aria-pressed", "true");
  await expect(form.getByRole("group", { name: "Client/SKUs" }).getByRole("button", { name: "Windows" })).toHaveAttribute("aria-pressed", "true");
  await expect(form.getByLabel("Team")).toHaveValue("Unreal");

  // Which clients it takes: the run's client to start with, and a mix can be picked.
  const needed = form.getByRole("group", { name: "Clients needed for repro" });
  await expect(needed.getByRole("button", { name: "Unreal" })).toHaveAttribute("aria-pressed", "true");
  await needed.getByRole("button", { name: "Web" }).click();
  await form.getByLabel("Brief summary").fill("Deleted asset stays in the panel");
  await expect(form.getByTestId("template-title")).toHaveText("[UNREAL] - Assets Panel - Deleted asset stays in the panel");
  await form.getByLabel("Context").fill("Windows 11\nRTX 3070");
  await form.getByLabel("User name & ID").fill("admin.qa\nusr_42");
  await form.getByLabel("Env & tenant").fill("o2QA\nmagnopus-qa");
  // From a run, the tags still say where each box came from (ver_223 only changed Write a bug's).
  await expect(form.locator("label[for=t-feature]")).toContainText("from case");
  await expect(form.locator("label[for=h-client]")).toContainText("run build");
  await form.locator("#h-repros").fill("3/3");
  await expect(form.getByLabel("Repro rate")).toHaveValue("3/3");
  await form.getByLabel("Bug workaround").fill("Reload the space");

  // Logs first on purpose: the bug still shows screenshots before logs.
  await form.getByLabel("+ Add log").setInputFiles([
    { name: "UnrealClient.log", mimeType: "", buffer: Buffer.from("log line") },
    { name: "DxDiag.txt", mimeType: "text/plain", buffer: Buffer.from("System Information") },
  ]);
  await form.getByLabel("+ Add: upload a file").setInputFiles([
    { name: "delete-after.png", mimeType: "image/png", buffer: PNG },
    // A screen recorder's random name gets a friendly one on the bug.
    { name: "5ee7591c-b887-41c6-a13c-1cad88ac1c3c_video.mp4", mimeType: "video/mp4", buffer: Buffer.from("fake video") },
  ]);
  await expect(form.getByRole("checkbox", { name: "delete-after.png" })).toBeChecked();
  await expect(form.getByRole("checkbox", { name: /DxDiag\.txt/ })).toBeChecked();
  await expect(form.getByText("3 files, linked")).toBeVisible();
  await expect(dialog.getByTestId("bug-priority")).toContainText("Not Prioritized");
  // Jira's own five severity names.
  await expect(dialog.getByLabel("Severity").locator("option")).toHaveText(["A - Showstopper", "B - Critical", "C - Problematic", "D - Minor", "E - Enhancement"]);

  await dialog.getByRole("button", { name: "File bug in Jira" }).click();
  await expect(dialog).toBeHidden();

  const [, issue] = await newest();
  expect(issue.summary).toBe("[UNREAL] - Assets Panel - Deleted asset stays in the panel");
  expect(issue.fields.customfield_11427).toEqual([{ value: "Unreal" }, { value: "Windows" }]);
  expect(issue.fields.customfield_11461).toEqual({ value: "Unreal" });
  expect(issue.fields.customfield_11489).toBe("Version 2.22.0.4417 - CSP 0.22.1");
  expect(issue.fields.customfield_11490).toBe("3/3");
  expect(issue.fields.customfield_11428).toEqual([{ value: "o2QA" }]);
  expect(JSON.stringify(issue.fields.customfield_11323)).toContain("Delete the asset");
  expect(issue.fields.customfield_10050).toEqual({ value: "C - Problematic" });
  expect(issue.fields.priority).toEqual({ name: "Not Prioritized" });
  // The rest of OB-5292's fields, set the same way on every bug.
  expect(issue.fields.customfield_11600).toEqual({ value: "Not Prioritized" });
  expect(issue.fields.customfield_11601).toEqual({ value: "Maybe" });
  expect(issue.fields.customfield_11602).toEqual({ value: "Not Started" });
  // Severity went in just after the bug was created, not into the description.
  expect(JSON.stringify(issue.description)).not.toContain("Severity: ");
  // Screenshots go up first, then logs.
  expect(issue.files).toEqual(["delete-after.png", "UNREAL_Assets-Panel_video-1.mp4", "UnrealClient.log", "DxDiag.txt"]);

  const desc = JSON.stringify(issue.description);
  const at = (t: string) => desc.indexOf(t);
  expect(desc).not.toContain("THREADS");
  expect(desc).toContain('"text":"Web, Unreal"');
  // The steps the tester typed, and the trace link back to Flaw Patrol.
  expect(desc).toContain("Filed from Flaw Patrol: ");
  expect(desc).toContain("/execute?entry=");
  expect(at("Issue Observed on: ")).toBeGreaterThan(-1);
  expect(at("The asset is still listed")).toBeLessThan(at("SCREENSHOTS & VIDEOS"));
  expect(at("SCREENSHOTS & VIDEOS")).toBeLessThan(at("LOGS"));
  expect(at("LOGS")).toBeLessThan(at("REPRODUCTION HISTORY"));
  expect(desc).toContain('"type":"mediaSingle"');
  expect(desc).toContain("/secure/attachment/");
  // The history's Attachments column lists every file but the dxdiag.
  const history = desc.slice(at("REPRODUCTION HISTORY"));
  expect(history).toContain("UnrealClient.log");
  expect(history).toContain("delete-after.png");
  expect(history).toContain("/secure/attachment/");
  expect(desc).toContain("UNREAL_Assets-Panel_video-1.mp4");
  expect(desc).not.toContain("5ee7591c");
  expect(history).not.toContain("DxDiag.txt");
  expect(history).toContain("magnopus-qa");
  // Bug Workaround isn't on this Jira's screen, so it rides in the description.
  expect(desc).toContain("Reload the space");

  // Next bug: Context, User name & ID and tenant come back, and stay editable.
  await page.getByRole("button", { name: "Report bug in Jira" }).first().click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Context")).toHaveValue("Windows 11\nRTX 3070");
  await expect(dialog.getByLabel("User name & ID")).toHaveValue("admin.qa\nusr_42");
  await expect(dialog.getByLabel("Env & tenant")).toHaveValue("o2QA\nmagnopus-qa");
  await dialog.getByLabel("Context").fill("macOS 15\nM3");
  await dialog.getByLabel("Brief summary").fill("Second one");
  await dialog.getByLabel("Repro steps").fill("1. Do the thing");
  await dialog.getByLabel("Slack thread (optional)").fill("https://team.slack.com/archives/C1/p2");
  await dialog.getByRole("button", { name: "File bug in Jira" }).click();
  await expect(dialog).toBeHidden();
  const [, second] = await newest();
  expect(JSON.stringify(second.description)).toContain("THREADS");
  expect(JSON.stringify(second.description)).toContain("macOS 15");
});

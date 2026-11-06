import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// Logs and crash dumps attach to bugs whatever type the browser reports: Windows often
// sends a .log as application/octet-stream, which used to be refused.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;

test("a bug takes .log files of any reported type, big logs and crash dumps", async ({ page }) => {
  test.setTimeout(240_000);
  const KEY = `LG${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Logs ${TAG}`, KEY);
  await page.goto(`/p/${KEY}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("QA");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText("Connected as QA Bot.")).toBeVisible();

  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Space thumbnails");
  await page.getByLabel("Step 1 action").fill("Open a space made from a template");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Space thumbnails" })).toBeVisible();
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("All");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create and test now" }).click();
  await expect(page.getByRole("heading", { name: "Space thumbnails", level: 1 })).toBeVisible();

  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Failed" }).click();
  await page.getByLabel("Step 1 actual result").fill("Thumbnail missing");
  await page.getByRole("button", { name: "Report bug in Jira" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Attach to the Jira issue")).toBeVisible();
  const upload = dialog.getByLabel("+ Add: upload a file");

  // Windows labels .log files as binary; a 12 MB log is over the old 10 MB limit.
  await upload.setInputFiles([
    { name: "UnrealGame.log", mimeType: "application/octet-stream", buffer: Buffer.from("LogInit: Display: Running engine\n") },
    { name: "UnrealGame-backup.log.1", mimeType: "", buffer: Buffer.from("LogNet: older run\n") },
    { name: "UEMinidump.dmp", mimeType: "application/octet-stream", buffer: Buffer.from([0x4d, 0x44, 0x4d, 0x50, 0, 0, 1, 2]) },
    { name: "Big.log", mimeType: "text/x-log", buffer: Buffer.alloc(12 * 1024 * 1024, "a") },
  ]);
  for (const name of ["UnrealGame.log", "UnrealGame-backup.log.1", "UEMinidump.dmp", "Big.log"]) {
    await expect(dialog.getByTestId("bug-file").filter({ hasText: name })).toBeVisible({ timeout: 60_000 });
  }

  // Other files are still refused, by name.
  await upload.setInputFiles({ name: "game.exe", mimeType: "application/octet-stream", buffer: Buffer.from([0x4d, 0x5a, 0, 0]) });
  await expect(dialog.getByText("game.exe can't be attached. Attach images, PDFs, logs, crash dumps, JSON, zip or video files.")).toBeVisible();

  await dialog.getByRole("button", { name: "File bug in Jira" }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  const issues = (await (await fetch(`${JIRA}/__issues`)).json()) as Record<string, { files?: string[] }>;
  const filed = Object.values(issues).find((i) => i.files?.includes("UnrealGame.log"))!;
  expect(filed.files).toEqual(expect.arrayContaining(["UnrealGame.log", "UnrealGame-backup.log.1", "UEMinidump.dmp", "Big.log"]));

  // The log opens as text; the dump downloads.
  const log = await page.request.get((await page.getByRole("link", { name: "UnrealGame.log" }).first().getAttribute("href"))!);
  expect(log.headers()["content-type"]).toBe("text/plain");
  expect(await log.text()).toContain("Running engine");
  const dump = await page.request.get((await page.getByRole("link", { name: "UEMinidump.dmp" }).first().getAttribute("href"))!);
  expect(dump.headers()["content-disposition"]).toMatch(/^attachment/);
});

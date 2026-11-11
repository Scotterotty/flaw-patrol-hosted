import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn, backToRun } from "./auth";
import { standaloneProject } from "./projects";

// ver_119: bug templates. Settings → Bug templates makes a template with a file heading and a growing
// table; the bug form picks the default template, says what's missing, and saves the bug here (no Jira);
// the Bugs page shows what was reported and "I saw it again" adds a row.

const KEY = `BT${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("make a bug template, report a bug with it, and add a row with I saw it again", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Templates ${KEY}`, KEY);
  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Checkout");
  for (const [i, text] of ["Open the cart", "Tap Pay"].entries()) {
    if (i > 0) await page.getByRole("button", { name: "+ Add step" }).click();
    await page.getByLabel(`Step ${i + 1} action`).fill(text);
  }
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();

  // Settings → Bug templates: the current layout is listed first and is the default.
  await page.goto(`/p/${KEY}/settings`);
  const section = page.getByTestId("bug-templates");
  await expect(section.getByTestId("bug-template-row")).toHaveCount(1);
  await expect(section.getByTestId("bug-template-row").first()).toContainText("Plain bug");
  await expect(section.getByTestId("bug-template-row").first()).toContainText("Default");

  // New template → Start blank → the editor with a live preview.
  await section.getByRole("button", { name: "New template" }).click();
  const start = page.getByRole("dialog", { name: "New template" });
  await expect(start.getByRole("radio", { name: "Start blank" })).toBeChecked();
  await expect(start.getByRole("radio", { name: "Copy one of these templates" })).toBeDisabled();
  await start.getByLabel("Name").fill("Crash or freeze");
  await start.getByRole("button", { name: "Next" }).click();
  const editor = page.getByTestId("template-editor");
  await expect(editor.getByTestId("template-heading")).toHaveCount(4);
  await editor.getByLabel("When to use it").fill("The app closed or froze");

  // A file heading for the crash log, required, .txt only.
  await editor.getByRole("button", { name: "+ Add heading" }).click();
  const heads = editor.getByTestId("template-heading");
  await heads.nth(4).getByLabel("Heading name").fill("Crash log");
  await heads.nth(4).getByLabel("Where Crash log's text comes from").selectOption({ label: "A file to attach" });
  await heads.nth(4).getByLabel("File types for Crash log").fill(".txt");
  await editor.getByRole("checkbox", { name: "Crash log" }).check();
  // A growing table, starting with the Reproduction history columns.
  await editor.getByRole("button", { name: "+ Add heading" }).click();
  await heads.nth(5).getByLabel("Heading name").fill("Repro history");
  await heads.nth(5).getByLabel("Where Repro history's text comes from").selectOption({ label: "A table" });
  await expect(heads.nth(5).getByLabel("Column name")).toHaveCount(8);
  await expect(heads.nth(5).getByRole("checkbox", { name: /Add a row each time someone sees it again/ })).toBeChecked();
  // Leave out Environment.
  await heads.nth(3).getByLabel("Where Environment's text comes from").selectOption({ label: "Leave out" });

  // The preview follows along.
  const form = editor.getByTestId("template-preview-form");
  await expect(form).toContainText("Crash or freeze");
  await expect(form).toContainText("Add Crash log to report it");
  await editor.getByRole("tab", { name: "The finished bug" }).click();
  await expect(editor.getByTestId("template-preview-bug")).toContainText("crash-log.txt");
  await expect(editor.getByTestId("template-preview-bug")).not.toContainText("Environment");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(editor).toHaveCount(0);

  // It's listed; make it the default.
  const row = section.getByTestId("bug-template-row").filter({ hasText: "Crash or freeze" });
  await expect(row).toContainText("5 headings · a table · asks for a file");
  await row.getByRole("button", { name: "More for Crash or freeze" }).click();
  await row.getByRole("menuitem", { name: "Make default" }).click();
  await expect(row).toContainText("Default");
  // Delete is there for admins.
  await row.getByRole("button", { name: "More for Crash or freeze" }).click();
  await expect(row.getByRole("menuitem", { name: "Delete…" })).toBeEnabled();
  await page.keyboard.press("Escape");

  // A run: step 2 fails, and the bug form opens on the default template.
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Smoke");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
  await page.getByRole("link", { name: "Start testing" }).click();
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" }).click();
  await page.getByRole("group", { name: "Step 2 status" }).getByRole("button", { name: "Failed" }).click();
  await page.getByLabel("Step 2 actual result").fill("The app closed");
  await page.getByRole("button", { name: "Report bug" }).first().click();
  const dialog = page.getByRole("dialog");
  const picker = dialog.getByTestId("template-picker");
  await expect(picker.getByRole("radio", { name: "Crash or freeze" })).toHaveAttribute("aria-checked", "true");
  await expect(picker).toContainText("The app closed or froze");
  const filled = dialog.getByTestId("templated-form");
  await expect(filled.getByLabel("What happened")).toHaveValue("The app closed");
  await expect(filled).toContainText("Steps to reproduce and Expected fill in from the run.");
  await filled.getByRole("button", { name: "Show everything" }).click();
  await expect(filled.getByLabel("Steps to reproduce")).toHaveValue(/Tap Pay/);

  // The crash log is needed: Save bug waits for it, and only .txt files go in.
  await expect(dialog.getByTestId("template-missing")).toHaveText("Add Crash log to report it");
  await expect(dialog.getByRole("button", { name: "Save bug" })).toBeDisabled();
  await filled.getByLabel("Add a file for Crash log").setInputFiles({ name: "crash.png", mimeType: "image/png", buffer: Buffer.from("x") });
  await expect(dialog).toContainText("Crash log takes .txt files, so crash.png wasn't added.");
  await filled.getByLabel("Add a file for Crash log").setInputFiles({ name: "crash.txt", mimeType: "text/plain", buffer: Buffer.from("NullReference at Pay") });
  await expect(filled).toContainText("crash.txt");
  await expect(dialog.getByTestId("template-missing")).toHaveCount(0);
  // The table: automatic cells filled in and still editable (ver_188), Repros typed.
  const table = filled.getByRole("group", { name: "Repro history", exact: true });
  await expect(table.getByLabel("User name & ID")).toHaveValue("Demo Admin");
  await table.getByLabel("User name & ID").fill("Demo Admin (QA)");
  await table.getByLabel("Repros").fill("3/3");
  await filled.getByLabel("Summary").fill("App closes on Pay");
  await expect(filled.getByTestId("templated-title")).toHaveText("Checkout - App closes on Pay");
  await dialog.getByRole("button", { name: "Save bug" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: /Save and (next|finish)/ }).click();
  await backToRun(page);

  const db = new PrismaClient();
  try {
    const bug = await db.defect.findFirstOrThrow({ where: { project: { key: KEY } }, include: { files: true } });
    expect(bug.title).toBe("Checkout - App closes on Pay");
    expect(bug.templateName).toBe("Crash or freeze");
    expect(bug.description).toContain("Crash log\nFiles: crash.txt");
    expect(bug.files.map((f) => f.fileName)).toEqual(["crash.txt"]);
  } finally {
    await db.$disconnect();
  }

  // Bugs page: what was reported, and I saw it again adds a row.
  await page.goto(`/p/${KEY}/bugs`);
  await page.getByRole("button", { name: /What was reported \(Crash or freeze\) · Repro history: 1 row/ }).click();
  const answers = page.getByTestId("bug-answers");
  await expect(answers).toContainText("The app closed");
  await expect(answers.getByRole("link", { name: "crash.txt" })).toBeVisible();
  const rows = answers.getByTestId("bug-rows");
  await expect(rows.locator("tbody tr")).toHaveCount(1);
  await expect(rows).toContainText("3/3");
  await expect(rows).toContainText("Demo Admin (QA)");
  await expect(rows).toContainText("crash.txt");
  await answers.getByRole("button", { name: "I saw it again" }).click();
  const fresh = rows.getByTestId("new-row");
  await expect(fresh.getByLabel("User name & ID")).toHaveValue("Demo Admin");
  await fresh.getByLabel("User name & ID").fill("Demo Admin, second look");
  await fresh.getByLabel("Repros").fill("1/3");
  await answers.getByRole("button", { name: "Save row" }).click();
  await expect(answers).toContainText("Row added.");
  await expect(rows.locator("tbody tr")).toHaveCount(2);
  await expect(rows).toContainText("1/3");
  await expect(rows).toContainText("Demo Admin, second look");

  // Bugs already reported keep their layout when the template is deleted.
  await page.goto(`/p/${KEY}/settings`);
  const again = page.getByTestId("bug-templates").getByTestId("bug-template-row").filter({ hasText: "Crash or freeze" });
  await again.getByRole("button", { name: "More for Crash or freeze" }).click();
  await again.getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("dialog", { name: /Delete Crash or freeze/ }).getByRole("button", { name: "Delete template" }).click();
  await expect(page.getByTestId("bug-templates").getByTestId("bug-template-row")).toHaveCount(1);
  await expect(page.getByTestId("bug-templates").getByTestId("bug-template-row").first()).toContainText("Default");
  await page.goto(`/p/${KEY}/bugs`);
  await page.getByRole("button", { name: /What was reported/ }).click();
  await expect(page.getByTestId("bug-rows").locator("tbody tr")).toHaveCount(2);
});

test("an umbrella keeps its bug templates in its Settings, and a Tester can make one but not delete it", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  const db = new PrismaClient();
  let groupId = "";
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const tester = await db.user.findUniqueOrThrow({ where: { email: "tester@example.com" } });
    const hub = await db.project.create({
      data: { key: `U${KEY}`, name: `Umb ${KEY}`, members: { create: [{ userId: admin.id, role: "ADMIN" }, { userId: tester.id, role: "TESTER" }] } },
    });
    const group = await db.projectGroup.create({ data: { name: `Umb ${KEY}`, hubProjectId: hub.id } });
    groupId = group.id;
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
    await db.bugTemplate.create({ data: { projectId: hub.id, name: "Visual glitch", layout: { title: { platform: true, area: true, build: false }, sections: [{ id: "a", heading: "What looks wrong", source: "text" }] } } });
  } finally {
    await db.$disconnect();
  }
  await page.goto(`/g/${groupId}/settings#bug-templates`);
  const section = page.getByTestId("bug-templates");
  await expect(section).toBeVisible();
  await expect(section.getByTestId("bug-template-row")).toHaveCount(2);
  // ver_144: no separate Jira bug layout row; the first template has the layout itself.
  await expect(page.getByRole("listitem").filter({ hasText: "Jira bug layout" })).toHaveCount(0);

  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const tp = await ctx.newPage();
  await signIn(tp, "tester@example.com", "Sam Tester");
  await tp.goto(`/g/${groupId}/settings#bug-templates`);
  const row = tp.getByTestId("bug-templates").getByTestId("bug-template-row").filter({ hasText: "Visual glitch" });
  await expect(row.getByRole("button", { name: "Edit…" })).toBeVisible();
  await row.getByRole("button", { name: "More for Visual glitch" }).click();
  await expect(row.getByRole("menuitem", { name: "Delete…" })).toBeDisabled();
  await expect(row.getByRole("menuitem", { name: "Delete…" })).toHaveAttribute("title", /Only Admins can delete/);
  await ctx.close();
});

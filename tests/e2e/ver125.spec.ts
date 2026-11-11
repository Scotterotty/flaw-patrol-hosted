import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_125: bug templates in bug bashes. The start box picks the team's default template, Log a bug
// shows its headings and what's still needed but logs anyway, Live finds says Needs 1 and anyone can
// add it, +1 adds a table row, and wrap-up holds back a bug that isn't ready until it's filled in.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();

test("a bug bash with a bug template: log now, fill in later, file when ready", async ({ page }) => {
  test.setTimeout(400_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  const KEY = `BB${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Bash templates ${TAG}`, KEY);

  // A template with a must-have, a choice and a growing table, made the default.
  const db = new PrismaClient();
  const project = await db.project.findFirstOrThrow({ where: { key: KEY } });
  const cols = [
    { name: "When", fill: "now" },
    { name: "Browser", fill: "device" },
    { name: "Who", fill: "who" },
  ];
  const s = (id: string, heading: string, source: string, extra = {}) => ({ id, heading, source, hint: "", choices: [], must: false, types: "", paste: false, columns: [], growing: false, ...extra });
  const tpl = await db.bugTemplate.create({
    data: {
      projectId: project.id,
      name: "UI bug",
      hint: "Something looks or acts wrong",
      layout: {
        title: { platform: false, area: true, build: false },
        sections: [s("s1", "Steps to see it", "text", { must: true }), s("s2", "Screen size", "choice", { choices: ["Phone", "Desktop"] }), s("s3", "What happened", "actual"), s("s4", "Seen by", "table", { columns: cols, growing: true })],
        shot: false,
        fields: [],
        from: "",
      },
    },
  });
  await db.project.update({ where: { id: project.id }, data: { bugTemplateDefault: tpl.id } });

  // Start a bug bash: Bug template starts on the default.
  await page.goto(`/p/${KEY}/bashes`);
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const box = page.getByRole("dialog");
  const pick = box.getByRole("radiogroup", { name: "Bug template" });
  await expect(pick.getByRole("radio", { name: "UI bug" })).toHaveAttribute("aria-checked", "true");
  await expect(box.getByTestId("bash-bug-template")).toContainText("your team's default");
  await box.getByLabel("Name").fill(`Template bash ${TAG}`);
  await box.getByLabel("Add an area").fill("Checkout");
  await box.getByLabel("Add an area").press("Enter");
  await box.getByRole("button", { name: "Start bug bash" }).click();
  await box.getByRole("link", { name: "Open the bash" }).click();
  await expect(page.getByTestId("board-bugs-use")).toHaveText("UI bug");
  const board = page.url().replace(/\?.*$/, "");

  await page.getByTestId("join-strip").getByRole("button", { name: "Join the bug bash" }).click();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Start bashing" }).click();
  await expect(page).toHaveURL(/\/explore$/);
  await expect(page.getByLabel("Bugs use")).toHaveValue(tpl.id);

  // Log a bug: the template's headings, what's still needed, and it logs anyway.
  const logBox = page.getByTestId("bash-template-box");
  await expect(logBox.getByRole("radio", { name: "UI bug" })).toHaveAttribute("aria-checked", "true");
  await expect(logBox.getByLabel(/Steps to see it/)).toBeVisible();
  await expect(logBox.getByText("Screen size")).toHaveCount(0);
  await expect(logBox).toContainText("Filled in for you");
  await expect(page.getByRole("button", { name: "Add steps and details" })).toHaveCount(0);
  await page.getByLabel("What did you find?").fill(`Total doesn't update ${TAG}`);
  await expect(page.getByTestId("bash-still-needed")).toContainText("Steps to see it");
  await page.getByRole("button", { name: "Log bug" }).click();
  await expect(page.getByText("Bug logged. It's at the top of Live finds, marked Needs 1.")).toBeVisible();

  // A second one, with the choice folded under Add more, also missing its steps.
  await page.getByLabel("What did you find?").fill(`Coupon box jumps ${TAG}`);
  await logBox.getByRole("button", { name: "Add more (2)" }).click();
  await logBox.getByRole("radio", { name: "Phone" }).click();
  await page.getByRole("button", { name: "Log bug" }).click();
  await expect(page.getByText("marked Needs 1.")).toBeVisible();

  // Live finds: Needs 1, and anyone can add it. Then it's Ready.
  const live = page.getByTestId("live-finds");
  const row = live.locator("li").filter({ hasText: `Total doesn't update ${TAG}` });
  await expect(row.getByTestId("needs-tag")).toHaveText("Needs 1");
  await row.getByRole("button", { name: new RegExp(`Total doesn't update ${TAG}`) }).click();
  const needs = row.getByTestId("find-needs");
  await expect(needs).toContainText("Still needed before it's filed: Steps to see it");
  await needs.getByLabel(/Steps to see it/).fill("1. Add two items\n2. Remove one");
  await needs.getByRole("button", { name: "Add", exact: true }).click();
  await expect(row.getByTestId("needs-tag")).toHaveText("Ready");
  await expect(row.getByTestId("find-needs")).toHaveCount(0);
  await expect(row.getByText("Seen by")).toBeVisible();

  // The table starts with the logger's own row (+1 rows are covered by the unit tests).
  const item = await db.bashItem.findFirstOrThrow({ where: { text: `Total doesn't update ${TAG}` } });
  expect((item.answers as { id: string; rows?: string[][] }[]).find((a) => a.id === "s4")!.rows).toHaveLength(1);

  // Wrap up: Ready? shows which is which; the one still missing its steps is held back.
  await page.goto(board);
  await page.getByRole("button", { name: "End early" }).click();
  await page.getByRole("button", { name: "Yes, end it" }).click();
  await expect(page.getByRole("columnheader", { name: "Ready?" })).toBeVisible();
  // ver_220: only ready bugs count on the button; the other stays until it's filled in.
  await expect(page.getByTestId("bash-not-ready")).toContainText("The one that needs something stays here");
  await expect(page.getByRole("button", { name: "File 1 bug and wrap up" })).toBeVisible();

  // Fill in, Save, and both file.
  await page.getByRole("button", { name: "Fill in" }).click();
  const fill = page.getByTestId("bash-fill-in");
  await fill.getByLabel(/Steps to see it/).fill("1. Type a code\n2. Watch the box");
  await fill.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("bash-not-ready")).toHaveCount(0);
  await page.getByRole("button", { name: "File 2 bugs and wrap up" }).click();
  await expect(page).toHaveURL(/\/report$/, { timeout: 30_000 });

  // Both went to the bug list with the template's headings and where they were found.
  const bugs = await db.defect.findMany({ where: { projectId: project.id }, orderBy: { number: "asc" } });
  expect(bugs).toHaveLength(2);
  for (const b of bugs) {
    expect(b.templateName).toBe("UI bug");
    expect(b.description).toContain("Steps to see it");
    expect(b.description).toContain(`Found in\nThe bug bash Template bash ${TAG}, area Checkout`);
  }
  expect(bugs[0].title).toBe(`Checkout - Total doesn't update ${TAG}`);
  expect(bugs[1].description).toContain("Screen size\nPhone");
  await db.$disconnect();
});

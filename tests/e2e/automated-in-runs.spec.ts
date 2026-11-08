import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// Automated cases stay out of runs people test by hand unless "Also include the automated
// cases" is ticked, are tagged 🤖 Automated where they do go in, and an older run that has
// them offers "Take them out of this run" (untested only, with Undo) and Remove from run.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `AU${TAG}`;
const csv = [
  "Title,Type,Steps,Expected Result",
  `Hand one ${TAG},Manual,Open the shop,Shop shows`,
  `Hand two ${TAG},Manual,Open the cart,Cart shows`,
  `Bot one ${TAG},Automated,Add an item,Item added`,
  `Bot two ${TAG},Automated,Remove an item,Item removed`,
].join("\n");

test("automated cases are left out of hand-tested runs unless asked, and can be taken out", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Auto ${TAG}`, KEY);
  await page.goto(`/p/${KEY}/import`);
  await page.locator('input[type="file"]').setInputFiles({ name: "shop.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByLabel(/Don't use folders/).check();
  await page.getByLabel(/No, they're brand new/).check();
  await page.getByRole("button", { name: "Import 4 cases" }).click();
  await expect(page.getByText("Imported 4 test cases")).toBeVisible();

  // Every case: only the 2 tested by hand, with the tick box off.
  await page.goto(`/p/${KEY}/runs`);
  await page.getByRole("button", { name: "Create a run" }).first().click();
  let box = page.getByRole("dialog", { name: "Create a run" });
  await expect(box.getByRole("button", { name: /Every case/ })).toContainText("2 cases you test by hand");
  await box.getByRole("button", { name: /Every case/ }).click();
  await expect(box.getByTestId("with-auto")).toContainText("Also include the 2 automated cases");
  await expect(box.getByTestId("with-auto").getByRole("checkbox")).not.toBeChecked();

  // Pick cases lists them, tagged; Tick all skips them.
  await box.getByRole("button", { name: /Pick cases/ }).click();
  await expect(box.getByRole("list", { name: "Cases to pick" }).getByTestId("auto-tag")).toHaveCount(2);
  await box.getByRole("button", { name: "Tick all 2" }).click();
  await box.getByRole("button", { name: /Every case/ }).click();
  await box.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
  await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
  await expect(page.getByText(`Bot one ${TAG}`)).toHaveCount(0);

  // Ticked: all 4 go in, tagged, and no note on a run that asked for them.
  await page.goto(`/p/${KEY}/runs`);
  await page.getByRole("button", { name: "Create a run" }).first().click();
  box = page.getByRole("dialog", { name: "Create a run" });
  await box.getByRole("button", { name: /Every case/ }).click();
  await box.getByTestId("with-auto").getByRole("checkbox").check();
  await box.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
  await expect(page.getByText("4 of 4", { exact: true })).toBeVisible();
  await expect(page.getByTestId("auto-tag")).toHaveCount(2);
  await expect(page.getByTestId("auto-note")).toHaveCount(0);

  // An older run (made before this change) has them by mistake: the note offers to take them out.
  const runUrl = page.url();
  const number = Number(runUrl.split("/").pop());
  const db = new PrismaClient();
  try {
    const project = await db.project.findUniqueOrThrow({ where: { key: KEY } });
    await db.testRun.update({ where: { projectId_number: { projectId: project.id, number } }, data: { withAutomated: false } });
  } finally {
    await db.$disconnect();
  }
  await page.reload();
  const note = page.getByTestId("auto-note");
  await expect(note).toContainText("2 automated cases are in this run.");
  await note.getByRole("button", { name: "Take them out of this run" }).click();
  await expect(page.getByTestId("removed-note")).toContainText("Took 2 cases out of this run.");
  await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();

  // Undo puts them back.
  await page.getByTestId("removed-note").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("4 of 4", { exact: true })).toBeVisible();
  await expect(page.getByTestId("auto-note")).toBeVisible();

  // Remove from run on one case; Keep them hides the note for good.
  // ver_200: Remove from run sits under the row's ⋯.
  await page.getByRole("button", { name: `Options for ${KEY}-1` }).click();
  await page.getByRole("menuitem", { name: new RegExp(`Remove ${KEY}-1 from run`) }).click();
  await expect(page.getByText("3 of 3", { exact: true })).toBeVisible();
  await page.getByTestId("removed-note").getByRole("button", { name: "Dismiss" }).click();
  await page.getByTestId("auto-note").getByRole("button", { name: "Keep them" }).click();
  await expect(page.getByTestId("auto-note")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("auto-note")).toHaveCount(0);

  // The run list in the runner tags them too.
  await page.goto(`${runUrl}/execute`);
  await expect(page.getByRole("list", { name: "Run list" }).getByTestId("auto-tag")).toHaveCount(2);
});

import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Lib ${TAG}`;
const HUB = `L${TAG}`;

// A qTest run export like Scott's R22 file: a stray "UPDATE" in a step row's Name, and a folder named "Shared / Unique Cases".
const csv = [
  "Key,Name,Folder,Step Order,Step Description,Expected Result",
  `PQ-1747,[WEB] - Hub - Sidebar,2026 Cases/Test Personas/WEB,1.1,Open the hub,Hub opens`,
  `,UPDATE,,1.2,Open the sidebar,Sidebar opens`,
  `PQ-1747,[WEB] - Hub - Sidebar,2026 Cases/Test Personas/WEB,1.3,Close the sidebar,Sidebar closes`,
  `PQ-1740,[WEB] - Hub - Asset Selection,2026 Cases/Test Personas/WEB,1,Pick an asset,Asset shows`,
  `PQ-2250,[UNIQUE CASES] SSO,2026 Cases/Shared / Unique Cases,1,Sign in with SSO,Signed in`,
].join("\n");

test("imports go to the umbrella's Case library, in one folder or the file's folders, and cases and folders move by dragging", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");

  // An umbrella with one test cycle.
  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Product name").fill(NAME);
  await box.getByLabel("Key").fill(HUB);
  await box.getByTestId("u-more").click();
  await box.getByLabel("Release", { exact: true }).fill("RC22");
  await box.getByLabel("Platform 1").fill("Web");
  await box.getByRole("button", { name: `Make ${NAME} with 1 new test cycle` }).click();
  await expect(page).toHaveURL(/\/g\//);
  const db = new PrismaClient();
  const cycle = await db.project.findFirstOrThrow({ where: { name: `${NAME} Web RC22` } });
  await db.$disconnect();

  // Importing from inside the test cycle still defaults to the Case library.
  await page.goto(`/p/${cycle.key}/import`);
  await page.locator('input[type="file"]').setInputFiles({ name: "R22 Test Cycle - Web.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByRole("radio", { name: new RegExp(`${NAME} case library`) })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Only this test cycle/ })).not.toBeChecked();
  await expect(page.getByText("Preview: 3 cases")).toBeVisible();
  // The stray row stays a step of the case above.
  // ver_107: plain words, and Show me the step opens the case at that step.
  const warnings = page.getByTestId("import-warnings");
  await expect(warnings).toContainText("1 thing to check before you import");
  await expect(warnings).toContainText('That row (row 3 in your file) had "UPDATE" in the Name column, so it was treated as a step, not a new case.');
  await warnings.getByRole("button", { name: "Show me the step" }).click();
  await expect(page.getByText("From row 3, no Key")).toBeVisible();

  // Folders from the file: a tree preview, and the slashed name can stay one folder.
  await page.getByLabel("Use the file's folders").check();
  const tree = page.getByRole("list", { name: "Folders this import makes" });
  await expect(tree).toContainText("Unique Cases");
  await expect(page.getByText(/has a slash, so it becomes two folders/)).toBeVisible();
  await page.getByRole("button", { name: "Keep it as one folder" }).click();
  await expect(tree).toContainText("Shared - Unique Cases");
  await expect(page.getByRole("button", { name: "Import 3 cases" })).toBeDisabled();
  await page.getByLabel(/Yes, we've run them before/).check();
  await page.getByRole("button", { name: "Import 3 cases" }).click();
  await expect(page.getByText(`Imported 3 test cases into the ${NAME} case library`)).toBeVisible();
  await page.getByRole("link", { name: "View cases" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${HUB}/cases`));
  await expect(page.getByRole("heading", { name: `${NAME} case library` })).toBeVisible();
  const folders = page.locator("aside");
  await expect(folders.getByRole("link", { name: "Shared - Unique Cases" })).toBeVisible();
  await page.goto(`/p/${HUB}/cases/1`);
  await expect(page.getByRole("cell", { name: "Open the sidebar" })).toBeVisible();

  // A second file, all in one new folder; the file's Folder column is ignored.
  await page.goto(`/p/${cycle.key}/import`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "more.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(["Key,Name,Folder,Step Description,Expected Result", "PQ-9,Store loads,Deep/Path,Open store,Store shows", "PQ-10,Store search,Deep/Path,Search,Results"].join("\n")),
  });
  // ver_91: a file with folders keeps them by default; choose one folder instead.
  await expect(page.getByLabel("Use the file's folders")).toBeChecked();
  await page.getByLabel("Put them all in one folder").check();
  await expect(page.getByText("Not used: all cases go in one folder")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import 2 cases/ })).toBeDisabled();
  await page.getByLabel("New folder name").fill("Store");
  await page.getByLabel(/Yes, we've run them before/).check();

  await page.getByRole("button", { name: 'Import 2 cases into "Store"' }).click();
  await expect(page.getByText(`Imported 2 test cases into the ${NAME} case library`)).toBeVisible();

  // Drag a case onto another folder, then undo.
  await page.goto(`/p/${HUB}/cases`);
  await expect(folders.getByRole("link", { name: "Store" })).toBeVisible();
  await expect(folders.getByRole("link", { name: "Deep" })).toHaveCount(0);
  await page.getByRole("row", { name: /Store loads/ }).dragTo(folders.locator('[data-folder="WEB"]'));
  await expect(page.getByText("Moved 1 case to WEB.")).toBeVisible();
  await page.goto(`/p/${HUB}/cases?q=Store+loads`);
  await expect(page.getByRole("row", { name: /Store loads/ })).toContainText("WEB");
  await page.goto(`/p/${HUB}/cases`);
  await page.getByRole("row", { name: /Store search/ }).dragTo(folders.locator('[data-folder="WEB"]'));
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Moved 1 case to WEB.")).toHaveCount(0);
  await page.goto(`/p/${HUB}/cases?q=Store+search`);
  await expect(page.getByRole("row", { name: /Store search/ })).toContainText("Store");

  // Move a whole folder with Move folder…
  await page.goto(`/p/${HUB}/cases`);
  await folders.locator('[data-folder="Store"]').hover();
  // ver_161: folder actions live in the ⋯ menu.
  await folders.locator('[data-folder="Store"]').getByRole("button", { name: "More for Store" }).click();
  await page.getByRole("menu", { name: "Store folder" }).getByRole("menuitem", { name: "Move…" }).click();
  const move = page.getByRole("dialog", { name: 'Move "Store"' });
  await move.getByLabel("Move it into").selectOption({ label: "2026 Cases" });
  await move.getByRole("button", { name: "Move folder" }).click();
  // The box closes once the move is saved; opening another page first can beat the save.
  await expect(move).toHaveCount(0);
  await page.goto(`/p/${HUB}/cases?q=Store+search`);
  await expect(page.getByRole("row", { name: /Store search/ })).toContainText("2026 Cases / Store");
});

test("shared steps go in between steps, with a preview, and say what changed", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  const KEY = `SI${TAG}`;
  const db = new PrismaClient();
  const user = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
  await db.project.create({
    data: {
      key: KEY,
      name: `Insert ${TAG}`,
      members: { create: { userId: user.id, role: "ADMIN" } },
      sharedSteps: {
        create: {
          name: "Open search bar",
          versions: {
            create: {
              version: 1,
              name: "Open search bar",
              parameters: [{ name: "browser", defaultValue: "Chrome" }],
              steps: [
                { action: "Click the search bar in {{browser}}", expected: "" },
                { action: "Type koala", expected: "" },
              ],
              authorName: "Demo Admin",
            },
          },
        },
      },
    },
  });
  await db.$disconnect();

  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Search works");
  await page.getByLabel("Step 1 action").fill("Launch the client");
  await page.getByRole("button", { name: "+ Add step" }).click();
  await page.getByLabel("Step 2 action").fill("Open the store");
  // Hovering between steps 1 and 2 offers a shared step right there.
  await page.getByRole("button", { name: "Insert a shared step between steps 1 and 2" }).click({ force: true });
  const picker = page.getByRole("dialog", { name: "Insert shared step" });
  await expect(picker.getByText("Click the search bar in Chrome")).toBeVisible();
  await picker.getByRole("button", { name: "Add 2 steps after step 1" }).click();
  await expect(page.getByText("Added 2 shared steps as 2.1 to 2.2. Your other steps didn't change. Press Create case to keep it.")).toBeVisible();
  await expect(page.getByLabel("Step 3 action")).toHaveValue("Open the store");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("cell", { name: "Click the search bar in Chrome" })).toBeVisible();
});

import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_138, test data on test cases: an optional table under the steps. Each column is a {{blank}},
// the case runs once per row, each row gets its own pass or fail, bugs and history name the row,
// and the case library tags the case "3 rows".

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `TD${TAG}`;

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const project = await db.project.create({ data: { key: KEY, name: `Test data ${TAG}`, caseSeq: 1, members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
    await db.testCase.create({
      data: {
        projectId: project.id,
        number: 1,
        title: "Sign in and see the right menu",
        versions: {
          create: {
            version: 1,
            title: "Sign in and see the right menu",
            preconditions: "",
            priority: "MEDIUM",
            type: "MANUAL",
            tags: [],
            steps: [
              { kind: "step", action: "Sign in as {{role}}", expected: "Home page opens" },
              { kind: "step", action: "Open the menu", expected: "The menu shows {{menu}}" },
            ],
          },
        },
      },
    });
  } finally {
    await db.$disconnect();
  }
});

test("a case runs once per row of test data", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");

  // The box is one dashed line with a plain example until someone opens it.
  await page.goto(`/p/${KEY}/cases/1/edit`);
  const box = page.getByRole("region", { name: "Test data" });
  await expect(box.getByText(/Run these steps more than once with different values/)).toBeVisible();
  await box.getByRole("button", { name: "+ Add test data" }).click();
  // It starts with the blanks the steps already use.
  await expect(box.getByLabel("Column 1 name")).toHaveValue("role");
  await expect(box.getByLabel("Column 2 name")).toHaveValue("menu");
  await box.getByLabel("Row 1 role").fill("admin");
  await box.getByLabel("Row 1 menu").fill("Settings");
  await box.getByLabel("Row 2 role").fill("viewer");
  await box.getByLabel("Row 2 menu").fill("no Settings");
  await box.getByRole("button", { name: "+ Add row" }).click();
  await box.getByLabel("Row 3 role").fill("guest");
  await box.getByLabel("Row 3 menu").fill("no Settings");
  await expect(box.getByTestId("test-data-count")).toHaveText("3 of 20 rows · runs 3 times");
  // A column no step uses gets a plain warning, and goes away when removed.
  await box.getByRole("button", { name: "+ Add column" }).click();
  await box.getByLabel("Column 3 name").fill("user os");
  await expect(box.getByLabel("Column 3 name")).toHaveValue("user_os");
  await expect(box.getByTestId("test-data-unused")).toContainText("The column user_os isn't in any step yet.");
  await box.getByRole("button", { name: "Remove column user_os" }).click();
  await expect(box.getByTestId("test-data-unused")).toHaveCount(0);
  await page.getByLabel("What changed? (optional)").fill("Added roles");
  await page.getByRole("button", { name: "Save new version" }).first().click();

  // The case page shows the table, and the library tags the case.
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases/1$`));
  const view = page.getByRole("region", { name: "Test data" });
  await expect(view.getByText("Runs 3 times, once for each row")).toBeVisible();
  await expect(view.getByRole("cell", { name: "viewer" })).toBeVisible();
  await page.goto(`/p/${KEY}/cases`);
  await expect(page.getByTestId("data-rows-tag")).toHaveText("3 rows");
  // Compare versions says what changed in the table.
  await page.goto(`/p/${KEY}/cases/1/versions/2`);
  await expect(page.getByText("Test data added: 3 rows.")).toBeVisible();

  // Run it from a suite: the run keeps one copy of the steps per row.
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Menus");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page.getByRole("heading", { name: "Menus" })).toBeVisible();
  await page.getByRole("button", { name: "Start test run" }).click();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/runs/1$`));
  await page.getByRole("link", { name: "Start testing" }).click();

  const rows = page.getByRole("tablist", { name: "Test data rows" });
  await expect(rows.getByRole("tab")).toHaveCount(3);
  await expect(rows.getByRole("tab", { selected: true })).toContainText("Row 1");
  // The real values show, in blue, and the {{blanks}} never do.
  await expect(page.locator("[data-test-value]", { hasText: "admin" })).toBeVisible();
  await expect(page.getByText("{{role}}")).toHaveCount(0);

  // Row 1 passes; passing its last step moves on to row 2.
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" }).click();
  await page.getByRole("group", { name: "Step 2 status" }).getByRole("button", { name: "Passed" }).click();
  await expect(rows.getByRole("tab", { selected: true })).toContainText("Row 2");
  await expect(rows.getByRole("tab").nth(0)).toContainText("Passed");
  await expect(page.locator("[data-test-value]", { hasText: "viewer" })).toBeVisible();

  // Row 2 fails at step 2; the bug names the row.
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" }).click();
  await page.getByRole("group", { name: "Step 2 status" }).getByRole("button", { name: "Failed" }).click();
  await page.getByLabel("Step 2 actual result").fill("Settings still shows");
  await page.getByRole("button", { name: "Report bug" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Summary")).toHaveValue(/\(viewer · no Settings\)$/);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("test-data-rows-line")).toContainText("1 of 3 rows passed, 1 failed, 1 not finished");

  // ] moves to row 3, which passes with the keys.
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("]");
  await expect(rows.getByRole("tab", { selected: true })).toContainText("Row 3");
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" }).click();
  await page.getByRole("group", { name: "Step 2 status" }).getByRole("button", { name: "Passed" }).click();
  await expect(page.getByTestId("test-data-rows-line")).toContainText("2 of 3 rows passed, 1 failed.");
  await page.getByRole("button", { name: /^Save and (finish|next)$/ }).click();
  await expect(page.getByText(/last case in R1|Every case has a result/)).toBeVisible();

  // History: one pip, striped per row, naming the failing row. Reports count the case once.
  await page.goto(`/p/${KEY}/cases/1`);
  const pip = page.locator('a.st-pip[title*="Row 2 failed"]');
  await expect(pip).toHaveCount(1);
  await expect(pip.locator("[data-row-stripe]")).toHaveCount(3);
  await expect(page.getByText("2 of 3 rows passed")).toBeVisible();
});

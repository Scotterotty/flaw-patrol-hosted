import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_94: bug bash bugs that weren't filed still count (File it tick box, Left out,
// File this bug… from the report), pass/fail only (no Bug found), and Import cases.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();

test("a bug left out at wrap-up still counts and can be filed from the report", async ({ page }) => {
  test.setTimeout(300_000);
  const KEY = `NF${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Unfiled ${TAG}`, KEY);

  // The Case library's import button says what it imports.
  await page.goto(`/p/${KEY}/cases`);
  await expect(page.getByRole("link", { name: "Import cases" }).first()).toBeVisible();

  await page.goto(`/p/${KEY}/bashes`);
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Name").fill(`Sign in ${TAG}`);
  await box.getByLabel("Add an area").fill("Sign in");
  await box.getByLabel("Add an area").press("Enter");
  await box.getByRole("button", { name: "Start bug bash" }).click();
  await box.getByRole("link", { name: "Open the bash" }).click();

  await page.goto(`/p/${KEY}/bashes`);
  await page.getByRole("link", { name: "Join" }).first().click();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Start bashing" }).click();
  const find = page.getByLabel("What did you find?");
  await find.fill("App crashed on a wrong password");
  // The bash's levels say what they file as.
  await page.getByRole("radiogroup", { name: "How bad?" }).getByRole("radio", { name: "High" }).click();
  await expect(page.getByTestId("bash-files-as")).toHaveText("Files as Critical");
  await page.getByRole("button", { name: "Log bug" }).click();
  await expect(page.getByText("App crashed on a wrong password").first()).toBeVisible();
  await find.fill("Logo looks blurry");
  await page.getByRole("button", { name: "Log bug" }).click();
  await expect(page.getByText("Logo looks blurry").first()).toBeVisible();

  const db = new PrismaClient();
  const bash = await db.bugBash.findFirstOrThrow({ where: { project: { key: KEY } } });
  await db.$disconnect();
  await page.goto(`/p/${KEY}/bashes/${bash.id}`);
  await page.getByRole("button", { name: "End early" }).click();
  await page.getByRole("button", { name: "Yes, end it" }).click();

  // Wrap-up: every bug starts ticked; untick one and the button says exactly what happens.
  await expect(page.getByRole("heading", { name: "Review 2 bugs" })).toBeVisible();
  await expect(page.getByRole("button", { name: "File 2 bugs and wrap up" })).toBeVisible();
  await page.getByLabel("File Logo looks blurry").uncheck();
  await expect(page.getByText("Left out")).toBeVisible();
  await page.getByRole("button", { name: "File 1 bug and wrap up" }).click();
  await expect(page).toHaveURL(new RegExp(`/bashes/${bash.id}/report`), { timeout: 60_000 });

  // The report counts both, tags the one left out, and files it on request.
  await expect(page.getByText("Bugs found")).toBeVisible();
  await expect(page.getByText("1 not filed yet")).toBeVisible();
  await expect(page.getByTestId("bash-unfiled-banner")).toBeVisible();
  await expect(page.getByRole("heading", { name: "All 2 bugs" })).toBeVisible();
  const dialog = page.getByRole("dialog");
  // The report is a fresh page load: click again until it has hydrated and the box opens.
  await expect(async () => {
    await page.getByRole("button", { name: "File this bug…" }).click();
    await expect(dialog.getByLabel("Summary")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await expect(dialog.getByLabel("Summary")).toHaveValue("Logo looks blurry");
  await dialog.getByRole("button", { name: "Save bug" }).click();
  await expect(page.getByTestId("bash-unfiled-banner")).toHaveCount(0);
  await expect(page.getByText("Left out")).toHaveCount(0);
});

test("tick umbrellas to hide them for yourself, show them again, and archive", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  const names = [`Hide A ${TAG}`, `Hide B ${TAG}`];
  for (const [i, name] of names.entries()) {
    await page.goto("/");
    await page.getByRole("button", { name: "New umbrella" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Product name").fill(name);
    await dialog.getByLabel("Key").fill(`H${i}${TAG}`);
    await dialog.getByTestId("u-more").click();
    await dialog.getByLabel("Release", { exact: true }).fill("RC1");
    await dialog.getByLabel("Platform 1").fill("Web");
    await dialog.getByRole("button", { name: /Make / }).click();
    await expect(page).toHaveURL(/\/g\//);
  }
  await page.goto("/");
  // Ticking shows the bar; Hide for me moves it to Hidden by you, for this person only.
  await page.getByLabel(`Tick ${names[0]}`).check();
  const bar = page.getByRole("region", { name: "Ticked umbrellas" });
  await expect(bar.getByText("1 selected")).toBeVisible();
  await bar.getByRole("button", { name: "Hide for me" }).click();
  await expect(page.getByLabel(`Tick ${names[0]}`)).toHaveCount(0);
  await page.getByText(/Hidden by you/).click();
  const hidden = page.getByRole("region", { name: `${names[0]} umbrella` });
  await hidden.getByRole("button", { name: "Show again" }).click();
  await expect(page.getByLabel(`Tick ${names[0]}`)).toBeVisible();

  // Archive… asks first, on the page, then archives for everyone.
  await page.getByLabel(`Tick ${names[1]}`).check();
  await bar.getByRole("button", { name: "Archive…" }).click();
  await expect(bar.getByText(`Archive ${names[1]}, and its 1 test cycle?`)).toBeVisible();
  await bar.getByRole("button", { name: "Yes, archive" }).click();
  await expect(page.getByLabel(`Tick ${names[1]}`)).toHaveCount(0);
  await expect(page.getByText(/Archived \(/)).toBeVisible();
});

test("Arrange menu order: a link dragged with the mouse stays where it's dropped", async ({ page }) => {
  test.setTimeout(180_000);
  const KEY = `AM${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Arrange ${TAG}`, KEY);
  await page.goto(`/p/${KEY}/cases`);
  const nav = page.getByRole("navigation", { name: new RegExp(`^Arrange ${TAG}`) }).first();
  await nav.getByRole("button", { name: /Arrange menu order/ }).click();
  // A real mouse drag (ver_94): the link slides under the pointer and is dropped onto itself.
  const from = nav.getByRole("button", { name: /^Move Charters/ });
  const onto = nav.getByRole("button", { name: /^Move Requirements/ });
  const a = (await from.boundingBox())!;
  const b = (await onto.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + ((b.y - a.y + 4) * i) / 8);
  await page.mouse.up();
  await nav.getByRole("button", { name: "Done" }).click();
  await page.reload();
  await expect(nav).toContainText(/Requirements\s*Charters/);
  // Back to the default order, so other tests see the usual menu.
  await nav.getByRole("button", { name: /Arrange menu order/ }).click();
  await nav.getByRole("button", { name: "Reset to default order" }).click();
  await expect(nav).toContainText(/Charters[\s\d⠿]*Requirements/);
});

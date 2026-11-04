import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Flow ${TAG}`;
const HUB = `F${TAG}`;
const LOOSE = `FL${TAG}`;

test("projects are made inside umbrellas: New umbrella makes its first projects, the hub adds or moves in more", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  // A project from before umbrellas, to move in from the hub later.
  await standaloneProject(page, `Loose ${TAG}`, LOOSE);

  // The Projects page has one way in: New umbrella. Projects outside umbrellas get their own heading.
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New test cycle" })).toHaveCount(0);
  await page.getByRole("button", { name: "New umbrella" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Product name").fill(NAME);
  await dialog.getByLabel("Key").fill(HUB);
  await dialog.getByLabel("Release", { exact: true }).fill("RC1");
  await dialog.getByLabel("Platform 1").fill("Web");
  await expect(dialog.getByLabel("Test cycle name 1")).toHaveValue(`${NAME} Web RC1`);
  await dialog.getByRole("button", { name: "＋ Add a platform" }).click();
  await dialog.getByLabel("Platform 2").fill("Unity");
  await dialog.getByRole("button", { name: "＋ Add a platform" }).click();
  // No platform, just a name.
  await dialog.getByLabel("Test cycle name 3").fill(`Accessibility ${TAG}`);
  await dialog.getByRole("button", { name: `Make ${NAME} with 3 new test cycles` }).click();
  await expect(page).toHaveURL(/\/g\//);
  const home = page.url();
  for (const n of [`${NAME} Web RC1`, `${NAME} Unity RC1`, `Accessibility ${TAG}`]) await expect(page.getByRole("link", { name: n }).first()).toBeVisible();

  // The project from before umbrellas sits under its own heading on the Projects page.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Not in an umbrella" })).toBeVisible();

  // Its platforms are ready for Start next release.
  // (ver_86: there's no Settings row for them any more.)
  const db = new PrismaClient();
  try {
    const group = await db.projectGroup.findFirstOrThrow({ where: { name: NAME } });
    expect((group.platforms as { name: string }[]).map((p) => p.name)).toEqual(["Web", "Unity"]);
  } finally {
    await db.$disconnect();
  }

  // Add project → New project: the umbrella is already set.
  // ver_95: Add test cycle lives in umbrella Settings (Create a run makes one too).
  await page.goto(`${home}/settings`);
  await page.getByRole("button", { name: /Add test cycle/ }).first().click();
  await page.getByRole("menu").getByRole("button", { name: /^New test cycle/ }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill(`${NAME} Web RC2`);
  await page.getByRole("dialog").getByLabel("Key").fill(`${HUB}W2`);
  await expect(page.getByText(`It gets from ${NAME}:`)).toBeVisible();
  await page.getByRole("button", { name: `Create test cycle in ${NAME}` }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${HUB}W2`));

  // Add project → Move in: the loose project joins the umbrella.
  // ver_95: Add test cycle lives in umbrella Settings (Create a run makes one too).
  await page.goto(`${home}/settings`);
  await page.getByRole("button", { name: /Add test cycle/ }).first().click();
  await page.getByRole("menu").getByRole("button", { name: /^Move in a test cycle/ }).click();
  await page.getByRole("dialog").getByRole("radio", { name: new RegExp(`Loose ${TAG}`) }).check();
  await page.getByRole("button", { name: `Move into ${NAME}` }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // ver_117: its old settings address opens its row in the umbrella's Settings.
  await page.goto(`/p/${LOOSE}/settings`);
  await expect(page).toHaveURL(new RegExp(`/settings#cycle-${LOOSE.toLowerCase()}$`));
  await expect(page.getByRole("heading", { name: new RegExp(`what's different from ${NAME}$`) })).toBeVisible();
});

test("a brand-new umbrella offers New project and Move in right on its hub", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Product name").fill(`Empty ${TAG}`);
  await dialog.getByLabel("Key").fill(`E${TAG}`);
  await dialog.getByRole("button", { name: `Make Empty ${TAG}`, exact: true }).click();
  await expect(page).toHaveURL(/\/g\//);
  await expect(page.getByText(`No test cycles in Empty ${TAG} yet`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Move in an existing one" })).toBeVisible();
  await page.getByRole("button", { name: "New test cycle", exact: true }).click();
  await expect(page.getByRole("dialog", { name: `New test cycle in Empty ${TAG}` })).toBeVisible();
});

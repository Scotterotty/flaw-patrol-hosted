import { PrismaClient } from "@prisma/client";
import { expect, type Page } from "@playwright/test";

/**
 * A project on its own, outside any umbrella, made straight in the database.
 * Since ver_72 new projects are only made inside umbrellas, but projects from
 * before then keep working on their own, and most specs test those.
 */
export async function standaloneProject(page: Page, name: string, key: string, email = "admin@example.com") {
  const db = new PrismaClient();
  try {
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    await db.project.create({ data: { key, name, members: { create: { userId: user.id, role: "ADMIN" } } } });
  } finally {
    await db.$disconnect();
  }
  await page.goto(`/p/${key}/cases`);
  await expect(page).toHaveURL(new RegExp(`/p/${key}/cases`));
}

/** The release box (ver_95): Start a run, then the Release candidate kind. Replaces the old Start next release button. */
export async function openReleaseBox(page: Page) {
  await page.getByRole("button", { name: /Start a run/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /^Release candidate/ }).click();
  await expect(page.getByRole("dialog").getByLabel("Release", { exact: true })).toBeVisible();
}

/**
 * Release candidate (ver_99): nothing is ticked for you. Tick a platform and pick what it runs
 * from its dropdown: an option button ("Run RC4's suites again", "No runs yet") or a suite's checkbox.
 */
export async function choosePlatform(page: Page, platform: string, pick: RegExp | string) {
  const rc = page.getByRole("dialog");
  await rc.getByRole("checkbox", { name: platform, exact: true }).check();
  const menu = rc.getByRole("group", { name: `Choose what ${platform} runs` });
  await menu.getByRole("button", { name: pick }).or(menu.getByRole("checkbox", { name: pick })).first().click();
  if (await menu.isVisible()) await menu.getByRole("button", { name: "Done" }).click();
  await expect(menu).toHaveCount(0);
}

/** Start a run inside an umbrella asks the kind first (ver_95). Picks one so the rest of the box shows. */
export async function pickKind(page: Page, name = "Smoke test") {
  const box = page.getByRole("dialog");
  await box.getByRole("group", { name: "Kind of run" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(box.getByTestId("kind-picked")).toBeVisible();
}

import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_84: umbrella Settings rows open their own options right below them, one at a time,
// and the bug template's field list splits into "filled in Jira" and "written into the description".

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `ZH${TAG}`;
const NAME = `Rows ${TAG}`;
const JIRA = "http://localhost:3199";

let groupId = "";

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: NAME, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    // Made before ver_89, so it keeps the OKO bug layout.
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, okoLayout: true } })).id;
  } finally {
    await db.$disconnect();
  }
});

test("umbrella settings rows open in place, one at a time, and the field list reads clearly", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  const settings = `/g/${groupId}/settings`;
  await page.goto(settings);
  const row = (id: string) => page.locator(`#row-${id}`);

  // Jira connection holds only the login.
  await row("jira").getByRole("button", { name: "Connect", exact: true }).click();
  await row("jira").getByLabel("Jira site").fill(JIRA);
  await row("jira").getByLabel("Jira project key").fill("OB");
  await row("jira").getByLabel("Account email").fill("qa-bot@example.com");
  await row("jira").getByLabel("API token").fill("secret-token");
  await row("jira").getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText("Connected as QA Bot.")).toBeVisible();
  await expect(row("jira").getByTestId("bug-template-settings")).toHaveCount(0);
  await expect(row("jira").locator("#stories")).toHaveCount(0);

  // Opening Members closes the Jira row.
  await row("members").getByRole("button", { name: "Manage" }).click();
  await expect(row("members").getByRole("button", { name: "Hide" })).toBeVisible();
  await expect(page.getByLabel("Jira site")).toHaveCount(0);
  await expect(page).toHaveURL(/#members$/);

  // Bug template opens in its own row, with Import already picked while the layout is plain.
  await page.reload();
  await row("template").getByRole("button", { name: "Import…" }).click();
  await expect(page).toHaveURL(/#import-template$/);
  const tpl = row("template").getByTestId("bug-template-settings");
  await expect(tpl.getByLabel("Import a template from Jira")).toBeChecked();
  await expect(row("members").getByRole("button", { name: "Manage" })).toBeVisible();

  // The OKO layout's field list: ticks for what Jira fills, gray chips for the rest.
  await tpl.getByLabel(/OKO bug layout/).check();
  const fields = tpl.getByTestId("template-fields");
  await expect(fields.getByText(/^Filled straight into Jira \(\d+\)$/)).toBeVisible();
  await expect(fields.getByText(/Written into the description \(\d+\)/)).toBeVisible();
  await expect(fields.getByTestId("fields-written")).toContainText("Bug Workaround");
  await expect(fields.getByTestId("fields-filled")).toContainText("Team");
  await expect(fields).not.toContainText("not on the create screen");

  // Stories gets its own row too.
  await row("stories").getByRole("button", { name: "Change" }).click();
  await expect(row("stories").getByRole("button", { name: "Save requirements" })).toBeVisible();
  await expect(page.getByTestId("bug-template-settings")).toHaveCount(0);

  // Slack lives in its row; there's no separate Slack box lower down.
  await row("slack").getByRole("button", { name: "Set up" }).click();
  await expect(row("slack").getByRole("button", { name: "＋ Add channel" })).toBeVisible();
  await expect(page.locator("#slack")).toHaveCount(1);

  // Platforms moved out of Settings, to where they're used (ver_86).
  await expect(page.locator("#row-platforms")).toHaveCount(0);

  // Links with a #part still open the right row.
  await page.goto(`${settings}#stories`);
  await expect(row("stories").getByRole("button", { name: "Hide" })).toBeVisible();
  await page.goto(`${settings}#slack`);
  await expect(row("slack").getByRole("button", { name: "Hide" })).toBeVisible();
  await expect(row("stories").getByRole("button", { name: "Change" })).toBeVisible();
});

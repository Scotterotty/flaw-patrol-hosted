import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// Bug audit, smoother (ver_256, persona audit Nov 14 2026): closing a bug or Needs info needs a note,
// which goes to Jira as the comment signed with the person's name; Duplicate links the two bugs;
// Checked on / Build labels; Save and next / Put back; a green Saved line; bugs that already carry the
// label never count as left. Mock Jira filter 900 is AU-1..AU-4, and AU-4 already has 2026audit.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;
const SHOTS = process.env.AUDIT_SHOTS;
const AXE = require.resolve("axe-core/axe.min.js");

function seal(plain: string) {
  const secret = process.env.AUTH_SECRET ?? /^AUTH_SECRET="?([^"\n]*)"?/m.exec(readFileSync(".env", "utf8"))?.[1] ?? "";
  const key = createHash("sha256").update(`secret-box:${secret}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

async function problems(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    // @ts-expect-error axe is added by the script tag
    const r = await window.axe.run(document.querySelector("[data-testid=bug-audit]"), { runOnly: { type: "rule", values: ["color-contrast", "label", "button-name", "aria-required-attr", "aria-allowed-attr"] } });
    return r.violations.flatMap((v: { id: string; nodes: { target: string[] }[] }) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`));
  });
}

const jira = async () => (await (await fetch(`${JIRA}/__issues`)).json()) as Record<string, { status: string; comments: string[]; fields: { labels: string[] } }>;

test("checking bugs in an audit: a reason for closes, duplicates linked, a Saved line", async ({ page }) => {
  test.setTimeout(240_000);
  const db = new PrismaClient();
  const admin = await db.user.update({ where: { email: "admin@example.com" }, data: { name: "Demo Admin", look: "classic", themeMode: "light" } });
  const members = { create: [{ userId: admin.id, role: "ADMIN" as const }] };
  const hub = await db.project.create({ data: { key: `AH${TAG}`, name: `Audit ${TAG}`, members } });
  const group = await db.projectGroup.create({ data: { name: `Audit ${TAG}`, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }, { name: "Unity", suiteIds: [] }], rolesChosenAt: new Date() } });
  await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
  await db.jiraConfig.create({ data: { projectId: hub.id, siteUrl: JIRA, email: "qa-bot@example.com", tokenEncrypted: seal("secret-token"), jiraProjectKey: "AU" } });
  await db.bugAudit.create({ data: { groupId: group.id, name: "2026 bug audit", jql: "filter = 900", filterId: "900", label: "2026audit", createdById: admin.id, createdBy: "Demo Admin" } });
  await db.$disconnect();

  await signIn(page, "admin@example.com", "Demo Admin");
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`/g/${group.id}/bugs/audit`);
  // AU-4 already has the label: it's checked, not left, even though filter 900 doesn't leave it out.
  await expect(page.getByTestId("audit-progress")).toContainText("1 checked");
  await expect(page.getByTestId("audit-progress")).toContainText("3 left");

  await page.getByTestId("audit-next").click();
  const bug = page.getByTestId("audit-bug");
  await expect(bug.getByTestId("audit-key")).toHaveText("AU-1");
  await expect(bug.getByLabel("Note (optional)")).toBeVisible();
  await bug.getByRole("radio", { name: /Can't reproduce/ }).click();
  const note = bug.getByLabel(/Why can't you reproduce it\?/);
  await expect(note).toHaveAttribute("placeholder", /^Like: /);
  await bug.getByRole("button", { name: "Save and next" }).click();
  await expect(bug).toContainText("Say why in the note first.");
  await bug.getByRole("group", { name: "Checked on" }).getByRole("button", { name: "Web" }).click();
  await bug.getByLabel("Build", { exact: true }).fill("R24");
  await note.fill("Teleported 20 times on Web R24, hands stay put.");
  await bug.getByLabel("Status in Jira").selectOption({ label: "Move to Closed" });
  await expect(bug.getByTestId("audit-verify-hint")).toContainText("your note as a comment, signed with your name");
  await expect(bug.getByRole("button", { name: "Put back" })).toBeVisible();
  if (SHOTS) await bug.screenshot({ path: `${SHOTS}/desktop-cant-reproduce.png` });
  expect(await problems(page)).toEqual([]);
  await bug.getByRole("button", { name: "Save and next" }).click();

  const saved = page.getByTestId("audit-saved");
  await expect(saved).toContainText("AU-1 saved to Jira: Can't reproduce, label added, your note added as a comment, moved to Closed.");
  let j = await jira();
  expect(j["AU-1"].comments).toEqual(["Teleported 20 times on Web R24, hands stay put.\n— Demo Admin · Web · build R24"]);
  expect(j["AU-1"].fields.labels).toContain("2026audit");
  expect(j["AU-1"].status).toBe("Closed");

  // Duplicate asks which bug, shows its title, and links the two in Jira.
  await expect(bug.getByTestId("audit-key")).toHaveText("AU-2");
  await bug.getByRole("radio", { name: /Duplicate/ }).click();
  await bug.getByLabel("Duplicate of which bug?").fill("au-3");
  await bug.getByLabel(/Anything to add about the duplicate\?/).click();
  await expect(bug.getByTestId("audit-dupe")).toContainText("Seat swap breaks hand tracking");
  await bug.getByLabel(/Anything to add about the duplicate\?/).fill("Same jitter, same steps.");
  if (SHOTS) {
    await bug.screenshot({ path: `${SHOTS}/desktop-duplicate.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await bug.screenshot({ path: `${SHOTS}/phone-duplicate.png` });
    await page.setViewportSize({ width: 1366, height: 900 });
  }
  await bug.getByRole("button", { name: "Save and next" }).click();
  await expect(saved).toContainText("AU-2 saved to Jira: Duplicate");
  const links = (await (await fetch(`${JIRA}/__links`)).json()) as { type: string; from: string; to: string }[];
  expect(links).toContainEqual({ type: "Duplicate", from: "AU-2", to: "AU-3" });

  // Still happens with no note: the label only.
  await expect(bug.getByTestId("audit-key")).toHaveText("AU-3");
  await bug.getByRole("radio", { name: /Still happens/ }).click();
  await expect(bug.getByTestId("audit-verify-hint")).toContainText("No comment.");
  await bug.getByRole("button", { name: "Save and next" }).click();
  await expect(saved).toContainText("AU-3 saved to Jira: Still happens, label added.");
  j = await jira();
  expect(j["AU-3"].comments).toEqual([]);
  expect(j["AU-3"].fields.labels).toContain("2026audit");
  if (SHOTS) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("bug-audit").screenshot({ path: `${SHOTS}/phone-saved.png` });
  }
});

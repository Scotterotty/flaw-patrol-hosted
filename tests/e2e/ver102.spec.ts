import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_102: area tags. The word after the platform ("Unity · Hub - Space List") becomes a tag:
// the Case library offers it (Review…, Undo), and the Title box tags known words and asks for new ones.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `AT${TAG}`;
const NAME = `Areas ${TAG}`;

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 102 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const rows: [string, string[]][] = [
      ["Join a space", ["Unity", "Spaces"]],
      ["Change outfit", ["Unity", "Avatar"]],
      ["Spaces Deep Link", ["Unity"]],
      ["Hub - Space List", ["Unity"]],
      ["Hub - Create space", ["Unity"]],
      ["Hub - Delete space", ["Unity"]],
      ["Verify - login works", ["Unity"]],
      ["Store - Buy coins", ["Unity"]],
    ];
    const hub = await db.project.create({ data: { key: HUB, name: NAME, caseSeq: rows.length, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const steps = [{ kind: "step", action: "Open the app", expected: "It opens" }];
    for (const [i, [title, tags]] of rows.entries())
      await db.testCase.create({ data: { projectId: hub.id, number: i + 1, title, tags, versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags, steps } } } });
    await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Unity", suiteIds: [] }] } });
  } finally {
    await db.$disconnect();
  }
});

test("Case library: review area words, untick one, tag the rest, then Undo", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/cases`);
  const banner = page.getByTestId("area-banner");
  await expect(banner).toContainText("4 cases have an area word after the platform");
  await banner.getByRole("button", { name: "Review…" }).click();
  const dialog = page.getByRole("dialog");
  // Hub (3 cases, dash after it) and Spaces (already a tag). Verify is an action word and Store is only in 1 case.
  await expect(dialog.getByTestId("area-word")).toHaveCount(2);
  await expect(dialog).not.toContainText("Verify");
  await expect(dialog).not.toContainText("Store");
  await dialog.getByRole("checkbox", { name: "Spaces" }).uncheck();
  await dialog.getByRole("button", { name: "Tag 3 cases" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tagged 3 cases" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Hub - Space List/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Space List/ })).toBeVisible();

  // Undo puts the titles back; Spaces was unticked, so only Hub is offered again.
  await page.getByRole("status").filter({ hasText: "Tagged 3 cases" }).getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("link", { name: /Hub - Space List/ })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("area-banner")).toContainText("3 cases have an area word after the platform");
});

test("Title box: a known area word becomes a tag, Backspace undoes it, a new word asks first", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/cases/new`);
  const title = page.getByLabel("Title");
  await title.pressSequentially("[UNITY] Avatar Deep Link");
  const box = page.locator("#title").locator("..");
  await expect(box.getByTestId("tag-pill")).toHaveText(["Unity", "Avatar"]);
  await expect(title).toHaveValue("Deep Link");
  await title.press("Home");
  await title.press("Backspace");
  await expect(box.getByTestId("tag-pill")).toHaveText(["Unity"]);
  await expect(title).toHaveValue("Avatar Deep Link");

  await title.fill("Lobby - Join a friend");
  const ask = page.getByTestId("area-ask");
  await expect(ask).toContainText("Make “Lobby” a tag?");
  await ask.getByRole("button", { name: "Make it a tag" }).click();
  await expect(box.getByTestId("tag-pill")).toHaveText(["Unity", "Lobby"]);
  await expect(title).toHaveValue("Join a friend");
});

test("Import: known area words are tagged on their own, new ones have a tick box", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/import`);
  const csv = ["Title,Section,Steps,Expected Result", ...["Avatar - Wear a hat", "Shop - Buy a hat", "Shop - Refund", "Shop - Gift"].map((t) => `"[UNITY] ${t}",Imported,"Open it","It opens"`)].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "areas.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  const area = page.getByTestId("import-area");
  await expect(area).toContainText("Already tags: Avatar (1)");
  await area.getByRole("checkbox", { name: "Shop (3)" }).uncheck();
  await page.getByRole("button", { name: "Import 4 cases" }).click();
  await expect(page.getByText("Imported 4 test cases")).toBeVisible();
  await page.goto(`/p/${HUB}/cases?q=hat`);
  await expect(page.getByRole("link", { name: /Wear a hat/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Avatar - Wear a hat/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Shop - Buy a hat/ })).toBeVisible();
});

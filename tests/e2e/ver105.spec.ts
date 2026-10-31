import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_105: area tags with no platforms set up. A case's one [bracket] tag (WEB) takes the
// platform's place, so a fresh import into a new umbrella still offers Hub and In Space.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `NP${TAG}`;
const NAME = `No platforms ${TAG}`;

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 105 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const rows: [string, string[]][] = [
      ["Hub - Entering Spaces", ["WEB"]],
      ["Hub - Downloads", ["WEB"]],
      ["Hub - Space List", ["WEB"]],
      ["In Space - UI - Play Mode Button", ["WEB"]],
      ["In Space - UI - Assets Panel", ["WEB"]],
      ["In Space - UI - Exit Space Button", ["WEB"]],
      ["Hub - Profile", ["WEB", "Unique Cases"]],
      ["AR - Holdouts", ["WEB"]],
    ];
    const hub = await db.project.create({ data: { key: HUB, name: NAME, caseSeq: rows.length, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const steps = [{ kind: "step", action: "Open the app", expected: "It opens" }];
    for (const [i, [title, tags]] of rows.entries())
      await db.testCase.create({ data: { projectId: hub.id, number: i + 1, title, tags, versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags, steps } } } });
    await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [] } });
  } finally {
    await db.$disconnect();
  }
});

test("No platforms: the [bracket] tag leads, so Review… offers Hub and In Space once each", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/cases`);
  const banner = page.getByTestId("area-banner");
  // 3 Hub + 3 In Space; the case with a second tag and the one-off AR are left alone.
  await expect(banner).toContainText("6 cases have an area word after the platform");
  await banner.getByRole("button", { name: "Review…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("area-word")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Tag 6 cases" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tagged 6 cases" })).toBeVisible();
  await expect(page.getByRole("link", { name: /UI - Play Mode Button/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /In Space - UI - Play Mode Button/ })).toHaveCount(0);
  // One area per case: "UI" isn't offered next.
  await page.reload();
  await expect(page.getByTestId("area-banner")).toHaveCount(0);

  // The title box: the one [WEB] pill leads, and Hub is now a tag, so it turns into one on its own.
  await page.goto(`/p/${HUB}/cases/new`);
  const title = page.getByLabel("Title");
  await title.pressSequentially("[WEB] Hub - Settings");
  const box = page.locator("#title").locator("..");
  await expect(box.getByTestId("tag-pill")).toHaveText(["WEB", "Hub"]);
  await expect(title).toHaveValue("Settings");
});

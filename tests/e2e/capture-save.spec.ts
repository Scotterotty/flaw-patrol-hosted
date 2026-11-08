import { PrismaClient } from "@prisma/client";
// ver_81: files attached in the runner showed nothing once the case was saved.
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

test.use({
  launchOptions: {
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    args: ["--auto-accept-this-tab-capture", "--auto-select-desktop-capture-source=Flaw Patrol", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});
const KEY = `CS${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("screenshots stay on a case after Save, saving again, and Save and next", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Cap ${KEY}`, KEY);
  for (const t of ["One", "Two"]) {
    await page.goto(`/p/${KEY}/cases/new`);
    await page.getByLabel("Title").fill(t);
    await page.getByLabel("Step 1 action").fill("Tap");
    await page.getByRole("button", { name: "Create case" }).first().click();
    await expect(page.getByRole("heading", { name: t })).toBeVisible();
  }
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("All");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create and test now" }).click();
  await expect(page.getByRole("heading", { name: "One", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "📷 Screenshot" }).click();
  await page.getByRole("dialog", { name: "Pick the area to attach" }).getByRole("button", { name: "Attach whole screen" }).click();
  await expect(page.getByRole("link", { name: /screenshot.png/ })).toBeVisible();
  const shot = (name: string) => page.getByRole("link", { name });
  // Plain Save: the screenshot stays on the case and is saved with its result.
  await page.getByRole("button", { name: "Failed", exact: true }).first().click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Last result in this run")).toBeVisible();
  await expect(shot(`${KEY}-1 case screenshot.png`)).toBeVisible();
  await page.reload();
  await expect(shot(`${KEY}-1 case screenshot.png`)).toBeVisible();

  // Saving it again keeps the file on the new result.
  await page.getByRole("button", { name: "Passed", exact: true }).first().click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(shot(`${KEY}-1 case screenshot.png`)).toBeVisible();

  // Save and next from case One: back on One later, the screenshot is still there.
  await page.getByRole("button", { name: "Failed", exact: true }).first().click();
  await page.getByRole("button", { name: "Save and next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Two", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "📷 Screenshot" }).click();
  await page.getByRole("dialog", { name: "Pick the area to attach" }).getByRole("button", { name: "Attach whole screen" }).click();
  await expect(shot(`${KEY}-2 case screenshot.png`)).toBeVisible();
  await page.getByRole("button", { name: "Passed", exact: true }).first().click();
  await page.getByRole("button", { name: "Save and finish", exact: true }).click();
  await expect(page.getByText("That was the last case")).toBeVisible();
  await expect(shot(`${KEY}-2 case screenshot.png`)).toBeVisible();
  const db = new PrismaClient();
  try {
    const files = await db.attachment.findMany({ where: { project: { key: KEY } }, select: { fileName: true, resultId: true } });
    expect(files.map((f) => [f.fileName, !!f.resultId]).sort()).toEqual([[`${KEY}-1 case screenshot.png`, true], [`${KEY}-2 case screenshot.png`, true]]);
  } finally {
    await db.$disconnect();
  }
  await page.getByRole("link", { name: /One/ }).first().click();
  await expect(page.getByRole("heading", { name: "One", level: 1 })).toBeVisible();
  await expect(shot(`${KEY}-1 case screenshot.png`)).toBeVisible();
});

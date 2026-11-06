import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// Take screenshot and Record screen in the runner (ver_80). Chromium is told to
// share this tab without asking, so the browser's own picker is skipped.
test.use({
  launchOptions: {
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    args: ["--auto-accept-this-tab-capture", "--auto-select-desktop-capture-source=Flaw Patrol", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

const KEY = `SC${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("a step gets a screenshot and a screen recording", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Capture ${KEY}`, KEY);
  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Sign in");
  await page.getByLabel("Step 1 action").fill("Tap Continue");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("All");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create and test now" }).click();
  await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "📷 Take screenshot" }).click();
  await expect(page.getByRole("link", { name: `${KEY}-1 case screenshot.png` })).toBeVisible();

  await page.getByRole("button", { name: /Record screen for case/ }).click();
  const bar = page.getByRole("region", { name: "Screen recording" });
  await expect(bar).toContainText("Recording for the case");
  await expect(bar).toContainText("/ 5:00");
  // Saving is held until the recording is stopped.
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await page.waitForTimeout(1500);
  await bar.getByRole("button", { name: "Stop and attach" }).click();
  const preview = page.getByRole("region", { name: "Recording attached" });
  await expect(preview).toContainText(`${KEY}-1 case.webm`);
  await expect(preview).toContainText("attached to the case");
  await preview.getByRole("button", { name: "Close preview" }).click();
  const chip = page.getByRole("link", { name: `${KEY}-1 case.webm` });
  await expect(chip).toBeVisible();
  const href = await chip.getAttribute("href");
  const res = await page.request.get(href!, { headers: { Range: "bytes=0-9" } });
  expect(res.status()).toBe(206);
  expect(res.headers()["content-type"]).toBe("video/webm");
});

// Scott's 416 errors (ver_84): a sound mixer the browser keeps paused made Chrome write an
// empty video. Now the recorder records without sound instead, and empty or 10 MB+ files
// are handled by the upload.
for (const why of ["the browser keeps sound paused", "nothing makes a sound and the mic is off"])
test(`a recording still has video when ${why}`, async ({ page }) => {
  if (why.startsWith("nothing"))
    // Sharing a window or screen without its sound, as Scott did (ver_89).
    await page.addInitScript(() => {
      const md = navigator.mediaDevices;
      const real = md.getDisplayMedia.bind(md);
      md.getDisplayMedia = (o) => real({ ...o, audio: false });
    });
  else await page.addInitScript(() => {
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor() {
        super();
        void super.suspend();
      }
      resume() {
        return Promise.resolve();
      }
    } as typeof AudioContext;
  });
  const key = `${KEY.slice(0, 5)}${why.startsWith("nothing") ? "N" : "Q"}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Capture ${key}`, key);
  await page.goto(`/p/${key}/cases/new`);
  await page.getByLabel("Title").fill("Sign in");
  await page.getByLabel("Step 1 action").fill("Tap Continue");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.goto(`/p/${key}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("All");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create and test now" }).click();
  await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();

  const refused: string[] = [];
  page.on("response", (r) => r.url().includes("/api/attachments/") && r.status() >= 400 && refused.push(`${r.status()} ${r.url()}`));
  await page.getByRole("button", { name: /Record screen for case/ }).click();
  const bar = page.getByRole("region", { name: "Screen recording" });
  await expect(bar).toContainText("Recording for the case");
  await page.waitForTimeout(2500);
  await bar.getByRole("button", { name: "Stop and attach" }).click();
  const preview = page.getByRole("region", { name: "Recording attached" });
  await expect(preview).toContainText(`${key}-1 case.webm`);
  await expect.poll(() => preview.locator("video").evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  const href = await page.getByRole("link", { name: `${key}-1 case.webm` }).getAttribute("href");
  const res = await page.request.get(href!, { headers: { Range: "bytes=0-" } });
  expect(res.status()).toBe(206);
  expect((await res.body()).length).toBeGreaterThan(1000);
  expect(refused).toEqual([]);

  // An empty file is refused with a plain message instead of being attached.
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({ name: "empty.webm", mimeType: "video/webm", buffer: Buffer.alloc(0) });
  await expect(page.getByText("empty.webm is empty, so it wasn't attached.")).toBeVisible();
  // Recordings over 10 MB get through the sign-in check in middleware.ts.
  await input.setInputFiles({ name: "long.webm", mimeType: "video/webm", buffer: Buffer.alloc(12 * 1024 * 1024, 7) });
  await expect(page.getByRole("link", { name: "long.webm" })).toBeVisible({ timeout: 60_000 });
});

// ver_192 (Scott lost the Stop button): the bar sticks to the top of the bug box, a case
// recording shows in the bug box too, and on a phone it sits above the menu bar.
test("the recording bar stays in sight in the bug box and on a phone", async ({ page }) => {
  const key = `${KEY.slice(0, 5)}B`;
  const inView = (l: ReturnType<typeof page.locator>) =>
    l.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Capture ${key}`, key);
  await page.goto(`/p/${key}/settings`);
  await page.getByLabel("Jira site").fill(`http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`);
  await page.getByLabel("Jira project key").fill("RP");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText("Connected as QA Bot.")).toBeVisible();
  await page.goto(`/p/${key}/cases/new`);
  await page.getByLabel("Title").fill("Sign in");
  await page.getByLabel("Step 1 action").fill("Tap Continue");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.goto(`/p/${key}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("All");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create and test now" }).click();
  await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();

  // 1. Recording from the bug box: a short window makes the box scroll, and the bar stays put.
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.getByRole("button", { name: "Report bug for case" }).click();
  const dialog = page.getByRole("dialog", { name: /^Report a bug/ });
  await dialog.locator("button[aria-haspopup=menu]").first().click();
  await dialog.getByRole("menuitem", { name: /Record screen/ }).click();
  const inBox = dialog.getByRole("region", { name: "Screen recording" });
  await expect(inBox).toContainText("Recording for this bug");
  await dialog.evaluate((d) => (d.scrollTop = d.scrollHeight));
  expect(await inView(inBox)).toBe(true);
  await dialog.evaluate((d) => (d.scrollTop = 0));
  expect(await inView(inBox)).toBe(true);
  await inBox.getByRole("button", { name: "Discard" }).click();
  await expect(inBox).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).click();

  // 2. Recording on the case, then Report a bug: the case's bar is in the box and stops from there.
  await page.getByRole("button", { name: /Record screen for case/ }).click();
  await expect(page.getByRole("region", { name: "Screen recording" })).toContainText("Recording for the case");
  await page.getByRole("button", { name: "Report bug for case" }).click();
  const caseBar = dialog.getByRole("region", { name: "Screen recording" });
  await expect(caseBar).toContainText("Recording for the case");
  expect(await inView(caseBar)).toBe(true);
  await expect(dialog.getByRole("button", { name: "File bug in Jira" })).toBeDisabled();
  await page.waitForTimeout(1500);
  await caseBar.getByRole("button", { name: "Stop and attach" }).click();
  await expect(caseBar).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("region", { name: "Recording attached" })).toContainText(`${key}-1 case.webm`);
  await page.getByRole("button", { name: "Close preview" }).click();

  // 3. Phone: the bar sits above the menu bar and Save can scroll clear of it.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Record screen for case/ }).click();
  const bar = page.getByRole("region", { name: "Screen recording" });
  await expect(bar).toBeVisible();
  const menu = (await page.locator("nav.fp-bar.fixed").boundingBox())!;
  expect((await bar.boundingBox())!.y + (await bar.boundingBox())!.height).toBeLessThanOrEqual(menu.y + 1);
  await page.mouse.wheel(0, 10000);
  await page.waitForTimeout(400);
  const save = (await page.getByRole("button", { name: /^Save and (next|finish)$/ }).boundingBox())!;
  expect(save.y + save.height).toBeLessThanOrEqual((await bar.boundingBox())!.y);
  await bar.getByRole("button", { name: "Discard" }).click();
});

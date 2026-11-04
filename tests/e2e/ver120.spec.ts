import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_120: speed fixes. The Start next release and Start a bug bash boxes get their data when they
// open (or when their option is hovered), with your spinner meanwhile, a Try again if it fails, and no
// second wait when opened again. Links to Settings go straight to the final page.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();

async function newUmbrella(page: Page, name: string, key: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const make = page.getByRole("dialog");
  await make.getByLabel("Product name").fill(name);
  await make.getByLabel("Key").fill(key);
  await make.getByLabel("Release", { exact: true }).fill("RC1");
  await make.getByLabel("Platform 1").fill("Web");
  await make.getByRole("button", { name: `Make ${name} with 1 new test cycle` }).click();
  await expect(page).toHaveURL(/\/g\//);
  return page.url();
}

/** Server actions (the boxes' data) wait this long, or fail, so the box's own wait can be seen. */
async function slowActions(page: Page, mode: { delay?: number; fail?: boolean }) {
  await page.route("**/*", async (route) => {
    const r = route.request();
    if (r.method() !== "POST" || !r.headers()["next-action"]) return route.fallback();
    if (mode.fail) return route.abort();
    await new Promise((res) => setTimeout(res, mode.delay ?? 0));
    return route.fallback();
  });
}

test("Start next release loads when opened, with a spinner, Try again and no second wait", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  const NAME = `Quick ${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  const home = await newUmbrella(page, NAME, `QK${TAG}`);

  // A failed load says so and offers Try again.
  // Create a run gets its own choices first; only the release box's fetch fails.
  await page.getByRole("button", { name: /Create a run/ }).first().click();
  const rcKind = page.getByRole("dialog").getByRole("button", { name: /^Release candidate/ });
  await expect(rcKind).toBeVisible();
  await slowActions(page, { fail: true });
  await rcKind.click();
  const failed = page.getByTestId("rc-box-wait-failed");
  await expect(failed).toContainText("Couldn't load this. Check your connection and try again.");
  await page.unrouteAll({ behavior: "wait" });

  // Slow but working: the box opens at once with the spinner and its words, then fills in.
  await slowActions(page, { delay: 1500 });
  await failed.getByRole("button", { name: "Try again" }).click();
  const wait = page.getByTestId("rc-box-wait");
  await expect(wait).toContainText(`Getting ${NAME}'s last release ready…`);
  await expect(wait.getByTestId("loading-spinner")).toBeVisible();
  // The corner spinner stays hidden while the box shows its own.
  await expect(page.getByTestId("busy-corner")).toBeHidden();
  const release = page.getByRole("dialog").getByLabel("Release", { exact: true });
  await expect(release).toBeVisible({ timeout: 20_000 });
  await expect(wait).toHaveCount(0);

  // Opened again on the same page: what it already loaded, with no wait.
  await page.keyboard.press("Escape");
  await expect(release).toBeHidden();
  await page.getByRole("button", { name: /Create a run/ }).first().click();
  await rcKind.click();
  await expect(release).toBeVisible();
  await expect(page.getByTestId("rc-box-wait")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.unrouteAll({ behavior: "wait" });

  // ?start=rc opens the box by itself and fills it in.
  await page.goto(`${home}?start=rc`);
  await expect(page.getByRole("dialog").getByLabel("Release", { exact: true })).toBeVisible({ timeout: 20_000 });
});

test("Start a bug bash: Name and How long work at once, only the area ideas wait", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  const NAME = `Bashy ${TAG}`;
  const HUB = `BS${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await newUmbrella(page, NAME, HUB);
  await page.goto(`/p/${HUB}/bashes`);
  await slowActions(page, { delay: 2000 });
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const box = page.getByRole("dialog");
  await expect(box.getByTestId("bash-ideas-wait")).toContainText("Getting ideas for areas…");
  await box.getByLabel("Name").fill("Checkout bash");
  await box.getByRole("button", { name: "30 min" }).click();
  await expect(box.getByRole("button", { name: "30 min" })).toHaveAttribute("aria-pressed", "true");
  await box.getByLabel("Add an area").fill("Checkout");
  await box.getByLabel("Add an area").press("Enter");
  // Start waits for the box's data, then works as before.
  await expect(box.getByTestId("bash-ideas-wait")).toHaveCount(0, { timeout: 20_000 });
  await expect(box.getByRole("button", { name: "Start bug bash" })).toBeEnabled();
  await page.unrouteAll({ behavior: "wait" });
  await box.getByRole("button", { name: "Start bug bash" }).click();
  await expect(box.getByRole("heading", { name: "Your bash is live. Invite people." })).toBeVisible({ timeout: 20_000 });
});

test("Settings links go straight to the umbrella's Settings", async ({ page }) => {
  test.setTimeout(120_000);
  const HUB = `SL${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  const home = await newUmbrella(page, `Links ${TAG}`, HUB);
  const id = new URL(home).pathname.split("/")[2];
  // No Jira yet: Requirements offers Open Settings, straight to the umbrella's Jira row.
  await page.goto(`/p/${HUB}/stories`);
  await expect(page.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", `/g/${id}/settings#jira`);
});

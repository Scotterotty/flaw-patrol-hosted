import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { SERVER_UPDATE_DIR as DIR } from "./server-update-dir";

// ver_239 (Scott, Nov 13 2026): Workspace settings → Updates. Flaw Patrol can't rebuild its own
// container, so Update now leaves a note for the update helper on the server
// (scripts/server-update.sh) and follows the status it writes back. This test plays the helper
// by writing its files into the shared folder (playwright.config.ts sets SERVER_UPDATE_DIR).

const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString().replace(/\.\d+Z$/, "Z");
const put = (name: string, text: string) => writeFileSync(join(DIR, name), text);
const status = (lines: Record<string, string>) =>
  put("status", Object.entries({ state: "idle", seen: iso(), ...lines }).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");

test.beforeEach(() => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
});

test("Updates: see what's new, press Update now, follow the helper to Done", async ({ page }) => {
  test.setTimeout(180_000);
  status({});
  put("remote", `checked=${iso(60_000)}\ncurrent=0.3.0-alpha.239\nlatest=0.3.0-alpha.240\nlatestCommit=abc1234\nbehind=2\nahead=0\nchanged=\nerror=\n`);
  put("commits", "abc1234\tVersion 240: something new\ndef5678\tVersion 239: a fix\n");
  put("migrations", "20261113090000_new_table\n");

  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/workspace#updates");
  const card = page.getByRole("region", { name: "Updates" });
  await expect(card.getByTestId("update-running")).toHaveText(/0\.3\.0-alpha\.\d+/);
  await expect(card.getByText("0.3.0-alpha.240")).toBeVisible();
  await expect(card.getByText("2 new changes")).toBeVisible();
  await expect(card.getByText("Includes 1 database change.")).toBeVisible();
  await card.getByText("What's coming in 240").click();
  await expect(card.getByText("Version 239: a fix")).toBeVisible();

  // Update now leaves the helper a note and nothing else.
  page.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "Update now" }).click();
  await expect.poll(() => existsSync(join(DIR, "request"))).toBe(true);
  const note = readFileSync(join(DIR, "request"), "utf8");
  expect(note).toMatch(/^kind=update$/m);
  expect(note).toMatch(/^id=[0-9a-f]{12}$/m);
  await expect(card.getByText("Waiting for the update helper…")).toBeVisible();

  // The helper takes the note and works; the card follows along.
  rmSync(join(DIR, "request"));
  status({ state: "updating", step: "Building 0.3.0-alpha.240 (about 4 minutes)", started: iso(), from: "0.3.0-alpha.239", to: "0.3.0-alpha.240" });
  await expect(card.getByText("Building 0.3.0-alpha.240 (about 4 minutes)")).toBeVisible({ timeout: 15_000 });
  await expect(card.getByRole("button", { name: "Update now" })).toHaveCount(0);

  status({ state: "done", message: "Updated from 0.3.0-alpha.239 to 0.3.0-alpha.240.", by: "Demo Admin", finished: iso(), from: "0.3.0-alpha.239", to: "0.3.0-alpha.240" });
  put("remote", `checked=${iso()}\ncurrent=0.3.0-alpha.240\nlatest=0.3.0-alpha.240\nbehind=0\nahead=0\nchanged=\nerror=\n`);
  put("update.log", "== Getting the new code\n== Building\n");
  await expect(card.getByText("Done", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText("Updated from 0.3.0-alpha.239 to 0.3.0-alpha.240.")).toBeVisible();
  await expect(card.getByText("Up to date")).toBeVisible();
  await expect(card.getByRole("button", { name: "Update now" })).toBeDisabled();
});

test("Updates: says when the helper isn't running, and Update now stays off", async ({ page }) => {
  status({ seen: iso(10 * 60_000) });
  put("remote", `checked=${iso(10 * 60_000)}\ncurrent=0.3.0-alpha.239\nlatest=0.3.0-alpha.240\nbehind=2\nahead=0\nchanged=\nerror=\n`);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/workspace#updates");
  const card = page.getByRole("region", { name: "Updates" });
  await expect(card.getByText("The update helper isn't running")).toBeVisible();
  await expect(card.getByRole("button", { name: "Update now" })).toBeDisabled();
});

test("Updates: only workspace admins see the card or read the status", async ({ page }) => {
  status({});
  await signIn(page, "tester@example.com", "Sam Tester");
  expect((await page.request.get("/api/server-update")).status()).toBe(404);
  await page.goto("/workspace");
  await expect(page.getByRole("region", { name: "Updates" })).toHaveCount(0);
});

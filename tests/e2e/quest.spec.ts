import { expect, test } from "@playwright/test";
import { signIn, backToRun, openAccount } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `Q${Date.now().toString(36).slice(-4).toUpperCase()}`;
const SHOTS = process.env.QUEST_SHOTS;

test("quest maps are opt-in, and the pawn walks as cases get results", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  // Start from quest maps off, even if an earlier run of this test stopped halfway.
  await openAccount(page);
  const playing = page.getByLabel("Play the mini game");
  if (await playing.isChecked()) {
    const quests = page.getByLabel("Show quest maps");
    if (await quests.isChecked()) await quests.uncheck();
    await playing.uncheck();
  }
  await page.goto("/");
  await standaloneProject(page, `Quest ${KEY}`, KEY);
  for (const title of ["One", "Two", "Three", "Four"]) {
    await page.goto(`/p/${KEY}/cases/new`);
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Step 1 action").fill("Do it");
    await page.getByRole("button", { name: "Create case" }).first().click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Road");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Start test run" }).click();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
  const runUrl = page.url();

  // Off by default: no menu item, and the page says how to turn it on.
  const nav = page.locator("nav").filter({ hasText: "Test cases" }).first();
  await expect(nav.getByRole("link", { name: "Quest map" })).toHaveCount(0);
  await page.goto(`/p/${KEY}/quests`);
  await expect(page.getByText("Quest maps are off")).toBeVisible();

  await openAccount(page);
  await page.getByLabel("Play the mini game").check();
  await page.getByLabel("Show quest maps").check();
  await page.goto(runUrl);
  const links = await nav.getByRole("link").allTextContents();
  expect(links.indexOf("Quest map")).toBe(links.findIndex((l) => l.startsWith("Test runs")) + 1);

  await nav.getByRole("link", { name: "Quest map" }).click();
  await expect(page.getByRole("heading", { name: "Quest map" })).toBeVisible();
  await page.getByRole("link", { name: /R\d+ Road/ }).first().click();
  await expect(page.getByText("0 of 4 steps")).toBeVisible();
  // What lies ahead stays hidden until someone lands on it.
  await expect(page.getByText("Nothing found yet.")).toBeVisible();
  // ver_94: before your first save your pawn waits faded at the start.
  const waiting = page.locator("svg title").filter({ hasText: /^You · join by saving a case/ });
  await expect(waiting).toHaveCount(1);
  await expect(page.locator("svg title").filter({ hasText: /found the|defeated|met|slipped past|waits|lurks/ })).toHaveCount(0);

  // Two results move the pawn two steps.
  await page.getByRole("link", { name: "Take the next step" }).click();
  for (const title of ["One", "Two"]) {
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" }).click();
    await page.getByRole("button", { name: /Save and (next|finish)/ }).click();
  }
  await expect(page.getByRole("heading", { name: "Three" })).toBeVisible();
  await page.goto(`/p/${KEY}/quests`);
  await page.getByRole("link", { name: /R\d+ Road/ }).first().click();
  await expect(page.getByText("2 of 4 steps")).toBeVisible();
  await expect(waiting).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/quest-midway.png`, fullPage: true });

  // Finish the run: the team arrives and the one encounter has an owner.
  await page.getByRole("link", { name: "Take the next step" }).click();
  for (const [title, verdict] of [["Three", "Passed"], ["Four", "Failed"]]) {
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: verdict }).click();
    await page.getByRole("button", { name: /Save and (next|finish)/ }).click();
  }
  await backToRun(page);
  await page.goto(`/p/${KEY}/quests`);
  // The one find sits in the Items tab or the Encounters log, never both.
  const satchel = page.getByRole("region", { name: "Your satchel" });
  const tabs = satchel.getByRole("tab");
  await expect(tabs).toHaveText([/Items · \d/, /Encounters · \d/]);
  const counts = (await tabs.allTextContents()).map((t) => Number(t.split("· ")[1]));
  expect(counts[0] + counts[1]).toBe(1);
  if (counts[1]) {
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(satchel.getByRole("list", { name: "Encounter log" }).getByRole("listitem")).toHaveText(/(Defeated|Found a bug|Slipped past)$/);
    await tabs.first().click();
    await expect(satchel.getByText("No items yet.")).toBeVisible();
  } else {
    await expect(satchel.getByRole("tabpanel").getByRole("listitem")).toHaveCount(1);
    const found = (await satchel.getByRole("tabpanel").getByRole("listitem").getByRole("button").getAttribute("title"))!;
    await tabs.nth(1).click();
    await expect(satchel.getByText("No encounters yet.")).toBeVisible();
    // Wear the find on your pawn: it shows on the map's pawn. A first find of its kind
    // goes on by itself when a slot it fits is empty (ver_72), and is marked Auto.
    // ver_94: gear lives in the Your pawn card, opened with Change gear.
    await page.getByRole("region", { name: "Your pawn" }).getByRole("button", { name: "Change gear" }).click();
    const dress = page.getByRole("dialog", { name: "Change gear" });
    await dress.getByRole("button", { name: new RegExp(`^${found}(, worn)?$`) }).click();
    const wear = dress.getByRole("button", { name: /^Wear as / });
    const takeOff = dress.getByRole("button", { name: "Take off" });
    await expect(wear.or(takeOff)).toBeVisible();
    if (await wear.isVisible()) await wear.click();
    else await expect(dress.getByText("Auto", { exact: true }).first()).toBeVisible();
    await expect(takeOff).toBeVisible();
    await expect(dress.getByRole("button", { name: `${found}, worn` })).toBeVisible();
    await page.reload();
    await expect(page.locator("svg title").filter({ hasText: found }).first()).toBeAttached();
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/quest-satchel.png`, fullPage: true });
  await expect(page.getByRole("region", { name: "Team" })).toHaveCount(0);
  await page.getByRole("link", { name: /R\d+ Road/ }).first().click();
  await expect(page.getByText(/The team reached/)).toBeVisible();
  await expect(page.getByText(/^You (found the|defeated|met|slipped past)/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/quest-done.png`, fullPage: true });

  // An XP reset empties the satchel too.
  await page.goto("/workspace");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Reset Demo Admin's XP" }).click();
  await page.goto(`/p/${KEY}/quests`);
  await expect(page.getByRole("region", { name: "Your satchel" }).getByText("No items yet.")).toBeVisible();
  // Worn gear comes off with it.
  await expect(page.getByRole("region", { name: "Your pawn" }).getByText("No gear on yet.")).toBeVisible();
  // The Account "Dress your pawn" link lands with Change gear open.
  await page.goto(`/p/${KEY}/quests?gear=1`);
  await expect(page.getByRole("dialog", { name: "Change gear" }).getByText("🎒 Nothing to wear yet")).toBeVisible();
  await expect(page.getByText(/Nearest item:|No items left ahead|No quests on the road/)).toBeVisible();

  await openAccount(page);
  await page.getByLabel("Show quest maps").uncheck();
  await page.getByLabel("Play the mini game").uncheck();
});

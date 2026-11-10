import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// The hidden page (ver_204): a code typed on a quest map opens it, saves go to your own account,
// and each closed run you tested by hand becomes a dungeon named after your cases and bugs.

const KEY = `DV${Date.now().toString(36).slice(-4).toUpperCase()}`;
const EMAIL = `delver-${KEY.toLowerCase()}@example.com`;
const CODE = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a", "Shift", "Shift"];

let runId = "";
let importedRunId = "";

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const user = await db.user.create({ data: { email: EMAIL, name: "Delia Delver", gameEnabled: true, questMap: true, whatsNewSeen: 999999 } });
    const project = await db.project.create({ data: { key: KEY, name: "Delve Web", platform: "Web", members: { create: { userId: user.id, role: "TESTER" } } } });
    const cases: { id: string; title: string }[] = [];
    for (const [i, title] of ["Sign in with email", "Change avatar", "Open settings"].entries()) {
      cases.push(await db.testCase.create({ data: { projectId: project.id, number: i + 1, title } }));
    }
    const makeRun = async (number: number, name: string, state: "ACTIVE" | "COMPLETED", imported: boolean) => {
      const run = await db.testRun.create({ data: { projectId: project.id, number, name, build: "2.4.2", state, completedAt: state === "COMPLETED" ? new Date() : null } });
      const results = [];
      for (const [i, c] of cases.entries()) {
        const entry = await db.runEntry.create({ data: { runId: run.id, caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: "MEDIUM", steps: [], status: i === 1 ? "FAILED" : "PASSED" } });
        results.push(await db.testResult.create({ data: { entryId: entry.id, runId: run.id, caseId: c.id, caseVersion: 1, status: i === 1 ? "FAILED" : "PASSED", stepResults: [], testerId: user.id, testerName: "Delia Delver", imported } }));
      }
      return { run, results };
    };
    const rc = await makeRun(1, "RC 23", "COMPLETED", false);
    runId = rc.run.id;
    const bug = (number: number, title: string, severity: "CRITICAL" | "MINOR", status: "OPEN" | "FIXED" = "OPEN") =>
      db.defect.create({ data: { projectId: project.id, number, title, severity, status, createdById: user.id, createdBy: "Delia Delver" } });
    const worst = await bug(1, "Login spins forever", "CRITICAL");
    // Fixed since the run: still a monster, because the run is history.
    const typo = await bug(2, "Typo on Settings", "MINOR", "FIXED");
    await db.defectLink.create({ data: { defectId: worst.id, resultId: rc.results[1].id } });
    await db.defectLink.create({ data: { defectId: typo.id, resultId: rc.results[2].id } });
    // Imported results and runs still in progress don't make dungeons.
    importedRunId = (await makeRun(2, "Imported sheet", "COMPLETED", true)).run.id;
    await makeRun(3, "Still testing", "ACTIVE", false);
  } finally {
    await db.$disconnect();
  }
});

const typeCode = async (page: Page) => {
  for (const k of CODE) await page.keyboard.press(k);
};

test("a code on the quest map opens the hidden page, and your closed run becomes a dungeon", async ({ page }) => {
  await signIn(page, EMAIL, "Delia Delver");
  await page.goto(`/p/${KEY}/quests`);
  await expect(page.getByRole("heading", { name: "Quest map" })).toBeVisible();

  // Never while typing in a field.
  await page.evaluate(() => {
    const i = document.createElement("input");
    i.setAttribute("aria-label", "Scratch field");
    document.body.appendChild(i);
  });
  await page.getByLabel("Scratch field").focus();
  await typeCode(page);
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/quests$`));

  // Not on other pages.
  await page.goto(`/p/${KEY}/runs`);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await typeCode(page);
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/runs`));

  await page.goto(`/p/${KEY}/quests`);
  await expect(page.getByRole("heading", { name: "Quest map" })).toBeVisible();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await typeCode(page);
  await expect(page).toHaveURL(/\/delve\?from=/);

  const game = page.frameLocator('iframe[title="The Delve"]');
  // First visit offers to bring a save over from the phone game.
  await expect(game.getByText("WELCOME TO THE DELVE")).toBeVisible();
  await game.getByRole("button", { name: "Start fresh" }).click();
  await game.getByRole("button", { name: "Delve", exact: true }).click();

  // Pick a dungeon: Random delve, Practice, and only the closed run tested by hand.
  await expect(game.getByText("PICK A DUNGEON")).toBeVisible();
  await expect(game.getByRole("button", { name: /Random delve/ })).toBeVisible();
  await expect(game.getByRole("button", { name: /Practice/ })).toBeVisible();
  const dungeon = game.getByRole("button", { name: /Web v2\.4\.2 · RC 23/ });
  await expect(dungeon).toContainText("3 cases · 2 of your bugs · boss: D-1");
  await expect(game.getByText("Imported sheet")).toHaveCount(0);
  await expect(game.getByText("Still testing")).toHaveCount(0);

  await dungeon.click();
  const frame = page.frame({ url: /delve-game/ })!;
  type G = { floor: number; seed: number; t: number[]; msg: string; dungeon: { id: string; plan: { boss: Record<number, { title: string }> } }; mons: { name: string; bug?: { t: string } }[] };
  const g = () => frame.evaluate(() => (window as unknown as { __delve: { get: () => G } }).__delve.get());
  const first = await g();
  expect(first.floor).toBe(1);
  expect(first.dungeon.id).toBe(runId);
  // Your worst bug guards B12; floors are named after your cases.
  expect(first.dungeon.plan.boss[12].title).toBe("Login spins forever");
  expect(first.msg).toContain("Sign in with email");
  // The minor (and since fixed) bug is a named monster on floor 1.
  expect(first.mons.some((m) => m.name === "Typo on Settings")).toBe(true);

  // Squash it: it goes in Your bugs, and the save reaches your account.
  await frame.evaluate(() => {
    const w = window as unknown as { __delve: { get: () => { mons: { bug?: unknown }[] } }; __fpDelveTest: { kill: (m: unknown) => void; flush: () => void } };
    w.__fpDelveTest.kill(w.__delve.get().mons.find((m) => m.bug));
    w.__fpDelveTest.flush();
  });
  await expect
    .poll(async () => {
      const r = await page.request.get("/api/delve");
      const keys = (await r.json()).save.keys as Record<string, string>;
      return keys["delve.meta"] ?? "";
    })
    .toContain("Typo on Settings");

  // Same run, same map: come back later and the paused run is still there; giving up and
  // picking the same run again builds the same floor.
  await page.reload();
  await expect(game.getByRole("button", { name: /Continue run · B1/ })).toBeVisible();
  await game.getByRole("button", { name: "Bug Log" }).click();
  await game.getByRole("tab", { name: "YOUR BUGS" }).click();
  await expect(game.getByText("Typo on Settings")).toBeVisible();
  await expect(game.getByText("D-2")).toBeVisible();
  await game.getByRole("button", { name: "Back" }).click();
  await game.getByRole("button", { name: /Continue run/ }).click();
  const frame2 = page.frame({ url: /delve-game/ })!;
  await frame2.evaluate(() => (document.getElementById("quitBtn") as HTMLButtonElement).click());
  await game.getByRole("button", { name: "Delve again" }).click();
  await game.getByRole("button", { name: /Web v2\.4\.2 · RC 23/ }).click();
  const again = await frame2.evaluate(() => (window as unknown as { __delve: { get: () => G } }).__delve.get());
  expect(again.seed).toBe(first.seed);
  expect(again.t.join("")).toBe(first.t.join(""));

  // Practice: gentle floors that bank no Shards.
  await frame2.evaluate(() => (document.getElementById("quitBtn") as HTMLButtonElement).click());
  await game.getByRole("button", { name: "Delve again" }).click();
  await game.getByRole("button", { name: /Practice/ }).click();
  const practice = await frame2.evaluate(() => (window as unknown as { __delve: { get: () => { practice: boolean; dungeon?: unknown } } }).__delve.get());
  expect(practice.practice).toBe(true);
  expect(practice.dungeon).toBeUndefined();
  // An Old Tome is read right away (a new card to pick), never kept in the backpack.
  const tome = await frame2.evaluate(() => {
    const d = (window as unknown as { __delve: { get: () => { bag: Record<string, number> }; act: (x: number, y: number) => void } }).__delve;
    d.get().bag.tome = 1;
    d.act(0, 0);
    return d.get().bag.tome ?? 0;
  });
  expect(tome).toBe(0);
  await expect(game.getByText("OLD TOME!")).toBeVisible();
  await frame2.evaluate(() => {
    (document.querySelector("#cards .card") as HTMLButtonElement).click();
    (document.querySelector("#cards .card") as HTMLButtonElement).click();
  });
  // The game is called The Delve here, with its version on the stats page.
  await frame2.evaluate(() => (document.getElementById("heroBtn") as HTMLButtonElement).click());
  await expect(game.getByText(/^THE DELVE · v\d+$/)).toBeVisible();
  await expect(game.getByText(/pocket/i)).toHaveCount(0);
  await frame2.evaluate(() => (document.getElementById("charClose") as HTMLButtonElement).click());
  // A Practice boss gives no Scrap for the Blacksmith.
  const scrap = await frame2.evaluate(() => {
    const w = window as unknown as { __delve: { get: () => { mons: { boss?: boolean }[]; scrapRun?: number } }; __fpDelveTest: { kill: (m: unknown) => void }; DELVE_STORE: { getItem: (k: string) => string | null } };
    const m = w.__delve.get().mons[0];
    m.boss = true;
    w.__fpDelveTest.kill(m);
    return { run: w.__delve.get().scrapRun ?? 0, kept: JSON.parse(w.DELVE_STORE.getItem("delve.meta") ?? "{}").scrap ?? 0 };
  });
  expect(scrap).toEqual({ run: 0, kept: 0 });
  await frame2.evaluate(() => (document.getElementById("quitBtn") as HTMLButtonElement).click());
  await expect(game.getByText("PRACTICE BANKS NO SHARDS")).toBeVisible();

  // The first-clear bonus pays once per run, and only for your own dungeons.
  expect((await (await page.request.post("/api/delve/clear", { data: { runId } })).json()).bonus).toBe(30);
  expect((await (await page.request.post("/api/delve/clear", { data: { runId } })).json()).bonus).toBe(0);
  expect((await page.request.post("/api/delve/clear", { data: { runId: importedRunId } })).status()).toBe(404);

  // Back to Flaw Patrol returns to the quest map.
  await page.goto(`/delve?from=/p/${KEY}/quests`);
  await game.getByRole("button", { name: "Back to Flaw Patrol" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/quests$`));
});

test("someone else never gets your save", async ({ page }) => {
  await signIn(page, "lead@example.com", "Dana Lead");
  const r = await page.request.get("/api/delve");
  const body = await r.json();
  expect(JSON.stringify(body)).not.toContain("Typo on Settings");
  expect(body.dungeons.some((d: { id: string }) => d.id === runId)).toBe(false);
});

import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_223 (Scott, Nov 10 2026): Write a bug has no run or case, so the OKO form there drops the
// "from run" / "from case" tags and shows gray hints instead (his Reproduction History hints).
// Repro rate copies Repros, and Build # takes the version numbers from Client and CSP.
// A run's Report a bug keeps its tags (bug-template.spec.ts).

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;
const OK = `HN${TAG}`;

/** Contrast of each hint against its box, worked out in the page (colors can be oklch). */
async function hintContrast(page: Page) {
  return page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    const rgb = (c: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const boxes = [...document.querySelectorAll<HTMLElement>("[data-testid=bug-template] input[placeholder], [data-testid=bug-template] textarea[placeholder]")];
    return Math.min(
      ...boxes.map((el) => {
        const a = lum(rgb(getComputedStyle(el, "::placeholder").color));
        const b = lum(rgb(getComputedStyle(el).backgroundColor));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }),
    );
  });
}

test("Write a bug's OKO form: hints, no run tags, Repro rate and Build # follow the table", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    await db.project.create({ data: { key: OK, name: `Hints ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
  } finally {
    await db.$disconnect();
  }
  await page.goto(`/p/${OK}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("QA");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText(`Connected to ${JIRA}, Jira project QA`)).toBeVisible();
  const db2 = new PrismaClient();
  try {
    const p = await db2.project.findUniqueOrThrow({ where: { key: OK } });
    await db2.jiraConfig.update({ where: { projectId: p.id }, data: { sharedTemplateId: "shared_oko_layout", bugTemplate: { on: true, clientTag: "WEB", team: "Web", clients: [], olyEnv: [], imported: null } } });
  } finally {
    await db2.$disconnect();
  }

  await page.goto(`/p/${OK}/bugs?write=1`);
  const box = page.getByRole("dialog", { name: "Write a bug" });
  const form = box.getByTestId("bug-template");
  await expect(form).toBeVisible();

  // No run, no case: none of a run's tags.
  for (const t of ["from run", "from case", "your Actual result", "run build", "run CSP", "run env", "from run env"]) {
    await expect(form.getByText(t, { exact: true })).toHaveCount(0);
  }
  await expect(form.getByText("type what you know")).toBeVisible();

  // Gray hints say what goes in each box, Scott's own in Reproduction History.
  await expect(form.getByLabel("Feature")).toHaveAttribute("placeholder", "Which feature? e.g. Avatars");
  await expect(form.getByLabel("What happened")).toHaveAttribute("placeholder", "What went wrong, and what you expected instead");
  await expect(form.locator("#h-client")).toHaveAttribute("placeholder", "Client Version");
  await expect(form.locator("#h-csp")).toHaveAttribute("placeholder", "xx.xx.x");
  await expect(form.locator("#h-context")).toHaveAttribute("placeholder", "Browser\nGraphics Driver\nDevice\nOS");
  await expect(form.locator("#h-user")).toHaveAttribute("placeholder", "Display Name & ID");
  await expect(form.locator("#h-envTenant")).toHaveAttribute("placeholder", "Env.\nTenant");
  await expect(form.locator("#h-repros")).toHaveAttribute("placeholder", "x/x");
  await expect(form.getByText("Inline Attachments")).toBeVisible();

  // The time is written like the run's: 2026/11/10.
  await expect(form.locator("#h-dateTime")).toHaveValue(/^\d{4}\/\d{2}\/\d{2}/);

  // Yes to the usual answers: the tag says so.
  await box.getByTestId("usual-answers").getByRole("button", { name: /^Yes, use / }).click();
  await expect(form.locator("#t-tag")).toHaveValue("WEB");
  await expect(form.locator("label[for=t-tag]")).toContainText("usual answer");

  // Repro rate copies Repros, even though they started different (Scott's 3/5 vs 1/1).
  await form.locator("#h-repros").fill("3/5");
  await expect(form.getByLabel("Repro rate")).toHaveValue("3/5");

  // Build # takes the version numbers from Client and CSP, whatever is typed there.
  await form.locator("#h-client").fill("Unity 2.5.1");
  await form.locator("#h-csp").fill("8.0.3");
  await expect(form.getByLabel("Build #")).toHaveValue("Version 2.5.1 - CSP 8.0.3");
  // Typed in by hand, it stays put.
  await form.getByLabel("Build #").fill("Hotfix 9");
  await form.locator("#h-client").fill("Unity 2.5.2");
  await expect(form.getByLabel("Build #")).toHaveValue("Hotfix 9");

  // Hints are readable (4.5:1) in light, dark and the looks.
  const db3 = new PrismaClient();
  try {
    for (const [mode, look] of [["light", "classic"], ["dark", "classic"], ["light", "hc"], ["dark", "mission"], ["dark", "retro"], ["light", "white"], ["light", "blue"], ["dark", "arcade"]]) {
      await db3.user.update({ where: { email: "admin@example.com" }, data: { themeMode: mode, look } });
      await page.goto(`/p/${OK}/bugs?write=1`);
      await expect(page.getByRole("dialog", { name: "Write a bug" }).getByTestId("bug-template")).toBeVisible();
      expect(await hintContrast(page), `${mode} ${look}`).toBeGreaterThanOrEqual(4.5);
    }
  } finally {
    await db3.user.update({ where: { email: "admin@example.com" }, data: { themeMode: "light", look: "classic" } });
    await db3.$disconnect();
  }

  // Phones: the same form, nothing wider than the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${OK}/bugs?write=1`);
  await expect(page.getByRole("dialog", { name: "Write a bug" }).getByTestId("bug-template")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

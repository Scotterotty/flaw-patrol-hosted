import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { openAccount, signIn } from "./auth";

// ver_221: Text font and Heading font each change only their own text, in every look.
// Before, a look (80s retrowave, Arcade…) put its own title font over your Heading font pick.

const EMAIL = "lead@example.com";
test.describe.configure({ mode: "serial" });

const reset = async () => {
  const db = new PrismaClient();
  try {
    await db.user.update({ where: { email: EMAIL }, data: { look: "classic", riskLook: null, fontBody: "poppins", fontHeading: "bungee" } });
  } finally {
    await db.$disconnect();
  }
};
test.beforeAll(reset);
test.afterAll(reset);

const fontOf = (sel: string) => (e: Element) => getComputedStyle(e.querySelector(sel) ?? e).fontFamily;

test("a look fills in its title font, and your own Heading font then wins on every page", async ({ page }) => {
  await signIn(page, EMAIL);
  await openAccount(page);
  const html = page.locator("html");
  const heading = page.getByLabel("Heading font");
  const text = page.getByLabel("Text font");

  await page.getByTestId("look-picker").getByText("80s retrowave", { exact: true }).click();
  await expect(html).toHaveAttribute("data-look", "retro");
  await expect(heading).toHaveValue("righteous");

  // Scott's setup: Chakra Petch text, Bungee titles.
  await text.selectOption("chakra-petch");
  await heading.selectOption("bungee");
  await expect.poll(() => html.evaluate(fontOf("h1"))).toMatch(/^"?Bungee/);
  await expect.poll(() => html.evaluate((e) => getComputedStyle(e).getPropertyValue("--font-body"))).toContain("Chakra Petch");

  // Drawn by the server too, on other pages.
  await page.goto("/");
  await expect(html).toHaveAttribute("data-look", "retro");
  expect(await html.evaluate(fontOf("h1"))).toMatch(/^"?Bungee/);
  expect(await html.evaluate(fontOf("main"))).toMatch(/^"?Chakra Petch/);

  // Changing the text font never touches page titles.
  await openAccount(page);
  await text.selectOption("lexend");
  await expect.poll(() => html.evaluate(fontOf("h1"))).toMatch(/^"?Bungee/);

  // Back to Classic: fonts you picked yourself stay.
  await page.getByTestId("look-picker").getByText("Classic", { exact: true }).click();
  await expect(html).not.toHaveAttribute("data-look", /./);
  await expect(heading).toHaveValue("bungee");
  await expect(text).toHaveValue("lexend");
});

test("leaving a look you didn't change puts back the usual fonts", async ({ page }) => {
  await signIn(page, EMAIL);
  await openAccount(page);
  const picker = page.getByTestId("look-picker");
  await picker.getByText("High contrast", { exact: true }).click();
  await expect(page.getByLabel("Text font")).toHaveValue("atkinson");
  await expect(page.getByLabel("Heading font")).toHaveValue("body");
  await picker.getByText("Classic", { exact: true }).click();
  await expect(page.getByLabel("Text font")).toHaveValue("poppins");
  await expect(page.getByLabel("Heading font")).toHaveValue("bungee");
  const db = new PrismaClient();
  try {
    await expect.poll(async () => (await db.user.findUniqueOrThrow({ where: { email: EMAIL } })).fontHeading).toBe("bungee");
  } finally {
    await db.$disconnect();
  }
});

test("case titles use the Heading font, so changing Text font leaves them alone", async ({ page }) => {
  const db = new PrismaClient();
  try {
    await db.user.update({ where: { email: EMAIL }, data: { look: "retro", fontBody: "chakra-petch", fontHeading: "bungee" } });
  } finally {
    await db.$disconnect();
  }
  await signIn(page, EMAIL);
  await page.goto("/p/SHOP/cases/1");
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toBeVisible();
  expect(await title.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/^"?Bungee/);
});

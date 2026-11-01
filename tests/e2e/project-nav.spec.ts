import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `N${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("left menu is grouped and marks the page you are on", async ({ page }) => {
  // The default menu: no menu order or quest maps left over from other specs.
  const db = new PrismaClient();
  await db.user.update({ where: { email: "admin@example.com" }, data: { navOrder: {}, questMap: false } }).finally(() => db.$disconnect());
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Menu ${KEY}`, KEY);
  await page.goto(`/p/${KEY}/suites`);

  const nav = page.locator("nav").filter({ hasText: "Library" }).first();
  await expect(nav).toHaveText(
    new RegExp(`^Menu ${KEY}\\s*Test cycle\\s*Overview\\s*Library\\s*Test cases\\s*0\\s*Charters\\s*0\\s*Requirements\\s*Test suites\\s*0\\s*Shared steps\\s*0\\s*Glossary\\s*\\d*\\s*Testing\\s*Test runs\\s*Bug bashes\\s*Risk board\\s*Results\\s*Bugs\\s*Reports\\s*Settings\\s*Menu ${KEY} settings\\s*⠿ Arrange menu order\\s*Version 0\\.\\d+\\.\\d+-alpha\\.\\d+$`),
  );
  await expect(nav.getByRole("link", { name: "Test suites" })).toHaveAttribute("aria-current", "page");
  await expect(nav.locator("[aria-current=page]")).toHaveCount(1);

  await nav.getByRole("link", { name: `Menu ${KEY} settings` }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/settings$`));
  await expect(nav.getByRole("link", { name: `Menu ${KEY} settings` })).toHaveAttribute("aria-current", "page");
});

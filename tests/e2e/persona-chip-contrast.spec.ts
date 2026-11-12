import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// Scott, Nov 12: the picked "Nobody in particular" chip was pale text on a white pill in 80s retrowave.
// bg-white never changes in dark looks, so the chips and the New persona box now use bg-surface.
const EMAIL = "lead@example.com";
const AXE = require.resolve("axe-core/axe.min.js");
test.describe.configure({ mode: "serial" });

const setLook = async (look: string) => {
  const db = new PrismaClient();
  try {
    await db.user.update({ where: { email: EMAIL }, data: { look } });
  } finally {
    await db.$disconnect();
  }
};
test.afterAll(() => setLook("classic"));

test("test persona chips and the New persona box are readable in every look, and in Classic light and dark", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, EMAIL);
  const runs: [string, string | null][] = [["retro", null], ["mission", null], ["blue", null], ["arcade", null], ["hc", null], ["white", null], ["classic", "light"], ["classic", "dark"]];
  for (const [look, theme] of runs) {
    await setLook(look);
    await page.goto("/p/SHOP/cases/new?charter=1");
    if (theme) await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    const box = page.getByTestId("test-persona");
    await expect(box.getByRole("radio", { name: "Nobody in particular" })).toHaveAttribute("aria-checked", "true");
    await box.getByRole("button", { name: "+ New persona" }).click();
    await expect(box.getByLabel("Persona name")).toBeVisible();
    await page.addScriptTag({ path: AXE });
    const bad = await page.evaluate(async () => {
      // @ts-expect-error axe is added by the script tag above
      const r = await axe.run(document.querySelector('[data-testid="test-persona"]'), { runOnly: ["color-contrast"] });
      return r.violations.flatMap((v: { nodes: { html: string }[] }) => v.nodes.map((n) => n.html.slice(0, 80)));
    });
    expect(bad, theme ? `${look} ${theme}` : look).toEqual([]);
  }
});

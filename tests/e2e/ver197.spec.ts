import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { inflateSync } from "node:zlib";
import { signIn } from "./auth";

// ver_197: report files are dated on the viewer's clock. The server runs in UTC, so a PDF
// made at 5:42 PM Pacific on a Friday used to say "Sat Nov 07 2026".

const dayIn = (d: Date, zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const zoneName = (d: Date, zone: string) => new Intl.DateTimeFormat("en-US", { timeZoneName: "short", timeZone: zone }).formatToParts(d).find((p) => p.type === "timeZoneName")!.value;

/** Every text the PDF draws, from its compressed content streams (pdf-lib writes Helvetica text as hex). */
function pdfText(bytes: Buffer) {
  const raw = bytes.toString("latin1");
  let out = "";
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let s: string;
    try {
      s = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      continue;
    }
    for (const t of s.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out += Buffer.from(t[1], "hex").toString("latin1") + "\n";
  }
  return out;
}

for (const [zone, locale, spelling] of [
  ["America/Los_Angeles", "en-US", "us"],
  ["Europe/London", "en-GB", "uk"],
] as const) {
  test(`report exports use the ${zone} clock`, async ({ browser }) => {
    test.setTimeout(180_000);
    const db = new PrismaClient();
    await db.user.update({ where: { email: "admin@example.com" }, data: { spelling } as never });
    try {
      const ctx = await browser.newContext({ timezoneId: zone });
      const page = await ctx.newPage();
      await signIn(page, "admin@example.com", "Demo Admin");
      await page.goto("/p/SHOP/reports");
      // The browser saves its zone in a cookie, and the account remembers it for emails.
      await expect.poll(async () => (await ctx.cookies()).find((c) => c.name === "fp-tz")?.value).toBe(encodeURIComponent(zone));
      await page.reload();
      await expect.poll(async () => (await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } })).timeZone).toBe(zone);

      const now = new Date();
      const day = dayIn(now, zone);
      const long = now.toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "short", day: "numeric", timeZone: zone });
      const short = now.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric", timeZone: zone });

      const pdf = await page.request.get("/p/SHOP/reports/export?format=pdf&by=1&range=all&tabs=status");
      expect(pdf.headers()["content-disposition"]).toContain(`-report-${day}.pdf`);
      const text = pdfText(Buffer.from(await pdf.body()));
      expect(text).toContain(`${long} · Prepared by Demo Admin`);
      expect(text).toContain(`made ${short}`);
      expect(text).toContain(zoneName(now, zone));
      expect(text).not.toContain("UTC with Flaw Patrol");

      const xlsx = await page.request.get("/p/SHOP/reports/export?format=xlsx&range=all&tabs=status");
      expect(xlsx.headers()["content-disposition"]).toContain(`-report-${day}.xlsx`);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await xlsx.body()) as never);
      const made = String(wb.worksheets[0].getRow(2).getCell(1).value);
      expect(made).toContain(`Made ${short}`);
      expect(made).toContain(zoneName(now, zone));
      await ctx.close();
    } finally {
      await db.user.update({ where: { email: "admin@example.com" }, data: { spelling: "us" } as never });
      await db.$disconnect();
    }
  });
}

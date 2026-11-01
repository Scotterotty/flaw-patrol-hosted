import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

// Dropdowns size to their longest choice (ver_134): a fixed width like w-28
// cut "Member" to "Membe" in Poppins. A fixed width is only allowed as a
// minimum (min-w-*) next to w-auto, so long names still grow to fit.
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });

describe("dropdown widths", () => {
  it("no <Select> has a fixed width", () => {
    const bad: string[] = [];
    for (const file of walk(path.join(__dirname, ".."))) {
      const src = fs.readFileSync(file, "utf8");
      // Opening tag runs to the first ">" that ends a line (arrow functions contain "=>").
      for (const m of src.matchAll(/<Select\b([\s\S]*?[^=])>\s*\n/g)) {
        const cls = m[1].match(/className="([^"]*)"/)?.[1] ?? "";
        if (/(^|\s)w-(\d|\[)/.test(cls)) bad.push(`${path.relative(process.cwd(), file)}: ${cls}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

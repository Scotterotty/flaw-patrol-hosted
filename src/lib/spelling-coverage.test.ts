import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { spell } from "./spelling";

// Files whose American spellings are not app text: Jira field values, Apps Script code, CSS in the
// Confluence copy, a server check nobody can trigger from the app, and search keywords. The CI
// upload files hold the HTTP "Authorization" header, which must stay as it is; the role summary
// in permissions.ts is shown through useSpell in roles-card.tsx, and the color vision choices in
// vision.ts through <Sp> in accessibility.tsx. Sentry's own words (Organization, its token scopes)
// stay as Sentry writes them.
const NOT_APP_TEXT = [
  "src/components/bug-template-form.tsx",
  "src/server/sheet-sync.ts",
  "src/server/account.ts",
  "src/server/search.ts",
  "src/app/api/ci/results/route.ts",
  "src/components/ci-uploads.tsx",
  "src/lib/permissions.ts",
  "src/lib/vision.ts",
  "src/lib/sentry.ts",
  "src/server/sentry.ts",
];
const SKIP_ATTRS = new Set(["className", "style", "stroke", "fill", "tone", "key", "href", "id", "name", "type", "d", "textAnchor"]);

function files(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.tsx?$/.test(f) && !f.includes(".test.")) out.push(p);
  }
  return out;
}

/** Text in a file that looks like words people read and changes in British English. */
function britishChanges(file: string) {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    let text: string | null = null;
    if (ts.isJsxText(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) text = n.text.trim();
    const words = text && /[A-Za-z]\s|^[A-Z][a-z]/.test(text) && !/[:-]center\b|style=|var\(|^(bg|text|ring|border)-/.test(text);
    if (text && words && spell(text, "uk") !== text) {
      let p: ts.Node | undefined = n.parent;
      let skip = false;
      for (; p && !ts.isSourceFile(p); p = p.parent) if ((ts.isJsxAttribute(p) && SKIP_ATTRS.has(p.name.getText())) || ts.isImportDeclaration(p)) skip = true;
      if (!skip) found.push(text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe("British English", () => {
  it("every file with American spellings in its text shows them through <Sp>, useSpell or spell()", () => {
    const missing = files("src")
      .filter((f) => !NOT_APP_TEXT.includes(f.replaceAll("\\", "/")))
      .filter((f) => !/\b(Sp|useSpell|spell)\b/.test(readFileSync(f, "utf8")) || f.endsWith("spelling.ts"))
      .flatMap((f) => britishChanges(f).map((t) => `${f}: ${t}`))
      .filter((line) => !line.startsWith("src/lib/spelling.ts"));
    expect(missing).toEqual([]);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// The rule in the README: every server action and API route checks who is asking on the server.
// The middleware only sends signed-out visitors to Sign in, so it can't be relied on.
// This reads the code and fails when a new action or route forgets the check.

const root = join(__dirname, "..", "..");
const src = join(root, "src");

/** Calls that look up or require the signed-in person (src/auth.ts, src/lib/session.ts). */
// requireWorkspaceAdmin is shared from src/server/admin-guard.ts; the test below checks it calls requireUser.
const CHECKS = new Set(["auth", "currentUser", "requireUser", "requireProjectAction", "projectAccess", "projectAccessOrGuest", "requireWorkspaceAdmin"]);

/** Actions anyone may call, each with the check it does instead of a sign-in. */
const OPEN_ACTIONS: Record<string, string> = {
  "src/server/passwords.ts checkEmail": "the sign-in form, before anyone is signed in",
  "src/server/passwords.ts passwordSignIn": "signing in itself",
  "src/server/passwords.ts findInviteLink": "checks the hashed invite token",
  "src/server/passwords.ts acceptInvite": "checks the hashed invite token",
  "src/server/passwords.ts findPasswordLink": "checks the hashed reset token",
  "src/server/passwords.ts resetWithLink": "checks the hashed reset token, expiry and one-time use",
  "src/server/digests.ts stopDigestEmails": "the signed Stop link in a digest email",
  "src/server/bashes.ts bashTick": "only sends a bash's own clock messages when they're due; returns nothing",
};

/** Routes anyone may call, with the check they do instead. */
const OPEN_ROUTES: Record<string, string> = {
  "src/app/api/auth/[...nextauth]/route.ts": "Auth.js itself",
  "src/app/api/healthz/route.ts": "Kubernetes liveness check: answers ok, reads nothing",
  "src/app/api/readyz/route.ts": "Kubernetes readiness check: SELECT 1, answers ok or unreachable, no data",
  "src/app/api/ci/results/route.ts": "a CI upload token (Bearer), checked by its hash",
  "src/app/api/qase/hook/[secret]/route.ts": "Qase webhooks: the umbrella's secret in the link; it only starts a sync that reads Qase with the saved token",
  "src/app/api/replay/[token]/route.ts": "replay files on the separate replay address: a signed, 4-hour link to one trace file (src/lib/replay-link.ts)",
};

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const files = walk(src).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"));
const rel = (f: string) => relative(root, f).split("\\").join("/");

/** Exported functions of a file that never reach a sign-in check, looking through the file's own helpers. */
function unchecked(file: string) {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const bodies = new Map<string, ts.Node>();
  const exported: string[] = [];
  const isExported = (n: ts.Node) => !!ts.getModifiers(n as ts.HasModifiers)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) {
      bodies.set(s.name.text, s);
      if (isExported(s)) exported.push(s.name.text);
    } else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        bodies.set(d.name.text, d.initializer);
        if (isExported(s) && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer) || ts.isCallExpression(d.initializer))) exported.push(d.name.text);
      }
    }
  }
  const names = (node: ts.Node) => {
    const out = new Set<string>();
    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n)) out.add(n.text);
      ts.forEachChild(n, visit);
    };
    visit(node);
    return out;
  };
  const checked = (name: string, seen = new Set<string>()): boolean => {
    if (seen.has(name)) return false;
    seen.add(name);
    const body = bodies.get(name);
    if (!body) return false;
    for (const n of names(body)) if (CHECKS.has(n) || (n !== name && bodies.has(n) && checked(n, seen))) return true;
    return false;
  };
  return exported.filter((name) => !checked(name));
}

describe("authorization on the server", () => {
  const actionFiles = files.filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8")));

  it("finds the server actions and routes", () => {
    expect(actionFiles.length).toBeGreaterThan(40);
    expect(files.filter((f) => f.endsWith("route.ts")).length).toBeGreaterThan(8);
  });

  it("the shared workspace admin check signs in first and refuses non-admins", () => {
    const text = readFileSync(join(src, "server", "admin-guard.ts"), "utf8");
    expect(text).toMatch(/const user = await requireUser\(\);\s+if \(!user\.isAdmin\) throw/);
  });

  it("every server action checks who is signed in", () => {
    const missing = actionFiles.flatMap((f) => unchecked(f).map((name) => `${rel(f)} ${name}`)).filter((key) => !OPEN_ACTIONS[key]);
    expect(missing, "Add a requireUser/requireProjectAction check, or list it in OPEN_ACTIONS with the reason").toEqual([]);
  });

  it("every API route checks who is asking", () => {
    const routes = files.filter((f) => f.endsWith("route.ts") && rel(f).startsWith("src/app/api/"));
    const missing = routes.filter((f) => !OPEN_ROUTES[rel(f)] && unchecked(f).length).map(rel);
    expect(missing, "Check auth()/currentUser() in the route, or list it in OPEN_ROUTES with the reason").toEqual([]);
  });

  it("keeps the open lists current", () => {
    const actions = new Set(actionFiles.flatMap((f) => unchecked(f).map((name) => `${rel(f)} ${name}`)));
    expect(Object.keys(OPEN_ACTIONS).filter((k) => !actions.has(k))).toEqual([]);
    expect(Object.keys(OPEN_ROUTES).filter((k) => !files.some((f) => rel(f) === k))).toEqual([]);
  });
});

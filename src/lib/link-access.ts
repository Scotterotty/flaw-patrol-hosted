// Shared links for people outside the team (ver_115). Pure helpers: what a link opens, and
// how to say a list of names. The database side is in src/lib/link-access-server.ts.

/** What a path inside Flaw Patrol opens, in plain words ("a report"), with its project or umbrella. */
export type LinkTarget = { kind: "project"; key: string; what: string; bashId: string | null } | { kind: "umbrella"; groupId: string; what: string };

const WHAT: Record<string, string> = {
  bashes: "a bug bash",
  runs: "a test run",
  cases: "a test case",
  reports: "a report",
  defects: "a bug",
  bugs: "a bug",
  suites: "a test suite",
  "shared-steps": "a shared step",
  charters: "a charter",
  personas: "a persona",
  stories: "a story",
  risk: "the Risk board",
  glossary: "the Glossary",
  quests: "a quest map",
  replay: "a replay",
  settings: "the settings",
};

// The same sections without an id: the list itself.
const LIST: Record<string, string> = {
  bashes: "the bug bashes",
  runs: "the test runs",
  cases: "the Case library",
  defects: "the bugs list",
  bugs: "the bugs list",
  suites: "the test suites",
  "shared-steps": "the shared steps",
  charters: "the charters",
  personas: "the personas",
  stories: "the stories",
};

/** Read /p/KEY/... or /g/ID/... (with any query or hash). Null for anything else. */
export function linkTarget(path: string): LinkTarget | null {
  let p: string;
  try {
    p = new URL(path, "http://x").pathname;
  } catch {
    return null;
  }
  const parts = p.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  if (parts.length < 2) return null;
  const section = parts[2] ?? "";
  const what = (!parts[3] && LIST[section]) || WHAT[section] || (section ? "a page" : "its home page");
  if (parts[0] === "p") {
    const bashId = section === "bashes" && parts[3] ? parts[3] : null;
    // A run's own page is runs/N; runs/import is the import page.
    const w = section === "runs" && parts[3] === "import" ? "a page" : what;
    return { kind: "project", key: parts[1].toUpperCase(), what: w, bashId };
  }
  if (parts[0] === "g") return { kind: "umbrella", groupId: parts[1], what };
  return null;
}

/** Bash pages a guest may open: the board, Join, Explore and the report. */
export function bashGuestPath(path: string): { key: string; id: string; page: "" | "join" | "explore" | "report" } | null {
  let p: string;
  try {
    p = new URL(path, "http://x").pathname;
  } catch {
    return null;
  }
  const m = /^\/p\/([^/]+)\/bashes\/([^/]+)(?:\/(join|explore|report))?\/?$/.exec(p);
  if (!m) return null;
  return { key: decodeURIComponent(m[1]).toUpperCase(), id: decodeURIComponent(m[2]), page: (m[3] ?? "") as "" | "join" | "explore" | "report" };
}

/** "Dana", "Dana and Sam", "Dana, Sam and Riley". */
export function andList(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Only paths inside the app, so /access?to= can't send anyone elsewhere. */
export function safeInside(to: string | null | undefined) {
  if (!to || !to.startsWith("/") || to.startsWith("//") || to.startsWith("/\\")) return null;
  return to;
}

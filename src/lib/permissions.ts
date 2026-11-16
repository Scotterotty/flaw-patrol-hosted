import type { Role } from "@prisma/client";

// What each project role may do. Workspace admins act as project ADMIN everywhere.
export type Action =
  | "case:edit" // create and edit test cases, insert shared steps
  | "case:archive"
  | "folder:manage" // create, rename and move folders
  | "folder:delete"
  | "shared:manage" // create and edit shared steps and personas, turn steps into a shared step
  | "library:archive" // archive suites, shared steps and personas
  | "library:move" // move a test cycle's own cases into the umbrella's Case library
  | "import"
  | "project:manage" // test cycle name and description
  | "project:separate" // keep a test cycle's members separate from its umbrella's
  | "members:manage" // members and roles: always admins only
  | "jira:manage" // Jira connection, bug template, Slack alerts, GitHub repos, TeamCity
  | "project:group" // put the project in a project group or take it out
  | "suite:manage"
  | "run:create"
  | "run:manage" // close and reopen runs
  | "run:assign" // assign testers to cases
  | "run:delete"
  | "run:import" // import a run from a sheet, upload or pull automation results
  | "run:execute" // record results, raise defects, attach evidence
  | "risk:move" // move requirements on the Risk board
  | "defect:edit"
  | "umbrella:shortcuts" // umbrellas (role on the hub): change the shortcuts on its Projects-page card
  | "umbrella:rc" // start the next release: one new project per platform
  | "umbrella:manage" // platforms and their suites
  | "umbrella:fields" // run fields: the extra details runs ask for
  | "cycle:create" // umbrellas (role on the hub): make a new test cycle under it
  | "cycle:archive" // archive test cycles
  | "umbrella:archive" // archive the umbrella with its projects, or restore it
  | "bash:join" // join a bug bash, log bugs in it and attach screenshots: Viewers too
  | "case:flag" // flag a case that needs attention, with a note: Viewers too
  | "case:export" // download cases for Excel, Qase, qTest or TestRail (ver_190): Viewers too, unless turned off
  | "glossary:edit" // add, answer and edit Glossary terms; anyone, Viewers too, can read and ask
  | "bugtemplate:edit" // make and edit bug templates
  | "bugtemplate:delete"; // delete bug templates: admins by default

// Viewers see everything, flag cases and join bug bashes; nothing in the Roles grid.
const RANK: Record<Role, number> = { VIEWER: 0, TESTER: 1, LEAD: 2, ADMIN: 3 };

/**
 * The rows of the "What can they do" card (opened up in ver_96). Each umbrella,
 * and each test cycle that isn't in one, picks a preset or ticks the table. `std` is the
 * minimum role under Everyone (the default), `tight` under Tighter. `locked` rows stay
 * admin-only.
 */
export const ROLE_ROWS: { id: string; group: string; label: string; actions: Action[]; std: Role; tight: Role; locked?: true; archive?: true; /** The one kind of row Viewers can be ticked on: it only reads. */ viewers?: true }[] = [
  { id: "cases", group: "Cases and library", label: "Create and edit test cases", actions: ["case:edit"], std: "TESTER", tight: "TESTER" },
  { id: "import", group: "Cases and library", label: "Import cases", actions: ["import"], std: "TESTER", tight: "LEAD" },
  { id: "export", group: "Cases and library", label: "Export cases", actions: ["case:export"], std: "VIEWER", tight: "TESTER", viewers: true },
  { id: "folders", group: "Cases and library", label: "Create, rename and move folders", actions: ["folder:manage"], std: "TESTER", tight: "LEAD" },
  { id: "suites", group: "Cases and library", label: "Create and edit test suites", actions: ["suite:manage"], std: "TESTER", tight: "LEAD" },
  { id: "shared", group: "Cases and library", label: "Create and edit shared steps and personas", actions: ["shared:manage"], std: "TESTER", tight: "LEAD" },
  { id: "library", group: "Cases and library", label: "Move cases into the Case library", actions: ["library:move"], std: "TESTER", tight: "LEAD" },
  { id: "glossary", group: "Cases and library", label: "Add and edit Glossary terms", actions: ["glossary:edit"], std: "TESTER", tight: "TESTER" },
  { id: "runs", group: "Runs and bugs", label: "Start runs", actions: ["run:create"], std: "TESTER", tight: "TESTER" },
  { id: "results", group: "Runs and bugs", label: "Record results and file bugs", actions: ["run:execute", "defect:edit"], std: "TESTER", tight: "TESTER" },
  { id: "assign", group: "Runs and bugs", label: "Assign people to cases", actions: ["run:assign"], std: "TESTER", tight: "LEAD" },
  { id: "close", group: "Runs and bugs", label: "Close and reopen runs", actions: ["run:manage"], std: "TESTER", tight: "LEAD" },
  { id: "risk", group: "Runs and bugs", label: "Move requirements on the Risk board", actions: ["risk:move"], std: "TESTER", tight: "TESTER" },
  { id: "bugtemplates", group: "Runs and bugs", label: "Make and edit bug templates", actions: ["bugtemplate:edit"], std: "TESTER", tight: "LEAD" },
  { id: "runimport", group: "Runs and bugs", label: "Import a run, or upload or pull automation results", actions: ["run:import"], std: "TESTER", tight: "LEAD" },
  { id: "cycle", group: "Test cycles", label: "Add a test cycle", actions: ["cycle:create"], std: "TESTER", tight: "LEAD" },
  { id: "rc", group: "Test cycles", label: "Start a release candidate", actions: ["umbrella:rc"], std: "TESTER", tight: "LEAD" },
  { id: "runfields", group: "Test cycles", label: "Run fields (extra details runs ask for)", actions: ["umbrella:fields"], std: "TESTER", tight: "LEAD" },
  { id: "platforms", group: "Test cycles", label: "Platforms and their suites", actions: ["umbrella:manage"], std: "TESTER", tight: "LEAD" },
  { id: "shortcuts", group: "Test cycles", label: "Shortcuts on the Umbrellas page", actions: ["umbrella:shortcuts"], std: "TESTER", tight: "LEAD" },
  { id: "settings", group: "Test cycles", label: "Test cycle name and description", actions: ["project:manage"], std: "TESTER", tight: "LEAD" },
  { id: "jira", group: "Settings", label: "Jira, bug template, Slack alerts, Sentry, GitHub, TeamCity and CI uploads", actions: ["jira:manage"], std: "ADMIN", tight: "ADMIN" },
  { id: "separate", group: "Settings", label: "Keep a test cycle's members separate", actions: ["project:separate"], std: "ADMIN", tight: "ADMIN" },
  { id: "members", group: "Settings", label: "Members and roles", actions: ["members:manage"], std: "ADMIN", tight: "ADMIN", locked: true },
  { id: "archcases", group: "Archive and delete", label: "Archive test cases", actions: ["case:archive"], std: "ADMIN", tight: "ADMIN", archive: true },
  { id: "archlib", group: "Archive and delete", label: "Archive suites, shared steps and personas", actions: ["library:archive"], std: "ADMIN", tight: "ADMIN", archive: true },
  { id: "delfolders", group: "Archive and delete", label: "Delete folders", actions: ["folder:delete"], std: "ADMIN", tight: "ADMIN", archive: true },
  { id: "delruns", group: "Archive and delete", label: "Delete runs", actions: ["run:delete"], std: "ADMIN", tight: "ADMIN", archive: true },
  { id: "delbugtemplates", group: "Archive and delete", label: "Delete bug templates", actions: ["bugtemplate:delete"], std: "ADMIN", tight: "ADMIN", archive: true },
  { id: "archcycles", group: "Archive and delete", label: "Archive test cycles and the umbrella", actions: ["cycle:archive", "umbrella:archive"], std: "ADMIN", tight: "ADMIN", archive: true },
];

// Moving a test cycle into or out of an umbrella or group: the test cycle's admins only
// (hosted build, backend team review H1). Moving it hands it to the umbrella's admins and
// role rules, so a tester could otherwise give away a cycle they don't run.
const NEEDS = { "project:group": "ADMIN", "bash:join": "VIEWER", "case:flag": "VIEWER" } as Record<Action, Role>;
for (const row of ROLE_ROWS) for (const a of row.actions) NEEDS[a] = row.std;

/**
 * "everyone" is the default and is never stored (null). Saved "standard" and "open"
 * rules from before ver_96 read as Everyone, so they pick up the new defaults.
 */
export type RolePreset = "everyone" | "tighter" | "custom";
/** Stored on the umbrella (or a lone test cycle): the preset, and for Custom the roles ticked per row. */
export type RoleRules = { preset: RolePreset; allow?: Record<string, Role[]> };
export const PRESET_LABEL: Record<RolePreset, string> = {
  everyone: "Everyone",
  tighter: "Tighter",
  custom: "Custom",
};

export function parseRoleRules(v: unknown): RoleRules | null {
  if (!v || typeof v !== "object") return null;
  const r = v as { preset?: unknown; allow?: unknown };
  if (r.preset === "tighter") return { preset: "tighter" };
  if (r.preset !== "custom") return null;
  const allow: Record<string, Role[]> = {};
  if (r.allow && typeof r.allow === "object")
    for (const [k, roles] of Object.entries(r.allow as Record<string, unknown>))
      if (Array.isArray(roles)) allow[k] = roles.filter((x): x is Role => x === "TESTER" || x === "LEAD" || (x === "VIEWER" && !!ROLE_ROWS.find((r) => r.id === k)?.viewers));
  return { preset: "custom", allow };
}

/** A role, plus the Roles card rules of the umbrella or test cycle it applies in. */
export type Who = { role: Role | null; rules?: RoleRules | null };

/** Whether a role on one row is ticked under these rules. Admins always are. */
export function rowAllows(row: (typeof ROLE_ROWS)[number], role: Role, rules?: RoleRules | null): boolean {
  if (role === "ADMIN") return true;
  if (row.locked || (role === "VIEWER" && !row.viewers)) return false;
  if (!rules || rules.preset === "everyone") return RANK[role] >= RANK[row.std];
  if (rules.preset === "tighter") return RANK[role] >= RANK[row.tight];
  const ticked = rules.allow?.[row.id];
  return ticked ? ticked.includes(role) : RANK[role] >= RANK[row.std];
}

export function can(who: Role | Who | null | undefined, action: Action): boolean {
  if (!who) return false;
  const role = typeof who === "string" ? who : who.role;
  const rules = typeof who === "string" ? null : who.rules;
  if (!role) return false;
  const row = ROLE_ROWS.find((r) => r.actions.includes(action));
  if (!row) return RANK[role] >= RANK[NEEDS[action]];
  return rowAllows(row, role, rules);
}

/** Each row in a few words, for the summary below. Rows with the same words merge. */
const SHORT_WORDS: Record<string, string> = {
  cases: "write cases",
  import: "import",
  export: "export cases",
  folders: "organize folders",
  suites: "manage suites and shared steps",
  shared: "manage suites and shared steps",
  library: "move cases into the Case library",
  glossary: "add Glossary terms",
  runs: "run tests",
  results: "file bugs",
  assign: "assign people",
  close: "close runs",
  runimport: "upload automation results",
  bugtemplates: "make bug templates",
  delbugtemplates: "archive and delete",
  cycle: "add test cycles",
  rc: "start the next release",
  runfields: "set run fields",
  platforms: "set platforms",
  shortcuts: "edit shortcuts",
  jira: "connect Jira, Slack, Sentry, GitHub and CI",
  separate: "keep a test cycle's members separate",
  settings: "rename test cycles",
  members: "manage members and roles",
  archcases: "archive and delete",
  archlib: "archive and delete",
  delfolders: "archive and delete",
  delruns: "archive and delete",
  archcycles: "archive and delete",
};

const listOf = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * What each role can do in one paragraph, written from ROLE_ROWS, so the summary
 * can't disagree with the grid under it or with Getting Started.
 */
export function roleSummary(rules?: RoleRules | null): string {
  const seen = new Set<string>();
  const words = (role: Role, below?: Role) =>
    ROLE_ROWS.filter((r) => rowAllows(r, role, rules) && !(below && rowAllows(r, below, rules)))
      .map((r) => SHORT_WORDS[r.id] ?? r.label.toLowerCase())
      .filter((w) => !seen.has(w) && seen.add(w));
  const v = words("VIEWER");
  const t = words("TESTER", "VIEWER");
  const l = words("LEAD", "TESTER");
  const a = words("ADMIN", "LEAD");
  return [
    `Viewers see everything, ${listOf(["flag cases", "join bug bashes", "ask in the Glossary", ...v])}.`,
    t.length ? `Members ${listOf(t)}.` : "Members only see.",
    l.length ? `Leads also ${listOf(l)}.` : "Leads can do the same as Members.",
    a.length ? `Admins also ${listOf(a)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

// TESTER is shown as "Member" since ver_94; the stored value stays.
export const ROLE_LABEL: Record<Role, string> = { ADMIN: "Admin", LEAD: "Lead", TESTER: "Member", VIEWER: "Viewer" };
/** The roles people can be given, lowest first. */
export const ROLES_PICK: Role[] = ["VIEWER", "TESTER", "LEAD", "ADMIN"];

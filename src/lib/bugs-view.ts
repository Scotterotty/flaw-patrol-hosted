/**
 * Bugs page Table and Board in sync (ver_232): both views show the same bugs and share one
 * filter bar. The shared picks live in the web address, so switching views keeps them, and the
 * Jira board, the view and Found in testing are also saved on the person's account (User.bugsPicks),
 * so they stay after signing out and on any computer. Plain helpers only: the page and the browser
 * both use them.
 */

import { isMe } from "./bug-board";

/** The filters both views share, by their name in the web address. */
export const SHARED_KEYS = ["board", "q", "found", "mine", "version", "priority", "label"] as const;

export type BugsPicks = {
  view?: "table" | "board";
  /** Found in testing: true shows only the bugs in Flaw Patrol, false every bug on the board. */
  found?: boolean;
  /** The Jira board picked, per Jira project key. */
  boards?: Record<string, string>;
  /** Which bug panel boxes this person keeps open or closed (ver_234). Missing ones use the box's default. */
  folds?: Partial<Record<FoldBox, boolean>>;
};

/** The bug panel's boxes that open and close, top to bottom (ver_234). */
export const FOLD_BOXES = ["description", "repro", "found", "comments", "attachments", "details"] as const;
export type FoldBox = (typeof FOLD_BOXES)[number];

/** Whether a bug panel box starts open: Repro steps and Where it was found do; Description only when there are no repro steps. */
export function foldOpen(box: FoldBox, folds: BugsPicks["folds"], hasRepro: boolean): boolean {
  const saved = folds?.[box];
  if (typeof saved === "boolean") return saved;
  return box === "repro" || box === "found" || (box === "description" && !hasRepro);
}

/** The person's saved picks, from User.bugsPicks. Anything odd is left out. */
export function readPicks(raw: unknown): BugsPicks {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: BugsPicks = {};
  if (r.view === "table" || r.view === "board") out.view = r.view;
  if (typeof r.found === "boolean") out.found = r.found;
  if (r.boards && typeof r.boards === "object" && !Array.isArray(r.boards)) {
    const boards: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.boards as Record<string, unknown>).slice(0, 50)) if (typeof v === "string" && v.length <= 40 && k.length <= 40) boards[k] = v;
    out.boards = boards;
  }
  if (r.folds && typeof r.folds === "object" && !Array.isArray(r.folds)) {
    const folds: Partial<Record<FoldBox, boolean>> = {};
    for (const b of FOLD_BOXES) {
      const v = (r.folds as Record<string, unknown>)[b];
      if (typeof v === "boolean") folds[b] = v;
    }
    out.folds = folds;
  }
  return out;
}

/** A change to the saved picks, merged in. Boards merge per Jira project. */
export function mergePicks(old: BugsPicks, patch: { view?: string; found?: boolean; board?: { jira: string; id: string }; folds?: Partial<Record<string, boolean>> }): BugsPicks {
  const next: BugsPicks = { ...old };
  if (patch.view === "table" || patch.view === "board") next.view = patch.view;
  if (typeof patch.found === "boolean") next.found = patch.found;
  if (patch.board && /^[A-Za-z0-9_-]{1,40}$/.test(patch.board.jira) && /^\d{1,20}$/.test(patch.board.id)) next.boards = { ...old.boards, [patch.board.jira]: patch.board.id };
  if (patch.folds && typeof patch.folds === "object") next.folds = { ...old.folds, ...patch.folds };
  return readPicks(next);
}

export type SharedFilters = { q: string; found: boolean; mine: boolean; version: string; priority: string; label: string };

/** The shared filters from the web address, with Found in testing falling back to the saved pick (on at first). */
export function sharedFilters(sp: Record<string, string | undefined>, picks: BugsPicks): SharedFilters {
  return {
    q: (sp.q ?? "").slice(0, 200),
    found: sp.found === "all" ? false : sp.found === "1" ? true : (picks.found ?? true),
    mine: sp.mine === "1",
    version: sp.version ?? "",
    priority: sp.priority ?? "",
    label: sp.label ?? "",
  };
}

/** One bug as the filters see it, from Jira's board, Flaw Patrol, or both. */
export type FilterBug = {
  key: string;
  title: string;
  assignee: string;
  assigneeEmail: string;
  labels: string[];
  priority: string;
  /** Jira's versions plus Flaw Patrol's Found in version. */
  versions: string[];
  /** In Flaw Patrol: found in a run or written here. */
  inFp: boolean;
};

/** Whether a bug passes the shared filters. Search matches the key, title, labels and assignee. */
export function keepBug(b: FilterBug, f: SharedFilters, me: { name: string; email: string }, opts: { search?: boolean } = {}) {
  const words = opts.search === false ? [] : f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return (
    (!f.found || b.inFp) &&
    (!f.mine || isMe({ name: b.assignee, email: b.assigneeEmail }, me)) &&
    (!f.version || b.versions.includes(f.version)) &&
    (!f.label || b.labels.includes(f.label)) &&
    (!f.priority || b.priority === f.priority) &&
    words.every((w) => `${b.key} ${b.title} ${b.labels.join(" ")} ${b.assignee}`.toLowerCase().includes(w))
  );
}

/** The web address for the other view, keeping every filter and the board. */
export function switchHref(search: string, view: "table" | "board") {
  const s = new URLSearchParams(search);
  s.set("view", view);
  return `?${s}`;
}

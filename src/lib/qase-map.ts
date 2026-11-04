import type { ResultStatus } from "@prisma/client";
import { wordsOf } from "./fuzzy";

// Qase (ver_164): the parts of sharing results with Qase that don't talk to it,
// so they can be unit tested: status matching, linking cases by title, and the
// marker that keeps results from bouncing back and forth.

/** Flaw Patrol statuses a person can save, in the order Settings lists them. */
export const QASE_SENDABLE = ["PASSED", "FAILED", "BLOCKED", "RETEST", "SKIPPED"] as const;
export type QaseSendable = (typeof QASE_SENDABLE)[number];

/** Qase's built-in result statuses. Custom ones aren't offered. */
export const QASE_STATUSES = ["passed", "failed", "blocked", "skipped", "invalid"] as const;

export const QASE_STATUS_LABEL: Record<string, string> = { passed: "Passed", failed: "Failed", blocked: "Blocked", skipped: "Skipped", invalid: "Invalid", "": "Don't send" };

/** What each Flaw Patrol status becomes in Qase unless Settings changes it. "" = not sent. */
export const QASE_SEND_DEFAULT: Record<QaseSendable, string> = { PASSED: "passed", FAILED: "failed", BLOCKED: "blocked", RETEST: "blocked", SKIPPED: "skipped" };

/** What a Qase status becomes here. Others (custom statuses, in progress) aren't brought in. */
export const QASE_BRING: Record<string, ResultStatus> = { passed: "PASSED", failed: "FAILED", blocked: "BLOCKED", skipped: "SKIPPED", invalid: "RETEST" };

/** The saved status choices, with defaults for anything missing or not a Qase status. */
export function parseStatusMap(v: unknown): Record<QaseSendable, string> {
  const raw = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const out = { ...QASE_SEND_DEFAULT };
  for (const s of QASE_SENDABLE) {
    const x = raw[s];
    if (typeof x === "string" && (x === "" || (QASE_STATUSES as readonly string[]).includes(x))) out[s] = x;
  }
  return out;
}

/** The Qase status a Flaw Patrol result is sent as, or null when it isn't sent. */
export function qaseStatusFor(status: ResultStatus, map: Record<QaseSendable, string>): string | null {
  if (!(QASE_SENDABLE as readonly string[]).includes(status)) return null;
  return map[status as QaseSendable] || null;
}

/** Comments on results Flaw Patrol sends start with this, so pulling them back skips them. */
export const FROM_FP = "From Flaw Patrol";

export function sentComment(tester: string, comment: string) {
  const who = tester ? `${FROM_FP} · ${tester}` : FROM_FP;
  return comment.trim() ? `${who}\n\n${comment.trim()}` : who;
}

export const cameFromUs = (comment: string | null | undefined) => (comment ?? "").startsWith(FROM_FP);

/** Titles compared word by word, ignoring case, punctuation and [tags]. */
export const titleKey = (title: string) => wordsOf(title.replace(/\[[^\]]*\]/g, " ")).join(" ");

/**
 * Link cases to Qase cases with the same title. Only titles that appear once on each side
 * link, so two "Sign in" cases never guess. Returns case id -> Qase case id.
 */
export function matchByTitle(cases: { id: string; title: string }[], qase: { id: number; title: string }[], taken: Set<number> = new Set()) {
  const count = <T,>(xs: T[], key: (x: T) => string) => {
    const m = new Map<string, T[]>();
    for (const x of xs) {
      const k = key(x);
      if (!k) continue;
      m.set(k, [...(m.get(k) ?? []), x]);
    }
    return m;
  };
  const ours = count(cases, (c) => titleKey(c.title));
  const theirs = count(
    qase.filter((q) => !taken.has(q.id)),
    (q) => titleKey(q.title),
  );
  const out = new Map<string, number>();
  for (const [k, list] of ours) {
    const hit = theirs.get(k);
    if (list.length === 1 && hit?.length === 1) out.set(list[0].id, hit[0].id);
  }
  return out;
}

/** Qase cases most like a title, best first, for the Link cases picker. */
export function closestCases(title: string, qase: { id: number; title: string }[], n = 6) {
  const mine = new Set(titleKey(title).split(" ").filter(Boolean));
  if (!mine.size) return [];
  return qase
    .map((q) => {
      const theirs = new Set(titleKey(q.title).split(" ").filter(Boolean));
      const shared = [...mine].filter((w) => theirs.has(w)).length;
      return { q, score: shared / Math.max(1, new Set([...mine, ...theirs]).size) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.q.id - b.q.id)
    .slice(0, n)
    .map((x) => x.q);
}

/** "OKO-42", how Qase shows a case's ID. */
export const qaseCaseKey = (code: string, id: number) => `${code}-${id}`;

/** A Qase case ID typed as "OKO-42", "42" or a Qase link. */
export function parseQaseCaseId(input: string, code: string): number | null {
  const s = input.trim();
  const m = new RegExp(`^(?:${code.replace(/[^A-Za-z0-9]/g, "")}-)?(\\d{1,9})$`, "i").exec(s) ?? /\/case\/[A-Za-z0-9]+-(\d{1,9})\b/.exec(s) ?? /[?&]case=(\d{1,9})\b/.exec(s);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Qase result times ("2026-11-03 18:05:00" in UTC, or ISO) as a Date. */
export function qaseTime(v: string | null | undefined): Date | null {
  if (!v) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v) ? `${v.replace(" ", "T")}Z` : v;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

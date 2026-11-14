// Bug audit (ver_250): a team pass over a Jira filter of old bugs before a bug bash.
// Jira is the source of truth. The list is the audit's filter, and every bug someone checks
// gets the audit's label in Jira, whatever they found (a bug that still happens stays open,
// it's just been checked), so it drops off the filter. A comment goes in only when there's news
// (ver_255): anything but Still happens, or a note someone typed. Flaw Patrol only adds what Jira can't
// hold: who has which bug right now, and what each person found.

export const OUTCOMES = [
  { id: "still", label: "Still happens", key: "1" },
  { id: "cant", label: "Can't reproduce", key: "2" },
  { id: "fixed", label: "Already fixed", key: "3" },
  { id: "dupe", label: "Duplicate", key: "4" },
  { id: "info", label: "Needs info", key: "5" },
] as const;
export type Outcome = (typeof OUTCOMES)[number]["id"];
export const isOutcome = (v: unknown): v is Outcome => OUTCOMES.some((o) => o.id === v);
export const outcomeLabel = (v: string) => OUTCOMES.find((o) => o.id === v)?.label ?? v;

/**
 * A claim lasts this long without a sign of life, so a forgotten bug goes back. The Audit page
 * renews it every few minutes while the bug is open (KEEP_MS), and taking another bug lets it go at once.
 * 30 minutes (ver_256), so someone trying a bug in a headset or on a device doesn't lose it.
 */
export const CLAIM_MS = 30 * 60_000;
export const KEEP_MS = 4 * 60_000;

/** One bug on the audit's filter, as the list needs it. */
export type AuditIssue = {
  key: string;
  title: string;
  status: string;
  priority: string;
  components: string[];
  labels: string[];
  created: string;
};

export type AuditClaim = { issueKey: string; claimedById: string | null; claimedBy: string; claimedAt: Date | null; checkedAt: Date | null };

export const claimLive = (c: Pick<AuditClaim, "claimedById" | "claimedAt" | "checkedAt"> | undefined, now: Date) =>
  !!c && !c.checkedAt && !!c.claimedById && !!c.claimedAt && now.getTime() - c.claimedAt.getTime() < CLAIM_MS;

/** Other names a platform goes by in OB summaries: Unreal bugs are often "UE4" or "UEEE". */
const ALIASES: Record<string, string[]> = { unreal: ["unreal", "ue4", "ue5", "ueee"], web: ["web", "browser"], unity: ["unity"] };

/** Does a bug look like it's about this platform (its summary, components or labels say so)? */
export function aboutPlatform(issue: Pick<AuditIssue, "title" | "components" | "labels">, platform: string) {
  const p = platform.trim().toLowerCase();
  if (!p) return true;
  const words = ALIASES[p] ?? [p];
  const text = ` ${[issue.title, ...issue.components, ...issue.labels].join(" ").toLowerCase()} `;
  return words.some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text));
}

export type AuditPick = { platform?: string; component?: string };

export const matchesPick = (issue: AuditIssue, pick: AuditPick) => aboutPlatform(issue, pick.platform ?? "") && (!pick.component || issue.components.includes(pick.component));

/**
 * The bug "Next bug" hands this person: one they already hold first, then the first bug on the
 * filter (in the filter's own order) that nobody holds and that fits their platform and component.
 */
export function pickNext(issues: AuditIssue[], claims: Map<string, AuditClaim>, meId: string, now: Date, pick: AuditPick = {}, skip: string[] = []): AuditIssue | null {
  const fits = issues.filter((i) => !skip.includes(i.key) && matchesPick(i, pick));
  const mine = fits.find((i) => {
    const c = claims.get(i.key);
    return c?.claimedById === meId && claimLive(c, now);
  });
  if (mine) return mine;
  return fits.find((i) => !claims.get(i.key)?.checkedAt && !claimLive(claims.get(i.key), now)) ?? null;
}

/** How long after Verify a bug may still show on the filter while Jira's search catches up with the label. */
export const LABEL_LAG_MS = 2 * 60_000;

/**
 * Checks Jira has undone (ver_253, ver_254): bugs checked here that no longer carry the audit's label
 * in Jira, because someone removed it (open or closed bug alike). Jira decides, so they count as
 * unchecked again. A check newer than LABEL_LAG_MS is left alone while Jira's search catches up.
 */
export function reopenedChecks(checks: { issueKey: string; checkedAt: Date | null }[], labelled: Set<string>, now: Date) {
  return checks.filter((c) => c.checkedAt && !labelled.has(c.issueKey) && now.getTime() - c.checkedAt.getTime() > LABEL_LAG_MS).map((c) => c.issueKey);
}

/**
 * The audit's search (ver_256): its filter or JQL, leaving out bugs that already carry the label, so
 * a checked bug never counts as left even when the filter itself forgets to leave them out.
 * A typed ORDER BY stays at the end so the list keeps the filter's order.
 */
export function auditJql(jql: string, label: string) {
  const order = /\sORDER\s+BY\s[\s\S]*$/i.exec(` ${jql}`)?.[0] ?? "";
  const where = (order ? ` ${jql}`.slice(0, -order.length) : jql).trim();
  const l = label.replace(/["\\]/g, "");
  const notLabelled = `(labels is EMPTY OR labels not in ("${l}"))`;
  return `${where ? `(${where}) AND ` : ""}${notLabelled}${order ? ` ${order.trim()}` : ""}`;
}

/** A Jira filter link or number becomes "filter = 23539"; anything else is taken as JQL. */
export function parseFilterInput(input: string): { jql: string; filterId: string | null } | null {
  const v = input.trim();
  if (!v) return null;
  const id = /^\d+$/.exec(v)?.[0] ?? /[?&]filter=(\d+)/.exec(v)?.[1] ?? /\/filters\/(\d+)/.exec(v)?.[1];
  if (id) return { jql: `filter = ${id}`, filterId: id };
  if (/^https?:\/\//i.test(v)) return null;
  return v.length <= 2000 ? { jql: v, filterId: null } : null;
}

/** "12 a day" to finish by the due date: what's left over the days left, today included. */
export function pace(left: number, dueOn: Date | null, now: Date) {
  if (!dueOn) return null;
  const day = 24 * 60 * 60_000;
  const days = Math.max(1, Math.ceil((dueOn.getTime() - now.getTime()) / day));
  return { days, perDay: Math.ceil(left / days) };
}

/** The Jira fields someone can change while checking a bug. */
export type Editable = { summary: string; priority: string; components: string[]; versions: string[] };

const list = (v: string[]) => (v.length ? v.join(", ") : "none");

/** What changed between two versions of the fields, in words: "Priority: Low → Medium". */
export function fieldChanges(before: Editable, after: Editable): string[] {
  const out: string[] = [];
  if (before.summary.trim() !== after.summary.trim()) out.push(`Summary: ${before.summary.trim()} → ${after.summary.trim()}`);
  if (before.priority !== after.priority) out.push(`Priority: ${before.priority || "none"} → ${after.priority || "none"}`);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  if (!same(before.components, after.components)) out.push(`Components: ${list(before.components)} → ${list(after.components)}`);
  if (!same(before.versions, after.versions)) out.push(`Affects version: ${list(before.versions)} → ${list(after.versions)}`);
  return out;
}

/**
 * Does Save leave a comment (ver_255)? Justin's audit rule: a bug that's still the same only gets the
 * label. Everything else says why (ver_256: the note is required for those), and so does any typed note.
 * Field fixes and status moves don't need one: Jira's own history shows them.
 */
export const auditNeedsComment = (outcome: Outcome, note: string) => outcome !== "still" || note.trim() !== "";

/** Closing a bug or asking for info needs a reason in the note (ver_256). Still happens doesn't. */
export const auditNoteRequired = (outcome: Outcome | null) => !!outcome && outcome !== "still";

/** The question above the note box, and an example of an answer, for each outcome (ver_256). */
export const NOTE_ASK: Record<Outcome, { ask: string; example: string }> = {
  still: { ask: "Note (optional)", example: "Anything new, like it only happens on the second try." },
  cant: { ask: "Why can't you reproduce it?", example: "Tried the steps 10 times on build R24 and it didn't happen." },
  fixed: { ask: "How do you know it's fixed?", example: "The menu opens every time now. Fixed by the R22 menu rework." },
  dupe: { ask: "Anything to add about the duplicate?", example: "Same crash, same steps. The other bug has the logs." },
  info: { ask: "What info is missing?", example: "Which headset, and the steps to get to the lobby." },
};

/**
 * The comment the check leaves in Jira (ver_256): the person's own note, then who checked it and on
 * what. Every comment posts from Flaw Patrol's one Jira account, so the name line says who wrote it.
 */
export function auditComment(a: { note: string; by: string; clients: string[]; build: string }) {
  const sign = ["— " + (a.by.trim() || "Flaw Patrol"), a.clients.join(", "), a.build.trim() && `build ${a.build.trim()}`].filter(Boolean).join(" · ");
  return [a.note.trim(), sign].filter(Boolean).join("\n");
}

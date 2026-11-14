// Bug audit (ver_250): a team pass over a Jira filter of old bugs before a bug bash.
// Jira is the source of truth. The list is the audit's filter, and every bug someone checks
// gets the audit's label in Jira, whatever they found (a bug that still happens stays open,
// it's just been checked), so it drops off the filter. Flaw Patrol only adds what Jira can't
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
 * A claim lasts this long without a sign of life, so a forgotten bug goes back quickly. The Audit page
 * renews it every few minutes while the bug is open (KEEP_MS), and taking another bug lets it go at once.
 */
export const CLAIM_MS = 15 * 60_000;
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
 * Checks Jira has undone (ver_253): bugs checked here that are back on the audit's filter, because
 * someone removed the label in Jira. Jira decides, so they count as unchecked again.
 */
export function reopenedChecks(checks: { issueKey: string; checkedAt: Date | null }[], onFilter: Set<string>, now: Date) {
  return checks.filter((c) => c.checkedAt && onFilter.has(c.issueKey) && now.getTime() - c.checkedAt.getTime() > LABEL_LAG_MS).map((c) => c.issueKey);
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

/** The comment the check leaves in Jira, so anyone reading the ticket sees what was found. */
export function auditComment(a: { label: string; outcome: Outcome; clients: string[]; build: string; note: string; by: string; changes: string[]; movedTo: string }) {
  const found = `${outcomeLabel(a.outcome)}${a.clients.length ? ` on ${a.clients.join(", ")}` : ""}${a.build ? `, build ${a.build}` : ""}.`;
  return [
    `Bug audit (${a.label}): ${found}`,
    a.note.trim() && `Note: ${a.note.trim()}`,
    a.changes.length > 0 && `Changed: ${a.changes.join("; ")}.`,
    a.movedTo && `Moved to ${a.movedTo}.`,
    `Checked by ${a.by} in Flaw Patrol.`,
  ]
    .filter(Boolean)
    .join("\n");
}

"use client";

import { NewsTag } from "./case-news-tag";
import { newsLine } from "@/lib/case-news";
import { useSpelling } from "@/components/spelling";
import type { Priority, ResultStatus } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { relativeTime } from "@/lib/format";
import { STATUSES, STATUS_LABEL, STATUS_STYLE } from "@/lib/status";
import { assignEntries, markRunCasesRunBefore } from "@/server/runs";
import { useLiveSteps } from "@/lib/live-steps";
import { useLiveRow, useLiveRows, type LiveRow } from "@/lib/live-rows";
import { PersonLabel } from "./avatar";
import type { CaseSort } from "@/lib/case-sort";
import { PriorityBadge, TypeBadge, FlakyBadge, RegressionBadge } from "./badges";
import { CaseSortToggle } from "./case-sort-toggle";
import { StatusChip } from "./status";
import { buttonClass, cx, Input, Select } from "./ui";
import { TagPills } from "./tag-pill";
import { CloseMatchesLabel } from "./close-matches";
import { forgivingFilter, matchCount, tagHits } from "@/lib/fuzzy";
import type { TagColors } from "@/lib/tags";

export type EntryRow = {
  id: string;
  caseKey: string;
  caseNumber: number;
  title: string;
  tags: string[];
  folderPath: string;
  priority: Priority;
  /** Charters run as exploratory sessions. */
  charter: boolean;
  status: ResultStatus;
  assigneeId: string | null;
  lastTestedAt: string | null;
  defects: number;
  /** New or Updated since the case's last run (ver_96), with why and a What was updated link. */
  news?: { kind: "new" | "updated"; why: string; href?: string };
  /** Added after the run started (ver_96), like "Added from the Risk board by Sam". */
  added?: string;
  /** Known bugs from earlier runs (ver_96). */
  known?: number;
  /** Flaky: how often its result flipped in its last 10 runs. */
  flaky?: number;
  /** Regression (ver_93): where it passed before, for the badge's hover. */
  regression?: string;
  /** Step results so far, for a case that's in progress. */
  progress: ResultStatus[] | null;
  /** Who made the last autosaved change to an in-progress case. */
  /** Who last changed it and when; `saved` marks a saved result rather than a case in progress. */
  lastChange: { name: string; at: string; mine: boolean; saved?: boolean } | null;
};

export function RunEntries({
  projectId,
  projectKey,
  runId,
  runNumber,
  rows: drawnRows,
  renderedAt,
  members,
  canManage,
  canRun,
  meId,
  sort,
  tagColors,
  canMarkRunBefore = false,
}: {
  projectId: string;
  projectKey: string;
  runId: string;
  runNumber: number;
  rows: EntryRow[];
  /** Server time the rows were read; live rows read later replace them (ver_112). */
  renderedAt: number;
  members: { id: string; name: string; avatarAt?: Date | null; frame?: string | null; title?: string | null }[];
  canManage: boolean;
  /** Can record results in this run (it's open and they're allowed): lets them run just the selected cases. */
  canRun: boolean;
  meId: string;
  sort: CaseSort;
  tagColors?: TagColors;
  /** Can say the run's new cases were run before Flaw Patrol (ver_107): needs case editing. */
  canMarkRunBefore?: boolean;
}) {
  const spelling = useSpelling();
  // Other people's progress from the live check, without waiting for the page to reload (ver_112).
  const live = useLiveRows(renderedAt);
  const rows = useMemo(
    () =>
      live
        ? drawnRows.map((r) => {
            const l = live.get(r.id);
            return l ? { ...r, status: l.status, assigneeId: l.assigneeId, progress: l.progress, lastChange: l.lastChange } : r;
          })
        : drawnRows,
    [live, drawnRows],
  );
  const [status, setStatus] = useState("");
  const [onlyReg, setOnlyReg] = useState(false);
  // All / New / Updated (ver_96).
  const [news, setNews] = useState<"" | "new" | "updated">("");
  const newCount = rows.filter((r) => r.news?.kind === "new").length;
  const updCount = rows.filter((r) => r.news?.kind === "updated").length;
  const regCount = rows.filter((r) => r.regression).length;
  const [who, setWho] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const router = useRouter();
  // Entries just marked as run before, kept for Undo (ver_107).
  const [marked, setMarked] = useState<string[] | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const allNew = newCount === rows.length && updCount === 0;
  const markRunBefore = (entryIds: string[], runBefore: boolean) =>
    start(async () => {
      setMarkError(null);
      const res = await markRunCasesRunBefore(projectId, runId, entryIds, runBefore);
      if (!res.ok) return setMarkError(res.error);
      setMarked(runBefore ? entryIds : null);
      setNews("");
      router.refresh();
    });
  const byId = new Map(members.map((m) => [m.id, m]));
  const canSelect = canManage || canRun;
  // Selected cases in the order they're listed, as case numbers for a short, shareable link.
  const only = rows.filter((r) => selected.has(r.id)).map((r) => r.caseNumber);

  // Forgiving search (ver_96): exact matches, then close ones under their own label.
  const found = forgivingFilter(
    rows.filter(
      (r) =>
        (!status || r.status === status) &&
        (!onlyReg || !!r.regression) &&
        (!news || r.news?.kind === news) &&
        (!who || (who === "none" ? !r.assigneeId : who === "me" ? r.assigneeId === meId : r.assigneeId === who)),
    ),
    query,
    (r) => `${r.caseKey} ${r.title} ${r.folderPath} ${r.tags.join(" ")}`,
  );
  const hasKnown = rows.some((r) => r.known);
  const shown = [...found.exact, ...found.close];
  const closeStart = found.close.length ? found.exact.length : -1;
  const shownIds = new Set(shown.map((r) => r.id));
  const hiddenPicks = [...selected].filter((id) => !shownIds.has(id)).length;

  const assign = (assigneeId: string | null) =>
    start(async () => {
      await assignEntries(projectId, runId, [...selected], assigneeId);
      setSelected(new Set());
      router.refresh();
    });

  return (
    <div>
      {marked && (
        <div className="mb-3 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-sm text-slate-800" data-testid="news-heads-up">
          Done. {marked.length === 1 ? "This case is" : `These ${marked.length} cases are`} marked as run before, so runs won&apos;t call {marked.length === 1 ? "it" : "them"} new again.{" "}
          <button type="button" disabled={pending} className="font-medium text-accent-700 underline" onClick={() => markRunBefore(marked, false)}>
            Undo
          </button>
        </div>
      )}
      {!marked && newCount + updCount > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-sm text-slate-800" data-testid="news-heads-up">
          <span className="min-w-0 flex-1">
            {allNew ? (
              <>
                <b>All {newCount} cases are new.</b> Nobody has run them yet, so read each one carefully.
              </>
            ) : (
              <>
                <b>{newsLine({ new: newCount, updated: updCount })}</b> since the last run of these cases. Read them carefully: {newCount ? "nobody has run the new ones yet" : "their steps changed"}.
              </>
            )}
          </span>
          {newCount > 0 && canMarkRunBefore && (
            <button
              type="button"
              disabled={pending}
              className="text-xs font-medium text-accent-700 underline"
              onClick={() => markRunBefore(rows.filter((r) => r.news?.kind === "new").map((r) => r.id), true)}
            >
              Not new? Mark {newCount === 1 ? "it" : "them"} as run before
            </button>
          )}
          {/* With every case new, All and New would show the same list (ver_107). */}
          {!allNew && (
            <span role="group" aria-label="Show cases" className="inline-flex overflow-hidden rounded-md border border-slate-300">
              {(
                [
                  ["", `All ${rows.length}`],
                  ["new", `New ${newCount}`],
                  ["updated", `Updated ${updCount}`],
                ] as const
              )
                .filter(([k]) => k === "" || (k === "new" ? newCount : updCount))
                .map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={news === k} onClick={() => setNews(k)} className={cx("px-2.5 py-1 text-xs font-medium", news === k ? "bg-accent-600 text-white" : "bg-surface text-slate-800 hover:bg-slate-100")}>
                    {label}
                  </button>
                ))}
            </span>
          )}
          {markError && <span className="basis-full text-xs text-red-700">{markError}</span>}
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          placeholder="Search cases"
          aria-label="Search cases in this run"
          className="h-8 w-48 text-xs"
        />
        <Select className="h-8 w-auto text-xs" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select className="h-8 w-auto text-xs" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filter by tester">
          <option value="">Everyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        {regCount > 0 && (
          <button
            type="button"
            aria-pressed={onlyReg}
            onClick={() => setOnlyReg((v) => !v)}
            title="Cases that passed last time on this platform and fail now"
            className={cx(
              "inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium ring-1 ring-inset",
              onlyReg ? "bg-pink-600 text-white ring-pink-600" : "bg-pink-50 text-pink-800 ring-pink-200 hover:bg-pink-100",
            )}
          >
            Regression {regCount}
          </button>
        )}
        <CaseSortToggle value={sort} orderLabel="Run order" statuses />
        <span className="text-xs text-slate-500">
          {query.trim() ? matchCount(found.exact.length, found.close.length) : `${shown.length} of ${rows.length}`}
          {hiddenPicks > 0 && ` · ${hiddenPicks} selected not shown`}
        </span>
        {selected.size > 0 && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {canRun && (
              <Link href={`/p/${projectKey}/runs/${runNumber}/execute?only=${only.join(",")}`} className={buttonClass("primary", "sm")}>
                Run {selected.size} selected
              </Link>
            )}
            {canManage && (
              <Select
                className="h-8 w-auto text-xs"
                value=""
                disabled={pending}
                aria-label="Assign selected"
                onChange={(e) => e.target.value && assign(e.target.value === "__none" ? null : e.target.value)}
              >
                <option value="">Assign {selected.size} selected to…</option>
                <option value="__none">Nobody</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            )}
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-slate-500 hover:underline">
              Clear
            </button>
          </span>
        )}
      </div>
      {/* On phones (ver_54 audit #13) each row turns into a card: the case on top, then priority, status and its button, so nothing is cut off at the edge. */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface shadow-sm">
        <table className="w-full text-sm max-sm:block">
          <thead className={cx("border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 max-sm:block", !canSelect && "max-sm:hidden")}>
            <tr className="max-sm:flex">
              {canSelect && (
                <th className="w-8 px-3 py-2 max-sm:w-auto">
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={shown.length > 0 && shown.every((r) => selected.has(r.id))}
                    onChange={(e) =>
                      // Adds or removes only the cases shown, so picks made under an earlier search stay picked.
                      setSelected((s) => {
                        const n = new Set(s);
                        for (const r of shown) {
                          if (e.target.checked) n.add(r.id);
                          else n.delete(r.id);
                        }
                        return n;
                      })
                    }
                  />
                  <span aria-hidden className="ml-2 font-medium sm:hidden">
                    Select all
                  </span>
                </th>
              )}
              <th className="px-3 py-2 font-medium max-sm:hidden">Case</th>
              <th className="w-20 px-3 py-2 font-medium max-sm:hidden">Priority</th>
              <th className="hidden w-36 px-3 py-2 font-medium md:table-cell">Assigned to</th>
              <th className="w-24 px-3 py-2 font-medium max-sm:hidden">Status</th>
              {hasKnown && <th className="hidden px-3 py-2 font-medium whitespace-nowrap lg:table-cell">Known bugs</th>}
              <th className="w-16 px-3 py-2 max-sm:hidden">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 max-sm:block">
            {shown.map((r, i) => (
              <Fragment key={r.id}>
              {i === closeStart && (
                <tr>
                  <td colSpan={8} className="px-0 py-1">
                    {closeStart === 0 && <p className="px-3 pb-1 text-xs text-slate-500">No exact matches.</p>}
                    <CloseMatchesLabel />
                  </td>
                </tr>
              )}
              <tr className="hover:bg-slate-50 max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-2 max-sm:gap-y-1.5 max-sm:px-3 max-sm:py-2.5">
                {canSelect && (
                  <td className="px-3 py-2 max-sm:order-3 max-sm:p-0">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.caseKey}`}
                      checked={selected.has(r.id)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(r.id);
                          else n.delete(r.id);
                          return n;
                        })
                      }
                    />
                  </td>
                )}
                <td className="px-3 py-2 max-sm:order-first max-sm:basis-full max-sm:p-0">
                  <Link href={`/p/${projectKey}/runs/${runNumber}/execute?entry=${r.id}`} className="hover:underline">
                    <span className="font-mono text-xs text-slate-500">{r.caseKey}</span> <TagPills tags={r.tags} colors={tagColors} hits={tagHits(query, r.tags)} /> <span className="font-medium text-slate-900">{r.title}</span>
                  </Link>
                  {r.regression ? <span className="ml-1.5 align-middle"><RegressionBadge tip={r.regression} /></span> : null}
                  {r.flaky ? <span className="ml-1.5 align-middle"><FlakyBadge flips={r.flaky} /></span> : null}
                  {r.news && <NewsTag kind={r.news.kind} title={r.news.why} className="ml-1.5" />}
                  {r.added && (
                    <span title={r.added} className="ml-1.5 inline-flex items-center rounded-full bg-violet-50 px-2 py-px align-middle text-[11px] font-semibold text-violet-800 ring-1 ring-violet-200 ring-inset">
                      Added
                    </span>
                  )}
                  <p className="text-xs text-slate-500">
                    {r.folderPath}
                    {r.defects > 0 && <span className="ml-2 text-red-600">{r.defects} {r.defects === 1 ? "bug" : "bugs"}</span>}
                    {r.news && (
                      <span className={cx("ml-2", r.news.kind === "new" ? "text-sky-800" : "text-amber-800")}>
                        {r.news.why}
                        {r.news.href && (
                          <>
                            {" · "}
                            <Link href={r.news.href} className="underline hover:no-underline">
                              What was updated
                            </Link>
                          </>
                        )}
                      </span>
                    )}
                  </p>
                </td>
                <td className="px-3 py-2 max-sm:order-1 max-sm:p-0">
                  <span className="inline-flex flex-wrap gap-1">
                    <PriorityBadge priority={r.priority} />
                    {r.charter && <TypeBadge type="EXPLORATORY" />}
                  </span>
                </td>
                <td className="hidden px-3 py-2 text-xs text-slate-600 md:table-cell">{r.assigneeId ? (
                    byId.has(r.assigneeId) ? (
                      <PersonLabel person={byId.get(r.assigneeId)!} />
                    ) : (
                      "Former member"
                    )
                  ) : (
                    <span className="text-slate-400">Unassigned</span>
                  )}</td>
                <td className="px-3 py-2 max-sm:order-2 max-sm:p-0">
                  <StatusChip status={r.status} />
                  {r.progress ? (
                    <StepProgress steps={r.progress} lastChange={r.lastChange} />
                  ) : (
                    r.lastTestedAt && <p className="mt-0.5 text-[11px] text-slate-400" suppressHydrationWarning>{relativeTime(new Date(r.lastTestedAt), spelling)}</p>
                  )}
                </td>
                {hasKnown && (
                  <td className="hidden px-3 py-2 lg:table-cell">
                    {r.known ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900" title={`${r.known} ${r.known === 1 ? "bug" : "bugs"} from earlier runs on this case`}>
                        {r.known}
                      </span>
                    ) : null}
                  </td>
                )}
                <td className="px-3 py-2 text-right max-sm:order-4 max-sm:ml-auto max-sm:p-0">
                  <Link
                    href={`/p/${projectKey}/runs/${runNumber}/execute?entry=${r.id}`}
                    className="text-xs font-medium text-accent-700 hover:underline max-sm:inline-block max-sm:rounded-md max-sm:bg-accent-600 max-sm:px-3 max-sm:py-1.5 max-sm:text-sm max-sm:text-white max-sm:hover:no-underline"
                  >
                    {r.status === "UNTESTED" ? "Test" : r.status === "IN_PROGRESS" ? "Continue" : "Retest"}
                  </Link>
                </td>
              </tr>
              </Fragment>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-500">
                  Nothing matches these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A pip per step (colored once it has a result), the count, and who's on it. Compact keeps it to one line. */
export function StepProgress({ steps, lastChange, compact = false }: { steps: ResultStatus[]; lastChange: EntryRow["lastChange"]; compact?: boolean }) {
  const spelling = useSpelling();
  const done = steps.filter((s) => s !== "UNTESTED").length;
  const recent = lastChange && !lastChange.saved && Date.now() - Date.parse(lastChange.at) < 2 * 60_000;
  const who = lastChange && (
    <span className={cx("flex items-center gap-1 text-[11px] text-slate-400", !compact && "mt-0.5")} suppressHydrationWarning>
      {recent && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
      {recent ? `${lastChange.mine ? "You're" : `${lastChange.name} is`} testing now` : `${lastChange.mine ? "You" : lastChange.name} · ${relativeTime(new Date(lastChange.at), spelling)}`}
    </span>
  );
  return (
    <div className="mt-1">
      <div className={cx("flex min-w-0 items-center gap-x-1.5", compact && "flex-wrap gap-y-0.5")}>
        {steps.length <= 24 && (
          <span className="flex shrink-0 gap-0.5">
            {steps.map((s, i) => (
              <span key={i} title={`Step ${i + 1}: ${STATUS_LABEL[s]}`} className={cx("st-pip h-1.5 w-2.5 rounded-sm", STATUS_STYLE[s].bar)} />
            ))}
          </span>
        )}
        <span className="shrink-0 text-[11px] text-slate-500">
          {done}/{steps.length}
        </span>
        {compact && who && <span className="text-[11px] text-slate-300">·</span>}
        {compact && who}
      </div>
      {!compact && who}
    </div>
  );
}

/**
 * The open case's row in the runner's run list: the runner's own step results as you mark
 * them, falling back to what the server last drew. Nothing until a step has a result.
 */
export function LiveStepProgress({ entryId, steps, lastChange }: { entryId: string; steps: ResultStatus[] | null; lastChange: EntryRow["lastChange"] }) {
  const live = useLiveSteps(entryId);
  const shown = live?.steps ?? steps;
  if (!shown?.some((s) => s !== "UNTESTED")) return null;
  return <StepProgress compact steps={shown} lastChange={live ? { name: "", at: live.at, mine: true } : lastChange} />;
}

const saved = (s: ResultStatus) => s !== "IN_PROGRESS" && s !== "UNTESTED";

/** A runner list row's status dot, kept current by the live check (ver_112). */
export function LiveStatusPip({ id, status, renderedAt }: { id: string; status: ResultStatus; renderedAt: number }) {
  const s = useLiveRow(id, renderedAt)?.status ?? status;
  return <span className={cx("st-pip mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", STATUS_STYLE[s].bar)} />;
}

/** A runner list row's status word, kept current by the live check (ver_112). */
export function LiveStatusLabel({ id, status, renderedAt }: { id: string; status: ResultStatus; renderedAt: number }) {
  const s = useLiveRow(id, renderedAt)?.status ?? status;
  return <span className="text-xs text-slate-500">{STATUS_LABEL[s]}</span>;
}

/**
 * A runner list row's step pips: a saved case keeps its last result's, a case in progress shows
 * its step results so far and who's on it, and the open case follows the runner as you mark steps.
 * Other people's changes come from the live check, so they show even while you're mid-case (ver_112).
 */
export function LiveEntryProgress({ row, current, renderedAt }: { row: LiveRow; current: boolean; renderedAt: number }) {
  const r = useLiveRow(row.id, renderedAt) ?? row;
  if (saved(r.status)) return r.progress ? <StepProgress compact steps={r.progress} lastChange={r.lastChange} /> : null;
  if (current) return <LiveStepProgress entryId={r.id} steps={r.progress} lastChange={r.lastChange} />;
  return r.status === "IN_PROGRESS" && r.progress ? <StepProgress compact steps={r.progress} lastChange={r.lastChange} /> : null;
}

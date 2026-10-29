"use client";

import { useSpelling } from "@/components/spelling";
import type { Priority, ResultStatus } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { relativeTime } from "@/lib/format";
import { STATUSES, STATUS_LABEL, STATUS_STYLE } from "@/lib/status";
import { assignEntries } from "@/server/runs";
import { useLiveSteps } from "@/lib/live-steps";
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
  rows,
  members,
  canManage,
  canRun,
  meId,
  sort,
  tagColors,
}: {
  projectId: string;
  projectKey: string;
  runId: string;
  runNumber: number;
  rows: EntryRow[];
  members: { id: string; name: string; avatarAt?: Date | null; frame?: string | null; title?: string | null }[];
  canManage: boolean;
  /** Can record results in this run (it's open and they're allowed): lets them run just the selected cases. */
  canRun: boolean;
  meId: string;
  sort: CaseSort;
  tagColors?: TagColors;
}) {
  const spelling = useSpelling();
  const [status, setStatus] = useState("");
  const [onlyReg, setOnlyReg] = useState(false);
  const regCount = rows.filter((r) => r.regression).length;
  const [who, setWho] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const router = useRouter();
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
        (!who || (who === "none" ? !r.assigneeId : who === "me" ? r.assigneeId === meId : r.assigneeId === who)),
    ),
    query,
    (r) => `${r.caseKey} ${r.title} ${r.folderPath} ${r.tags.join(" ")}`,
  );
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
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              {canSelect && (
                <th className="w-8 px-3 py-2">
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
                </th>
              )}
              <th className="px-3 py-2 font-medium">Case</th>
              <th className="w-20 px-3 py-2 font-medium">Priority</th>
              <th className="hidden w-36 px-3 py-2 font-medium md:table-cell">Assigned to</th>
              <th className="w-24 px-3 py-2 font-medium">Status</th>
              <th className="w-16 px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
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
              <tr className="hover:bg-slate-50">
                {canSelect && (
                  <td className="px-3 py-2">
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
                <td className="px-3 py-2">
                  <Link href={`/p/${projectKey}/runs/${runNumber}/execute?entry=${r.id}`} className="hover:underline">
                    <span className="font-mono text-xs text-slate-500">{r.caseKey}</span> <TagPills tags={r.tags} colors={tagColors} hits={tagHits(query, r.tags)} /> <span className="font-medium text-slate-900">{r.title}</span>
                  </Link>
                  {r.regression ? <span className="ml-1.5 align-middle"><RegressionBadge tip={r.regression} /></span> : null}
                  {r.flaky ? <span className="ml-1.5 align-middle"><FlakyBadge flips={r.flaky} /></span> : null}
                  <p className="text-xs text-slate-500">
                    {r.folderPath}
                    {r.defects > 0 && <span className="ml-2 text-red-600">{r.defects} {r.defects === 1 ? "bug" : "bugs"}</span>}
                  </p>
                </td>
                <td className="px-3 py-2">
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
                <td className="px-3 py-2">
                  <StatusChip status={r.status} />
                  {r.progress ? (
                    <StepProgress steps={r.progress} lastChange={r.lastChange} />
                  ) : (
                    r.lastTestedAt && <p className="mt-0.5 text-[11px] text-slate-400" suppressHydrationWarning>{relativeTime(new Date(r.lastTestedAt), spelling)}</p>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/p/${projectKey}/runs/${runNumber}/execute?entry=${r.id}`} className="text-xs font-medium text-accent-700 hover:underline">
                    {r.status === "UNTESTED" ? "Test" : r.status === "IN_PROGRESS" ? "Continue" : "Retest"}
                  </Link>
                </td>
              </tr>
              </Fragment>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
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

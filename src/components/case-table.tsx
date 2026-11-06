"use client";

import { useSpelling } from "@/components/spelling";
import type { CaseFlagInfo } from "@/lib/case-flag";
import type { CaseType, Priority, ResultStatus } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, useTransition } from "react";
import { announceTicked } from "./export-cases";
import { CloseMatchesLabel } from "./close-matches";
import { CASES_MIME, dragChip, type DraggedCases } from "@/lib/case-drag";
import { caseKey, count, relativeTime } from "@/lib/format";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/status";
import { moveCases, setCasesArchived } from "@/server/cases";
import { addCasesToSuite } from "@/server/suites";
import { NewRunButton, type Member } from "./new-run";
import type { RunField } from "@/lib/run-fields";
import { StartRunBox } from "./start-run-box";
import { FlakyBadge, PriorityBadge, TypeBadge } from "./badges";
import { TagPills } from "./tag-pill";
import type { TagColors } from "@/lib/tags";
import { BulkEditButton, type BulkPersona } from "./bulk-edit";
import { LinkStoryButton } from "./story-links";
import { FlagMark } from "./case-flag";
import { Button, cx, Select } from "./ui";

export type CaseRow = {
  id: string;
  number: number;
  title: string;
  priority: Priority;
  type: CaseType;
  tags: string[];
  version: number;
  usesShared: boolean;
  /** Rows of test data: the case runs once per row. */
  dataRows?: number;
  folder: string;
  /** The folder the case is in, for dragging it to another one. */
  folderId?: string | null;
  updatedAt: string;
  flag: CaseFlagInfo | null;
  /** Flaky: how often its result flipped in its last 10 runs. */
  flaky?: number;
  personaId?: string | null;
  /** In an umbrella's shared library: the platforms whose suites hold the case, and its last result on each. */
  platforms?: { name: string; color: string; status: ResultStatus | null }[];
  /** Jira stories it tests, by key. */
  stories?: string[];
  /** Automation runs it: its latest automated result, if any yet. */
  auto?: { status: ResultStatus | null; at: string | null };
};

export function CaseTable({
  projectId,
  projectKey,
  rows,
  folderOptions,
  canEdit,
  canArchive,
  archivedView,
  run: runOpts,
  platforms = false,
  bulk,
  storyLinks = false,
  tagColors,
  tagHits,
  closeStart,
  canExport,
}: {
  projectId: string;
  projectKey: string;
  rows: CaseRow[];
  folderOptions: { id: string; label: string; depth: number }[];
  canEdit: boolean;
  canArchive: boolean;
  archivedView: boolean;
  /** `groupId`: in an umbrella's Case library, runs start in its test cycles, picked in the Create a run box. */
  run?: { canCreate: boolean; canManageSuites: boolean; members: Member[]; suites: { id: string; name: string }[]; meId?: string; groupId?: string; fields?: RunField[] };
  /** Show the Platforms column (an umbrella's shared library). */
  platforms?: boolean;
  /** For Edit fields… on ticked cases. */
  bulk?: { personas: BulkPersona[]; tags: string[] };
  /** Jira is connected: offer Link to story… on ticked cases. */
  storyLinks?: boolean;
  /** Tag pill colors; tags a search matched get an outline. */
  tagColors?: TagColors;
  tagHits?: string[];
  /** Rows from here on are close matches for the search, under their own label. */
  closeStart?: number;
  /** Ticked cases can be exported (Viewers too), so the boxes show for anyone who can export. */
  canExport?: boolean;
}) {
  const spelling = useSpelling();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const selectable = canEdit || canArchive || !!runOpts?.canCreate || !!canExport;
  const ids = [...selected];
  // Export cases offers "The N you ticked" while any are ticked.
  useEffect(() => {
    announceTicked([...selected]);
  }, [selected]);
  useEffect(() => () => announceTicked([]), []);
  const canDrag = canEdit && !archivedView;

  const run = (fn: () => Promise<{ ok: true; count: number } | { ok: false; error: string }>, done: (n: number) => string) =>
    start(async () => {
      const res = await fn();
      setMessage(res.ok ? done(res.count) : res.error);
      if (res.ok) setSelected(new Set());
      router.refresh();
    });

  return (
    <div>
      {selectable && selected.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-accent-100 bg-accent-50 px-3 py-2 text-sm">
          <span className="font-medium text-accent-700">{selected.size} selected</span>
          {canDrag && <span className="hidden text-xs text-slate-500 lg:inline">or drag them onto a folder</span>}
          {canEdit && !archivedView && (
            <Select
              aria-label="Move to folder"
              data-howto="cases-move"
              className="h-7 w-auto text-xs"
              value=""
              disabled={pending}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                run(() => moveCases(projectId, ids, v === "__none" ? null : v), (n) => `Moved ${count(n, "case")}.`);
              }}
            >
              <option value="">Move to folder…</option>
              <option value="__none">(No folder)</option>
              {folderOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {"  ".repeat(f.depth) + f.label.split(" / ").pop()}
                </option>
              ))}
            </Select>
          )}
          {canEdit && !archivedView && bulk && (
            <BulkEditButton
              projectId={projectId}
              cases={rows.filter((r) => selected.has(r.id))}
              personas={bulk.personas}
              knownTags={bulk.tags}
              disabled={pending}
              onDone={(m) => {
                setMessage(m);
                setSelected(new Set());
                router.refresh();
              }}
            />
          )}
          {canEdit && !archivedView && storyLinks && (
            <LinkStoryButton
              projectId={projectId}
              cases={rows.filter((r) => selected.has(r.id))}
              disabled={pending}
              onDone={(m) => {
                setMessage(m);
                setSelected(new Set());
                router.refresh();
              }}
            />
          )}
          {runOpts?.canManageSuites && !archivedView && runOpts.suites.length > 0 && (
            <Select
              aria-label="Add to suite"
              className="h-7 w-auto text-xs"
              value=""
              disabled={pending}
              onChange={(e) => {
                const suiteId = e.target.value;
                if (!suiteId) return;
                start(async () => {
                  const res = await addCasesToSuite(projectId, suiteId, ids);
                  setMessage(res.ok ? `Added ${count(res.added, "case")} to the suite.` : res.error);
                  router.refresh();
                });
              }}
            >
              <option value="">Add to suite…</option>
              {runOpts.suites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
          {runOpts?.canCreate && !archivedView && (
            <span className="[&_button]:h-7 [&_button]:px-2.5 [&_button]:text-xs">
              {runOpts.groupId ? (
                <StartRunBox scope={{ groupId: runOpts.groupId }} preset={{ what: "cases", caseIds: ids }} label={`Run ${selected.size} selected…`} variant="secondary" />
              ) : (
              <NewRunButton
                meId={runOpts.meId}
                projectId={projectId}
                projectKey={projectKey}
                source={{ kind: "cases", caseIds: ids }}
                defaultName={`Ad hoc run ${new Date().toISOString().slice(0, 10)}`}
                members={runOpts.members}
                label={`Run ${selected.size} selected`}
                variant="secondary"
                fields={runOpts.fields}
              />
              )}
            </span>
          )}
          {canArchive && (
            <Button
              size="sm"
              variant={archivedView ? "secondary" : "danger"}
              disabled={pending}
              onClick={() =>
                run(
                  () => setCasesArchived(projectId, ids, !archivedView),
                  (n) => (archivedView ? `Restored ${count(n, "case")}.` : `Archived ${count(n, "case")}. Find them on the Archived tab.`),
                )
              }
            >
              {archivedView ? "Restore" : "Archive"}
            </Button>
          )}
          <button className="ml-auto text-xs text-slate-500 hover:underline" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}
      {message && <p className="mb-2 text-sm text-slate-600">{message}</p>}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              {selectable && (
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={selected.size === rows.length && rows.length > 0}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </th>
              )}
              <th className="w-24 px-3 py-2 font-medium">ID</th>
              <th className="px-3 py-2 font-medium">Title</th>
              {platforms && <th className="hidden px-3 py-2 font-medium md:table-cell">Last result by platform</th>}
              <th className="w-24 px-3 py-2 font-medium">Priority</th>
              <th className="hidden w-24 px-3 py-2 font-medium md:table-cell">Type</th>
              <th className="hidden w-28 px-3 py-2 font-medium lg:table-cell">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, rowIndex) => (
              <Fragment key={r.id}>
              {rowIndex === closeStart && (
                <tr>
                  <td colSpan={20} className="bg-amber-50/40 px-0 py-1">
                    {closeStart === 0 && <p className="px-3 pb-1 text-xs text-slate-500">No exact matches.</p>}
                    <CloseMatchesLabel />
                  </td>
                </tr>
              )}
              <tr
                key={r.id}
                className={cx("hover:bg-slate-50", canDrag && "cursor-grab active:cursor-grabbing")}
                draggable={canDrag}
                onDragStart={(e) => {
                  // Dragging a ticked case takes all the ticked ones with it.
                  const moving = selected.has(r.id) ? rows.filter((x) => selected.has(x.id)) : [r];
                  const data: DraggedCases = moving.map((x) => ({ id: x.id, folderId: x.folderId ?? null }));
                  e.dataTransfer.setData(CASES_MIME, JSON.stringify(data));
                  e.dataTransfer.effectAllowed = "move";
                  dragChip(e, `Move ${moving.length} ${moving.length === 1 ? "case" : "cases"}`);
                }}
              >
                {selectable && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      data-howto="case-tick"
                      aria-label={`Select ${caseKey(projectKey, r.number)}`}
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
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-slate-500">{caseKey(projectKey, r.number)}</td>
                <td className="px-3 py-2">
                  <span className="flex items-start gap-1.5">
                    {r.tags.length > 0 && (
                      <span className="flex flex-none gap-1 pt-0.5">
                        <TagPills tags={r.tags} colors={tagColors} hits={tagHits} />
                      </span>
                    )}
                    <Link href={`/p/${projectKey}/cases/${r.number}`} draggable={false} className="font-medium text-slate-900 hover:text-accent-700 hover:underline" data-howto="case-row">
                      {r.title}
                    </Link>
                    {r.dataRows ? (
                      <span
                        className="flex-none rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200 ring-inset"
                        title={`Runs once for each of ${r.dataRows} rows of test data.`}
                        data-testid="data-rows-tag"
                      >
                        {r.dataRows} {r.dataRows === 1 ? "row" : "rows"}
                      </span>
                    ) : null}
                    {r.flaky ? <FlakyBadge flips={r.flaky} /> : null}
                    {r.flag && <FlagMark flag={r.flag} />}
                  </span>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    {r.folder && <span>{r.folder}</span>}
                    {r.usesShared && <span title="Uses shared steps">⧉ shared steps</span>}
                    {r.auto && (
                      <span className="text-teal-700" data-testid="auto-line">
                        🤖 Automated{r.auto.status ? ` · ${STATUS_LABEL[r.auto.status]} ${relativeTime(new Date(r.auto.at!), spelling)}` : " · not run yet"}
                      </span>
                    )}
                    {r.stories?.map((k) => (
                      <span key={k} className="rounded bg-sky-50 px-1 font-mono text-[11px] text-sky-800" title="Jira requirement this case tests">
                        {k}
                      </span>
                    ))}
                  </div>
                </td>
                {platforms && (
                  <td className="hidden px-3 py-2 md:table-cell">
                    <span className="flex flex-wrap gap-x-2.5 gap-y-1 text-xs whitespace-nowrap text-slate-600">
                      {r.platforms?.map((p) => (
                        <span key={p.name} className="inline-flex items-center gap-1" title={`${p.name}: ${p.status ? STATUS_LABEL[p.status] : "not run yet"}`}>
                          <span aria-hidden className="size-2 rounded-sm" style={{ background: p.status ? STATUS_STYLE[p.status].fill : "var(--st-untested)" }} />
                          {p.name}
                        </span>
                      ))}
                      {!r.platforms?.length && (
                        <span className="text-slate-400" title="Not in any platform's suites yet" aria-label="Not in any platform's suites yet">
                          –
                        </span>
                      )}
                    </span>
                  </td>
                )}
                <td className="px-3 py-2">
                  <PriorityBadge priority={r.priority} />
                </td>
                <td className="hidden px-3 py-2 md:table-cell">
                  <TypeBadge type={r.type} />
                </td>
                <td className="hidden px-3 py-2 text-xs whitespace-nowrap text-slate-500 lg:table-cell" title={`Version ${r.version}`}>
                  {relativeTime(new Date(r.updatedAt), spelling)} · v{r.version}
                </td>
              </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

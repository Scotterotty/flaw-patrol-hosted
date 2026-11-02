import Link from "next/link";
import type { ReactNode } from "react";
import { AutoFilterForm } from "@/components/auto-filter-form";
import { CustomReportPart } from "@/components/custom-report-part";
import { CustomReportEditor, CustomReportToolbar, NewReportButton, type EditorItem } from "@/components/custom-report-editor";
import { RunKindFilter } from "@/components/report-views";
import { EmptyState, Input, Select, cx } from "@/components/ui";
import { filtersOf, loader, queryObject, reportQuery, type CustomScope } from "@/lib/custom-report-data";
import type { ReportRow } from "@/lib/custom-report-scope";
import { layoutRows, partOf, partsFor, PART_TABS, tabLabel } from "@/lib/report-parts";
import type { Platform } from "@/lib/umbrella";

// Reports → Custom reports (ver_101): the list, and one report to read or edit.

/** The list of reports, newest change first, with a card to start a new one. */
export function CustomReportsList({ cs, reports, canCreate }: { cs: CustomScope; reports: ReportRow[]; canCreate: boolean }) {
  const base = `${cs.reportsBase}/custom`;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Put together the parts you need from any Reports tab, in your order, with your own notes. Use <b>+ Add to report</b> on any box in <Link href={cs.reportsBase} className="text-accent-700 hover:underline">Run reports</Link>, or start one here.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => {
          const parts = r.items.filter((i) => i.k === "part");
          const tabs = [...new Set(parts.map((p) => tabLabel(partOf(p.part).tab)))];
          return (
            <Link key={r.id} href={`${base}/${r.id}`} className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-surface p-4 shadow-sm hover:border-accent-400" data-testid="custom-report-card">
              <span className="font-semibold text-slate-900">{r.name}</span>
              <span className="text-xs text-slate-500">
                {parts.length} {parts.length === 1 ? "part" : "parts"} · {r.shared ? "Shared" : "Only you"} · made by {r.createdByName}
              </span>
              {tabs.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {tabs.map((t) => (
                    <span key={t} className="rounded border border-slate-200 px-1.5 text-[11px] text-slate-500">
                      {t}
                    </span>
                  ))}
                </span>
              )}
            </Link>
          );
        })}
        {canCreate && <NewReportButton projectId={cs.homeId} base={base} />}
      </div>
      {reports.length === 0 && !canCreate && <EmptyState title="No custom reports yet">Nobody has shared a custom report here yet.</EmptyState>}
    </div>
  );
}

/** Release, platform, dates and run kind for the whole report. Changing them only changes this view until you edit the report. */
function Filters({ cs, q, releases, platforms, edit, savedQuery }: { cs: CustomScope; q: Record<string, string | undefined>; releases: string[]; platforms: string[]; edit: boolean; savedQuery: string }) {
  const f = filtersOf(cs, q);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const link = (extra: Record<string, string | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...q, ...extra, f: "1", ...(edit ? { edit: "1" } : {}) })) if (v) s.set(k, v);
    return `?${s.toString()}`;
  };
  const changed = new URLSearchParams(q as Record<string, string>).toString() !== savedQuery;
  return (
    <AutoFilterForm className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="f" value="1" />
      {edit && <input type="hidden" name="edit" value="1" />}
      <Select name="release" defaultValue={f.release ?? ""} className="w-auto" aria-label="Release">
        <option value="">Any release</option>
        {releases.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </Select>
      {cs.umbrella && platforms.length > 0 && (
        <Select name="platform" defaultValue={q.platform ?? ""} className="w-auto" aria-label="Platform">
          <option value="">All platforms</option>
          {platforms.map((p) => (
            <option key={p} value={p.toLowerCase()}>
              {p}
            </option>
          ))}
        </Select>
      )}
      {!f.release && (
        <>
          <label className="text-xs text-slate-600">
            From
            <Input type="date" name="from" defaultValue={f.allTime ? "" : day(f.from)} className="mt-0.5 w-40" />
          </label>
          <label className="text-xs text-slate-600">
            To
            <Input type="date" name="to" defaultValue={day(f.to)} className="mt-0.5 w-40" />
          </label>
          {!f.allTime && (
            <Link href={link({ range: "all", from: undefined, to: undefined })} className="pb-2 text-sm text-accent-700 hover:underline">
              All time
            </Link>
          )}
          {f.allTime && <input type="hidden" name="range" value="all" />}
        </>
      )}
      <RunKindFilter current={f.kind} href={(k) => link({ runs: k })} />
      <span className="pb-2 text-xs text-slate-500">{edit ? "These filters apply to every part, and are saved with the report." : "Change these to see the same report for another release or dates."}</span>
      {!edit && changed && (
        <Link href="?" className="pb-2 text-sm text-slate-500 hover:underline">
          Back to the report&apos;s filters
        </Link>
      )}
    </AutoFilterForm>
  );
}

function Note({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-slate-800" data-note="">
      {text}
    </div>
  );
}

/** One custom report: read it, or edit it with ?edit=1. */
export async function CustomReportView({
  cs,
  report,
  sp,
  releases,
  platformList = [],
  platforms = [],
  preparedBy,
}: {
  cs: CustomScope;
  report: ReportRow;
  sp: Record<string, string | undefined>;
  releases: string[];
  /** Umbrella platforms, for the Platform filter and colors. */
  platformList?: Platform[];
  platforms?: string[];
  preparedBy: string;
}) {
  const edit = sp.edit === "1" && report.canEdit;
  const query = reportQuery(report.query, sp);
  const q = queryObject(query);
  const load = loader(cs);
  const items = report.items;
  const base = `${cs.reportsBase}/custom`;
  const parts = new Map<string, ReactNode>();
  await Promise.all(
    items.map(async (it) => {
      if (it.k === "part") parts.set(it.id, await CustomReportPart({ cs, load, item: it, query: q, platforms: platformList }));
    }),
  );
  const filters = <Filters cs={cs} q={q} releases={releases} platforms={platforms} edit={edit} savedQuery={report.query} />;

  if (edit) {
    const editorItems: EditorItem[] = items.map((it) => (it.k === "note" ? it : { ...it, title: partOf(it.part).title, from: tabLabel(partOf(it.part).tab) }));
    return (
      <CustomReportEditor
        projectId={cs.homeId}
        report={{ id: report.id, name: report.name, shared: report.shared, mine: report.canDelete, query: report.query }}
        query={query}
        items={editorItems}
        previews={Object.fromEntries(parts)}
        catalog={PART_TABS.map((t) => ({ tab: t.label, parts: partsFor(cs.umbrella).filter((p) => p.tab === t.id).map((p) => ({ id: p.id, title: p.title })) })).filter((g) => g.parts.length)}
        releases={releases}
        viewHref={`${base}/${report.id}`}
        filters={filters}
      />
    );
  }

  const exportQs = new URLSearchParams({ ...(q as Record<string, string>), f: "1" }).toString();
  return (
    <div className="space-y-4">
      <CustomReportToolbar
        projectId={cs.homeId}
        report={{ id: report.id, name: report.name, shared: report.shared, canEdit: report.canEdit, canDelete: report.canDelete, mine: report.canDelete }}
        listHref={base}
        editHref={`?${new URLSearchParams({ ...(sp.f ? { ...(q as Record<string, string>), f: "1" } : {}), edit: "1" }).toString()}`}
        exportUrl={`${base}/${report.id}/export?${exportQs}`}
        preparedBy={preparedBy}
        scopeLine={cs.title}
      />
      {filters}
      {report.removedPeople && (
        <p className="text-xs text-slate-500" data-testid="people-part-removed" data-export-skip="">
          The People part was removed from Flaw Patrol, so this report no longer shows it.
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState title="This report is empty">{report.canEdit ? "Click Edit report to add parts." : "Whoever made it hasn't added any parts yet."}</EmptyState>
      ) : (
        <div id="custom-report-body" className="space-y-5" data-report-name={report.name}>
          {layoutRows(items).map((row) => (
            <div key={row[0].id} className={cx(row.length === 2 && "grid gap-5 lg:grid-cols-2")} data-row="">
              {row.map((it) => (
                <section key={it.id} data-part={it.k === "part" ? it.part : "note"} className="min-w-0">
                  {it.k === "note" ? <Note text={it.text} /> : parts.get(it.id)}
                </section>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

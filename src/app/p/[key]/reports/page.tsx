import { AddPartsHere } from "@/components/add-part-bar";
import { ScrollTabs } from "@/components/scroll-tabs";
import { AttachWrapUps, WrapUpsSection } from "@/components/wrap-ups";
import { attachedWrapUps, releaseStart, reportsWrapKey, wrapPickOf } from "@/lib/wrap-ups";
import { KindSelect } from "@/components/kind-select";
import { parseRunKinds } from "@/lib/run-kinds";
import { umbrellaOf } from "@/lib/umbrella";
import { dateRange } from "@/lib/spelling";
import { severityScaleFor } from "@/lib/severity-server";
import { mySpelling } from "@/lib/session";
import { AutoFilterForm } from "@/components/auto-filter-form";
import Link from "next/link";
import { cx, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { projectAccess } from "@/lib/session";
import { countStatuses, STATUSES, type StatusCounts } from "@/lib/status";
import { caseHealth, defectReport, parseFilters, stepHistory, releaseOptions, runReport, suiteReport, testerReport, trendOptions, trends } from "@/lib/reports";
import { SavedViews } from "@/components/saved-views";
import { PRIORITY_LABEL } from "@/lib/format";
import { can } from "@/lib/permissions";
import { cleanReportQuery } from "@/lib/report-query";
import { findingOptions, parseFindingFilters, sessionFindings } from "@/lib/findings";
import { ViewTabs } from "@/components/view-tabs";
import { CasesView, DefectsView, FailingView, RunKindFilter, FindingsView, StatusView, StepsView, TestersView, TrendsView } from "@/components/report-views";
import { libraryProjectIds } from "@/lib/umbrella";
import { ExportMenu } from "@/components/export-menu";
import { exportTabs } from "@/lib/export-tabs";
import { regressionReport, regressionScope } from "@/lib/regression-data";
import { RegressionView } from "@/components/regression-report";

import { summaryFor } from "@/lib/report-summary-data";
import { ReportSummaryBar } from "@/components/report-summary";

export const metadata = { title: "Reports" };

const VIEWS = [
  { id: "status", label: "Execution status" },
  { id: "trends", label: "Trends" },
  { id: "steps", label: "Step results" },
  { id: "failing", label: "Failing steps" },
  { id: "regression", label: "Regression" },
  { id: "defects", label: "Bugs found" },
  { id: "cases", label: "Case history" },
  { id: "testers", label: "People" },
  { id: "findings", label: "Session findings" },
] as const;
type View = (typeof VIEWS)[number]["id"];

const sum = (list: StatusCounts[]) => countStatuses(list.flatMap((c) => STATUSES.flatMap((s) => Array(c[s]).fill(s))));
const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { key } = await params;
  const sp = await searchParams;
  const { project, user, who } = await projectAccess(key);
  const view: View = (VIEWS.find((v) => v.id === sp.view)?.id ?? "status") as View;
  // Run kinds come from the umbrella (ver_95); a test cycle outside one has none.
  const kindGroup = await umbrellaOf(project);
  const f = parseFilters(sp);
  const library = await libraryProjectIds(project);
  const [runs, suites, releases, saved, options] = await Promise.all([
    runReport(project.id, f),
    db.testSuite.findMany({ where: { projectId: { in: library } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    releaseOptions(project.id),
    db.savedReport.findMany({ where: { projectId: project.id, OR: [{ shared: true }, { createdById: user.id }] }, orderBy: { name: "asc" } }),
    view === "trends" ? trendOptions(project.id) : null,
  ]);
  const findingOpts = view === "findings" ? await findingOptions(project.id) : null;
  const qs = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) u.set(k, v);
    return u.toString();
  };
  const stepCounts = sum(runs.map((r) => r.steps));
  const scope = f.runNumber ? `Run R${f.runNumber}` : f.release ? `Release ${f.release}` : f.allTime ? "All time" : dateRange(f.from, f.to, await mySpelling());

  // Attach wrap-ups (ver_96): bug bashes and exploring carried on this report, outside its pass rates.
  const wrapKey = reportsWrapKey(`/p/${project.key}/reports`);
  const wrapPick = wrapPickOf(user.rcReport, wrapKey);
  const wrapUps = await attachedWrapUps([project.id], wrapPick, wrapPick.auto ? (f.release ? await releaseStart([project.id], f.release) : f.from) : null);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Reports"
        subtitle={scope}
        actions={
          <ExportMenu
            exportUrl={`/p/${project.key}/reports/export?${qs({ view: undefined })}`}
            view={view}
            viewLabel={VIEWS.find((v) => v.id === view)!.label}
            image={view === "status" || view === "trends" || view === "steps"}
            fileBase={project.key}
            tabs={exportTabs(true)}
            scopeLine={`${project.name} · ${scope}`}
            preparedBy={user.name ?? user.email}
          />
        }
      />

      <ViewTabs
        label="Reports"
        tabs={[
          { label: "Run reports", href: `/p/${project.key}/reports`, current: true },
          { label: "Release status", href: `/p/${project.key}/reports/rc${f.release ? `?release=${encodeURIComponent(f.release)}` : ""}`, current: false },
          { label: "Requirements", href: `/p/${project.key}/reports/stories`, current: false },
          { label: "Bug bashes", href: `/p/${project.key}/bashes`, current: false },
          { label: "Custom reports", href: `/p/${project.key}/reports/custom`, current: false },
        ]}
      />

      <SavedViews
        projectId={project.id}
        current={cleanReportQuery({ ...sp, view })}
        views={saved.map((v) => ({
          id: v.id,
          name: v.name,
          query: v.query,
          shared: v.shared,
          createdByName: v.createdByName,
          canDelete: v.createdById === user.id || (v.shared && can(who, "run:manage")),
        }))}
      />
      <div className="mb-3 flex justify-end">
        <AttachWrapUps scope={{ projectKey: project.key }} prefKey={wrapKey} pick={wrapPick} count={wrapUps.length} release={f.release ?? undefined} />
      </div>

      <AutoFilterForm className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value={view} />
        <label className="text-xs text-slate-600">
          From
          <Input type="date" name="from" defaultValue={f.allTime ? "" : day(f.from)} className="mt-0.5 w-40" />
        </label>
        <label className="text-xs text-slate-600">
          To
          <Input type="date" name="to" defaultValue={day(f.to)} className="mt-0.5 w-40" />
        </label>
        {/* No suites yet (ver_118): no filter with only All suites. */}
        {suites.length > 0 && (
          <Select name="suite" defaultValue={f.suiteId ?? ""} className="w-auto" aria-label="Suite">
            <option value="">All suites</option>
            {suites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
        <Select name="release" defaultValue={f.release ?? ""} className="w-auto" aria-label="Release">
          <option value="">Any release</option>
          {releases.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <Input name="run" defaultValue={sp.run ?? ""} placeholder="Run # (optional)" className="w-36" aria-label="Run number" />
        {options && (
          <>
            <Select name="priority" defaultValue={f.priority ?? ""} className="w-auto" aria-label="Priority">
              <option value="">Any priority</option>
              {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
            <Select name="tester" defaultValue={f.tester ?? ""} className="w-auto" aria-label="Tester">
              <option value="">Any tester</option>
              {options.testers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            {options.folders.length > 0 && (
              <Select name="folder" defaultValue={f.folder ?? ""} className="w-auto max-w-56" aria-label="Folder">
                <option value="">Any folder</option>
                {options.folders.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </Select>
            )}
            {options.tags.length > 0 && (
              <Select name="tag" defaultValue={f.tag ?? ""} className="w-auto" aria-label="Tag">
                <option value="">Any tag</option>
                {options.tags.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </Select>
            )}
          </>
        )}
        {findingOpts && (
          <>
            <Select name="persona" defaultValue={sp.persona ?? ""} className="w-auto" aria-label="Persona">
              <option value="">Any persona</option>
              {findingOpts.personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.name}
                </option>
              ))}
            </Select>
            <Select name="charter" defaultValue={sp.charter ?? ""} className="w-auto max-w-64" aria-label="Charter">
              <option value="">Any charter</option>
              {findingOpts.charters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
            <input type="hidden" name="kinds" value={sp.kinds ?? ""} />
            <input type="hidden" name="open" value={sp.open ?? ""} />
          </>
        )}
        {!f.allTime && (
          <Link href={`?${qs({ range: "all", from: undefined, to: undefined, run: undefined })}`} className="pb-2 text-sm text-accent-700 hover:underline">
            All time
          </Link>
        )}
        <RunKindFilter current={f.kind} href={(k) => `?${qs({ runs: k })}`} />
        {kindGroup && <KindSelect kinds={parseRunKinds(kindGroup.group.runKinds)} value={sp.kind} />}
        {(sp.suite || sp.release || sp.run || sp.from || sp.to || sp.range || sp.priority || sp.tester || sp.folder || sp.tag || sp.persona || sp.charter || sp.kinds || sp.open || sp.runs || sp.kind) && (
          <Link href={`?view=${view}`} className="pb-2 text-sm text-slate-500 hover:underline">
            Reset
          </Link>
        )}
      </AutoFilterForm>

      {/* The one-line answer (ver_124, persona audit #10), following the dates and filters. */}
      {view !== "regression" && runs.length > 0 && <ReportSummaryBar summary={await summaryFor(project.id, f, runs, scope)} />}

      <ScrollTabs label="Report views" className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            href={`?${qs(v.id === "trends" ? { view: v.id } : { view: v.id, priority: undefined, tester: undefined, folder: undefined, tag: undefined })}`}
            className={cx("-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap", view === v.id ? "border-accent-600 font-medium text-accent-700" : "border-transparent text-slate-600 hover:text-slate-900")}
          >
            {v.label}
          </Link>
        ))}
      </ScrollTabs>

      <AddPartsHere homeId={project.id} user={user} who={who} base={`/p/${project.key}/reports/custom`}>
      <div id="report-body">
      {view === "regression" ? (
        <RegressionView
          data={await regressionReport(await regressionScope(project), { rc: sp.rc, vs: sp.vs, platform: project.platform || undefined })}
          show={sp.show === "still" || sp.show === "fixed" ? sp.show : "all"}
          hidden={{ view }}
          qs={qs}
        />
      ) : runs.length === 0 ? (
        <EmptyState title="No test runs in this range">Widen the dates or clear the filters.</EmptyState>
      ) : view === "trends" ? (
        <TrendsView data={await trends(project.id, f)} />
      ) : view === "status" ? (
        <StatusView suiteKey={project.key} runs={runs} kind={f.kind} suites={await suiteReport(library, runs)} />
      ) : view === "steps" ? (
        <StepsView runs={runs} stepCounts={stepCounts} failing={(await stepHistory(project.id, f)).slice(0, 5)} moreHref={`?${qs({ view: "failing" })}`} />
      ) : view === "failing" ? (
        <FailingView rows={await stepHistory(project.id, f)} allTimeHref={f.allTime ? null : `?${qs({ range: "all", from: undefined, to: undefined, run: undefined })}`} />
      ) : view === "defects" ? (
        <DefectsView rows={await defectReport(project.id, f)} scale={await severityScaleFor(project.id)} />
      ) : view === "cases" ? (
        <CasesView rows={await caseHealth(project.id, f)} />
      ) : view === "findings" ? (
        <FindingsView
          projectId={project.id}
          projectKey={project.key}
          data={await sessionFindings(project.id, f, parseFindingFilters(sp))}
          kinds={parseFindingFilters(sp).kinds}
          openOnly={sp.open === "1"}
          qs={qs}
          canAnswer={can(who, "run:execute")}
          canWrite={can(who, "case:edit")}
        />
      ) : (
        <TestersView rows={await testerReport(project.id, f)} />
      )}
      <WrapUpsSection items={wrapUps} />
      </div>
      </AddPartsHere>
    </div>
  );
}

import { AddPartsHere } from "@/components/add-part-bar";
import { AttachWrapUps, WrapUpsSection } from "@/components/wrap-ups";
import { attachedWrapUps, releaseStart, reportsWrapKey, wrapPickOf } from "@/lib/wrap-ups";
import { KindSelect } from "@/components/kind-select";
import { parseRunKinds } from "@/lib/run-kinds";
import { dateRange } from "@/lib/spelling";
import { severityScaleFor } from "@/lib/severity-server";
import { mySpelling } from "@/lib/session";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AutoFilterForm } from "@/components/auto-filter-form";
import { CasesView, DefectsView, FailingView, RunKindFilter, StatusView, StepsView, TestersView, TrendsView } from "@/components/report-views";
import { cx, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { ViewTabs } from "@/components/view-tabs";
import { reportsHome, reportTabs } from "@/lib/tools";
import { caseHealth, defectReport, parseFilters, releaseOptions, runReport, stepHistory, suiteReport, testerReport, trends, type RunRow } from "@/lib/reports";
import { requireUser } from "@/lib/session";
import { countStatuses, STATUSES, type StatusCounts } from "@/lib/status";
import { loadUmbrella, platformColor } from "@/lib/umbrella";
import { ExportMenu } from "@/components/export-menu";
import { SavedViews } from "@/components/saved-views";
import { exportTabs } from "@/lib/export-tabs";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { cleanReportQuery } from "@/lib/report-query";
import { regressionReport } from "@/lib/regression-data";
import { RegressionView } from "@/components/regression-report";
import { ByCycle } from "@/components/by-cycle";

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
] as const;
type View = (typeof VIEWS)[number]["id"];

const sum = (list: StatusCounts[]) => countStatuses(list.flatMap((c) => STATUSES.flatMap((s) => Array(c[s]).fill(s))));
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The umbrella's reports: the same views as a test cycle's Reports, across every
 * test cycle in it, narrowed by release and platform.
 */
export default async function UmbrellaReportsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const u = await loadUmbrella(id, user);
  if (!u) notFound();
  // Without Test runs (ver_128) there are no run reports: Reports opens on its first tab that's left.
  if (!u.tools.includes("runs")) redirect(reportsHome({ g: u.group.id, tools: u.tools }));
  const view: View = (VIEWS.find((v) => v.id === sp.view)?.id ?? "status") as View;
  // Run numbers repeat between test cycles, so there is no run filter here.
  const f = parseFilters({ ...sp, run: undefined });
  const platform = sp.platform?.toLowerCase() || "";
  const all = [u.hub.id, ...u.projects.map((p) => p.id)];
  const scope = platform ? u.projects.filter((p) => p.platform.toLowerCase() === platform).map((p) => p.id) : all;
  const platforms = [...new Set([...u.platforms.map((p) => p.name), ...u.projects.map((p) => p.platform).filter(Boolean)].map((n) => n))];
  const [runs, releases, saved] = await Promise.all([
    scope.length ? runReport(scope, f) : Promise.resolve([] as RunRow[]),
    releaseOptions(all),
    db.savedReport.findMany({ where: { projectId: u.hub.id, OR: [{ shared: true }, { createdById: user.id }] }, orderBy: { name: "asc" } }),
  ]);
  const qs = (extra: Record<string, string | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) s.set(k, v);
    return s.toString();
  };
  const stepCounts = sum(runs.map((r) => r.steps));
  const where = platform ? platforms.find((p) => p.toLowerCase() === platform) : "every platform";
  const when = f.release ? `Release ${f.release}` : f.allTime ? "All time" : dateRange(f.from, f.to, await mySpelling());

  // Attach wrap-ups (ver_96): bug bashes and exploring carried on this report, outside its pass rates.
  const wrapKey = reportsWrapKey(`/g/${u.group.id}/reports`);
  const wrapPick = wrapPickOf(user.rcReport, wrapKey);
  const wrapUps = await attachedWrapUps(all, wrapPick, wrapPick.auto ? (f.release ? await releaseStart(all, f.release) : f.from) : null);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Reports"
        subtitle={`${u.group.name} · ${where} · ${when}`}
        actions={
          <ExportMenu
            exportUrl={`/g/${u.group.id}/reports/export?${qs({ view: undefined })}`}
            view={view}
            viewLabel={VIEWS.find((v) => v.id === view)!.label}
            image={view === "status" || view === "trends" || view === "steps"}
            fileBase={u.hub.key}
            tabs={exportTabs(false)}
            scopeLine={`${u.group.name} · ${where} · ${when}`}
            preparedBy={user.name ?? user.email}
          />
        }
      />
      <ViewTabs
        label="Reports"
        tabs={reportTabs({ g: u.group.id, hub: u.hub.key, tools: u.tools }, "runs", f.release)}
      />

      {/* Copy link and Save this view… (ver_91), kept with the umbrella's hub. */}
      <SavedViews
        projectId={u.hub.id}
        current={cleanReportQuery({ ...sp, view })}
        views={saved.map((v) => ({ id: v.id, name: v.name, query: v.query, shared: v.shared, createdByName: v.createdByName, canDelete: v.createdById === user.id || (v.shared && can(u.who, "run:manage")) }))}
      />
      <div className="mb-3 flex justify-end">
        <AttachWrapUps scope={{ groupId: u.group.id }} prefKey={wrapKey} pick={wrapPick} count={wrapUps.length} release={f.release ?? undefined} />
      </div>

      <AutoFilterForm className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value={view} />
        <Select name="release" defaultValue={f.release ?? ""} className="w-auto" aria-label="Release">
          <option value="">Any release</option>
          {releases.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        {platforms.length > 0 && (
          <Select name="platform" defaultValue={platform} className="w-auto" aria-label="Platform">
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
              <Link href={`?${qs({ range: "all", from: undefined, to: undefined })}`} className="pb-2 text-sm text-accent-700 hover:underline">
                All time
              </Link>
            )}
          </>
        )}
        <RunKindFilter current={f.kind} href={(k) => `?${qs({ runs: k })}`} />
        <KindSelect kinds={parseRunKinds(u.group.runKinds)} value={sp.kind} />
        {(sp.release || sp.platform || sp.from || sp.to || sp.range || sp.runs || sp.kind) && (
          <Link href={`?view=${view}`} className="pb-2 text-sm text-slate-500 hover:underline">
            Reset
          </Link>
        )}
      </AutoFilterForm>

      {/* The one-line answer (ver_124, persona audit #10), following the dates and filters. */}
      {view !== "regression" && runs.length > 0 && <ReportSummaryBar summary={await summaryFor(scope, f, runs, when)} />}

      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Report views">
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            href={`?${qs({ view: v.id })}`}
            aria-current={view === v.id ? "page" : undefined}
            className={cx("-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap", view === v.id ? "border-accent-600 font-medium text-accent-700" : "border-transparent text-slate-600 hover:text-slate-900")}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      <AddPartsHere homeId={u.hub.id} user={user} who={u.who} base={`/g/${u.group.id}/reports/custom`}>
      <div id="report-body">
      {view === "regression" ? (
        <RegressionView
          data={await regressionReport(all, { rc: sp.rc, vs: sp.vs, platform: platforms.find((p) => p.toLowerCase() === platform) })}
          show={sp.show === "still" || sp.show === "fixed" ? sp.show : "all"}
          hidden={Object.fromEntries(Object.entries({ view, platform }).filter(([, v]) => v)) as Record<string, string>}
          qs={qs}
        />
      ) : runs.length === 0 ? (
        <EmptyState title="No test runs match">Pick another release or platform, widen the dates, or set Runs to All.</EmptyState>
      ) : view === "trends" ? (
        <TrendsView data={await trends(scope, f)} />
      ) : view === "status" ? (
        <div className="space-y-5">
          <ByCycle runs={runs} colorOf={(p) => platformColor(u.platforms, p)} />
          <StatusView suiteKey={u.hub.key} runs={runs} kind={f.kind} suites={await suiteReport([u.hub.id], runs)} />
        </div>
      ) : view === "steps" ? (
        <StepsView runs={runs} stepCounts={stepCounts} failing={(await stepHistory(scope, f)).slice(0, 5)} moreHref={`?${qs({ view: "failing" })}`} />
      ) : view === "failing" ? (
        <FailingView rows={await stepHistory(scope, f)} allTimeHref={f.allTime || f.release ? null : `?${qs({ range: "all", from: undefined, to: undefined })}`} />
      ) : view === "defects" ? (
        <DefectsView rows={await defectReport(scope, f)} scale={await severityScaleFor(u.hub.id)} />
      ) : view === "cases" ? (
        <CasesView rows={await caseHealth(scope, f)} />
      ) : (
        <TestersView rows={await testerReport(scope, f)} />
      )}
      <WrapUpsSection items={wrapUps} />
      </div>
      </AddPartsHere>
    </div>
  );
}

import { parseRunKinds, shownKind } from "@/lib/run-kinds";
import { knownBugCounts } from "@/lib/known-bugs";
import { KnownCountTag } from "@/components/known-bugs-panel";
import { caseNewsCounts } from "@/lib/case-news-data";
import { NewsCountTags } from "@/components/case-news-tag";
import { RunKindTag } from "@/components/run-kind-tag";
import { umbrellaOf } from "@/lib/umbrella";
import Link from "next/link";
import { fieldBits } from "@/lib/run-fields";
import { StartRunBox } from "@/components/start-run-box";
import { StartBashButton } from "@/components/bash-start";
import { BringInResults } from "@/components/automation-upload";
import { StatusBar } from "@/components/status";
import { ViewTabs } from "@/components/view-tabs";
import { can } from "@/lib/permissions";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { relativeTime } from "@/lib/format";
import { projectAccess, mySpelling } from "@/lib/session";
import { countStatuses, isOpen, pct, totals } from "@/lib/status";
import { redirect } from "next/navigation";
import { hubGroupId } from "@/lib/umbrella";

export const metadata = { title: "Test runs" };

export default async function RunsPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ state?: string }> }) {
  const spelling = await mySpelling();
  const { key } = await params;
  const view = (await searchParams).state;
  const closed = view === "closed";
  const automated = view === "automated";
  const { project, user, who } = await projectAccess(key);
  // An umbrella's hub shows its runs and bugs on the umbrella's own pages.
  const umbrellaId = await hubGroupId(project.id);
  if (umbrellaId) redirect(`/g/${umbrellaId}/runs`);
  const [runs, activeCount, closedCount] = await Promise.all([
    db.testRun.findMany({
      where: { projectId: project.id, ...(automated ? { automated: true } : { state: closed ? "COMPLETED" : "ACTIVE", automated: false }) },
      orderBy: { number: "desc" },
      take: 200,
      include: { suite: { select: { name: true } }, entries: { select: { status: true, assigneeId: true, kind: true } } },
    }),
    db.testRun.count({ where: { projectId: project.id, state: "ACTIVE" } }),
    db.testRun.count({ where: { projectId: project.id, state: "COMPLETED", automated: false } }),
  ]);
  const known = await knownBugCounts(runs.filter((r) => r.state === "ACTIVE" && !r.automated).map((r) => r.id));
  const newsCounts = await caseNewsCounts(runs.filter((r) => r.state === "ACTIVE" || r.automated).slice(0, 30).map((r) => r.id));
  const autoCount = await db.testRun.count({ where: { projectId: project.id, automated: true } });
  const canStart = can(who, "run:create");
  const picker = canStart ? <StartRunBox scope={{ projectKey: project.key }} /> : null;
  const umbrella = await umbrellaOf(project);
  const inUmbrella = !!umbrella;
  const kinds = parseRunKinds(umbrella?.group.runKinds);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Test runs"
        subtitle="Start a run from a test suite, or select cases in the library and run them."
        actions={
          <>
            {can(who, "run:import") && <BringInResults scope={{ projectKey: project.key }} importHref={`/p/${project.key}/runs/import`} auto={!project.archivedAt} />}
            {/* In an umbrella, Start a run's Bug bash kind opens this box. */}
            {canStart && !project.archivedAt && <StartBashButton projectId={project.id} hideButton={inUmbrella} />}
            {picker}
          </>
        }
      />
      <ViewTabs
        label="Run state"
        tabs={[
          { label: "Active", href: `/p/${project.key}/runs`, count: activeCount, current: !closed && !automated },
          { label: "🤖 Automated", href: `/p/${project.key}/runs?state=automated`, count: autoCount, current: automated },
          { label: "Closed", href: `/p/${project.key}/runs?state=closed`, count: closedCount, current: closed },
        ]}
      />
      {runs.length === 0 ? (
        <EmptyState title={closed ? "No closed runs" : automated ? "No automated runs yet" : "No active runs"}>
          {!canStart ? (
            <>{automated ? "When someone uploads results from automated tests, they show here." : closed ? "When a run is closed, it moves here." : "When someone starts a run, it shows here."}</>
          ) : automated ? (
            <>Use Bring in results → Automated test results to add results from your automated tests. Each upload shows here.</>
          ) : closed ? (
            <>When a run is closed, it moves here. Open a closed run to reopen it.</>
          ) : (
            <>
              Press Start a run to test by hand, or use Bring in results for results from your automated tests or a spreadsheet.
            </>
          )}
        </EmptyState>
      ) : (
        <Card className="divide-y divide-slate-100">
          {runs.map((r) => {
            const c = countStatuses(r.entries.map((e) => e.status));
            const t = totals(c);
            const mine = r.entries.filter((e) => e.assigneeId === user.id && isOpen(e.status)).length;
            return (
              <Link key={r.id} href={`/p/${project.key}/runs/${r.number}`} className="grid gap-2 px-4 py-3 hover:bg-slate-50 sm:grid-cols-[1fr_18rem]">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    <span className="font-mono text-xs text-slate-500">R{r.number}</span> {r.name}
                    {r.automated && (
                      <Badge tone="violet" className="ml-2">
                        🤖 Automated
                      </Badge>
                    )}
                    {r.automated && !r.release.trim() && (
                      <Badge tone="gray" className="ml-1" data-testid="no-release">
                        No release
                      </Badge>
                    )}
                    {shownKind(r) && <RunKindTag kinds={kinds} kind={shownKind(r)} className="ml-2" />}
                    <KnownCountTag count={known.get(r.id)} />
                    <NewsCountTags count={newsCounts.get(r.id)} />
                    {mine > 0 && (
                      <Badge tone="blue" className="ml-2">
                        {mine} for you
                      </Badge>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {[r.release && `Release ${r.release}`, r.suite && `${r.suite.name}${r.suiteVersion ? ` v${r.suiteVersion}` : ""}`, r.build && `build ${r.build}`, ...fieldBits(r), r.environment, `started ${relativeTime(r.createdAt, spelling)} by ${r.createdBy}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="text-xs text-slate-500">
                  <StatusBar counts={c} />
                  <p className="mt-1 tabular-nums">
                    {r.automated ? `${c.PASSED ?? 0}/${t.total} passed · ${c.FAILED ?? 0} failed` : <>{t.tested}/{t.total} tested{t.passRate !== null && ` · ${pct(t.passRate)} passed`}</>}
                  </p>
                </div>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}

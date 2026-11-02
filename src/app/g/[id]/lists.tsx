import { mySpelling } from "@/lib/session";
import { knownBugCounts } from "@/lib/known-bugs";
import { KnownCountTag } from "@/components/known-bugs-panel";
import { caseNewsCounts } from "@/lib/case-news-data";
import { NewsCountTags } from "@/components/case-news-tag";
import { fieldBits } from "@/lib/run-fields";
import Link from "next/link";
import { StatusBar } from "@/components/status";
import { Badge, Card, EmptyState } from "@/components/ui";
import { db } from "@/lib/db";
import { relativeTime } from "@/lib/format";
import { countStatuses, pct, totals } from "@/lib/status";
import { shownKind, type RunKindDef } from "@/lib/run-kinds";
import { RunKindTag } from "@/components/run-kind-tag";

/** Runs across these projects, newest first. */
/** canStart false (Viewers): the empty state says what will show, not which button to press. */
export async function Runs({ projectIds, state, kind, kinds = [], canStart = true }: { projectIds: string[]; state?: string; kind?: string; kinds?: RunKindDef[]; canStart?: boolean }) {
  const spelling = await mySpelling();
  const runs = await db.testRun.findMany({
    where: {
      projectId: { in: projectIds },
      ...(state === "active" ? { state: "ACTIVE" as const } : state === "closed" ? { state: "COMPLETED" as const, automated: false } : state === "automated" ? { automated: true } : {}),
      // Kind filter: "none" is plain runs.
      ...(kind ? { kind: kind === "none" ? "" : kind } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { project: { select: { key: true, name: true } }, suite: { select: { name: true } }, entries: { select: { status: true, kind: true } } },
  });
  const known = await knownBugCounts(runs.filter((r) => r.state === "ACTIVE" && !r.automated).map((r) => r.id));
  const newsCounts = await caseNewsCounts(runs.filter((r) => r.state === "ACTIVE" || r.automated).slice(0, 30).map((r) => r.id));
  if (runs.length === 0)
    return state === "automated" ? (
      <EmptyState title="No automated runs yet">{canStart ? "Upload automation results to bring in results from your automated tests. Each upload shows here." : "When someone uploads results from automated tests, they show here."}</EmptyState>
    ) : (
      <EmptyState title="No runs yet">{canStart ? "Press Start a run to test by hand, or Upload automation results to bring in results from your automated tests." : "When someone starts a run, it shows here."}</EmptyState>
    );
  return (
    <Card className="divide-y divide-slate-100">
      {runs.map((r) => {
        const c = countStatuses(r.entries.map((e) => e.status));
        const t = totals(c);
        return (
          <Link key={r.id} href={`/p/${r.project.key}/runs/${r.number}`} className="grid gap-2 px-4 py-3 hover:bg-slate-50 sm:grid-cols-[1fr_18rem]">
            <div className="min-w-0">
              <p className="font-medium text-slate-900">
                <span className="font-mono text-xs text-slate-500">R{r.number}</span> {r.name}
                <Badge tone="gray" className="ml-2">
                  {r.project.name}
                </Badge>
                {r.automated ? (
                  <Badge tone="violet" className="ml-1">
                    🤖 Automated
                  </Badge>
                ) : r.state === "COMPLETED" && (
                  <Badge tone="gray" className="ml-1">
                    Closed
                  </Badge>
                )}
                {/* Automated runs that don't count toward any release. */}
                {r.automated && !r.release.trim() && (
                  <Badge tone="gray" className="ml-1" data-testid="no-release">
                    No release
                  </Badge>
                )}
                {shownKind(r) && <RunKindTag kinds={kinds} kind={shownKind(r)} className="ml-1" />}
                <KnownCountTag count={known.get(r.id)} />
                <NewsCountTags count={newsCounts.get(r.id)} />
              </p>
              <p className="truncate text-xs text-slate-500">
                {[r.release && `Release ${r.release}`, r.suite && `${r.suite.name}${r.suiteVersion ? ` v${r.suiteVersion}` : ""}`, r.build && `build ${r.build}`, ...fieldBits(r), `${r.automated ? "uploaded" : "started"} ${relativeTime(r.createdAt, spelling)} by ${r.createdBy}`].filter(Boolean).join(" · ")}
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
  );
}

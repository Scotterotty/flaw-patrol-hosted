import type { ReactNode } from "react";
import { ByCycle } from "@/components/by-cycle";
import { RegressionView } from "@/components/regression-report";
import { CasesView, DefectsView, FailingView, StatusView, StepsView, TrendsView } from "@/components/report-views";
import { PartFrame, PartTitle } from "@/components/report-part-title";
import { WrapUpsSection } from "@/components/wrap-ups";
import { Card } from "@/components/ui";
import { filtersOf, partQuery, type CustomScope, type Loader } from "@/lib/custom-report-data";
import { rcTable, reportTable, type Cell } from "@/lib/report-export";
import { headingOf, ownLabel, partOf, tabLabel, type PartId, type ReportPart } from "@/lib/report-parts";
import { countStatuses, STATUSES, type StatusCounts } from "@/lib/status";
import { platformColor, type Platform } from "@/lib/umbrella";

// One part of a custom report (ver_101), drawn with the same view as on its Reports tab.

const sum = (list: StatusCounts[]) => countStatuses(list.flatMap((c) => STATUSES.flatMap((s) => Array(c[s]).fill(s))));

/** A box with just a heading and a line of text, for parts with nothing to show. */
function Plain({ part, children }: { part: PartId; children: ReactNode }) {
  return (
    <Card className="p-4">
      <PartTitle part={part} className="mb-2">
        {partOf(part).title}
      </PartTitle>
      {children}
    </Card>
  );
}

function SimpleTable({ rows }: { rows: Cell[][] }) {
  const blocks: Cell[][][] = [[]];
  for (const r of rows) {
    if (!r.length) blocks.push([]);
    else blocks.at(-1)!.push(r);
  }
  return (
    <div className="space-y-4 overflow-x-auto">
      {blocks
        .filter((b) => b.length)
        .map((b, i) => (
          <table key={i} className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {b[0].map((h, j) => (
                  <th key={j} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {b.slice(1).map((r, j) => (
                <tr key={j}>
                  {r.map((c, k) => (
                    <td key={k} className="px-3 py-1.5 tabular-nums">
                      {c ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </div>
  );
}

async function body(cs: CustomScope, load: Loader, it: ReportPart, q: Record<string, string | undefined>, platforms: Platform[]): Promise<ReactNode> {
  const part = it.part;
  const f = filtersOf(cs, partQuery(q, it.own));
  const tab = partOf(part).tab;
  if (part === "regression") {
    const data = await load.regression();
    if (!data.newer || !data.older) return <Plain part={part}>Nothing to compare yet. Once two releases have results, cases that passed in the older one and fail in the newer one show here.</Plain>;
    return <RegressionView data={data} show="all" hidden={{}} qs={() => ""} inReport />;
  }
  if (part === "rc") {
    const rc = await rcTable(cs.exportCtx(f, q), f);
    return (
      <Card className="p-4">
        <PartTitle part={part} className="mb-2">
          Release status summary
        </PartTitle>
        {rc ? (
          <>
            <p className="mb-2 text-xs text-slate-500">{rc.release}</p>
            <SimpleTable rows={rc.rows} />
          </>
        ) : (
          <p className="text-sm text-slate-500">No runs have a release yet.</p>
        )}
      </Card>
    );
  }
  if (part === "requirements") {
    const t = await reportTable(cs.exportCtx(f, q), "requirements", f);
    return (
      <Card className="p-4">
        <PartTitle part={part} className="mb-2">
          Requirements coverage
        </PartTitle>
        {t && t.rows.length > 1 ? <SimpleTable rows={t.rows} /> : <p className="text-sm text-slate-500">{t?.rows[0]?.[0] ?? "No requirements are linked to cases yet."}</p>}
      </Card>
    );
  }
  if (part === "wrapups") {
    const items = await load.wrapUps(f);
    return items.length ? <WrapUpsSection items={items} /> : <Plain part={part}>No bug bashes or exploring sessions were saved in this range.</Plain>;
  }
  if (tab === "trends") {
    const data = await load.trends(f);
    if (data.results === 0) return <Plain part={part}>No saved results match these filters.</Plain>;
    return <TrendsView data={data} only={part} />;
  }
  if (tab === "defects") return <DefectsView rows={await load.defects(f)} scale={await load.scale()} only={part} critical={it.own?.critical} />;
  if (tab === "cases") return <CasesView rows={await load.cases(f)} only={part} />;
  if (tab === "failing") return <FailingView rows={await load.steps(f)} allTimeHref={null} only={part} />;
  // Execution status and Step results come from the runs.
  const runs = await load.runs(f);
  if (!runs.length) return <Plain part={part}>No test runs match these filters.</Plain>;
  if (part === "status.cycles") return <ByCycle runs={runs} colorOf={(p) => platformColor(platforms, p)} />;
  if (tab === "status") return <StatusView suiteKey={cs.homeKey} runs={runs} kind={f.kind} suites={part === "status.suites" ? await load.suites(f, runs) : []} only={part} />;
  return <StepsView runs={runs} stepCounts={sum(runs.map((r) => r.steps))} failing={part === "steps.failmost" ? (await load.steps(f)).slice(0, 5) : []} moreHref="" only={part} />;
}

/** One part with its heading, the tab it came from, and its own filters when it has them. */
export async function CustomReportPart({ cs, load, item, query, platforms = [], actions }: { cs: CustomScope; load: Loader; item: ReportPart; query: Record<string, string | undefined>; platforms?: Platform[]; actions?: ReactNode }) {
  let node: ReactNode;
  try {
    node = await body(cs, load, item, query, platforms);
  } catch (e) {
    console.error("custom report part", item.part, e);
    node = <Plain part={item.part}>This part couldn&apos;t load. Try again in a moment.</Plain>;
  }
  return (
    <PartFrame heading={headingOf(item)} from={tabLabel(partOf(item.part).tab)} own={ownLabel(item.own)} actions={actions}>
      {node}
    </PartFrame>
  );
}

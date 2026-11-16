import Link from "next/link";
import type { ResultStatus } from "@prisma/client";
import { StatusBar } from "./status";
import { Badge } from "./ui";
import { parsePlanValues, passedPct, planCounts, valuesLabel } from "@/lib/configurations";
import { countStatuses } from "@/lib/status";

type ListRun = { id: string; number: number; planId: string | null; planValues: unknown; entries: { status: ResultStatus }[] };
type PlanInfo = { id: string; number: number; name: string; runCount: number };

/** Runs in list order, with each test plan's runs gathered into one item where its first run was. */
export function groupByPlan<R extends ListRun>(runs: R[], plans: Map<string, PlanInfo>): ({ kind: "run"; run: R } | { kind: "plan"; plan: PlanInfo; runs: R[] })[] {
  const out: ({ kind: "run"; run: R } | { kind: "plan"; plan: PlanInfo; runs: R[] })[] = [];
  const at = new Map<string, { kind: "plan"; plan: PlanInfo; runs: R[] }>();
  for (const r of runs) {
    const plan = r.planId ? plans.get(r.planId) : undefined;
    if (!plan) {
      out.push({ kind: "run", run: r });
      continue;
    }
    let item = at.get(plan.id);
    if (!item) {
      item = { kind: "plan", plan, runs: [] };
      at.set(plan.id, item);
      out.push(item);
    }
    item.runs.push(r);
  }
  for (const item of at.values()) item.runs.sort((a, b) => a.number - b.number);
  return out;
}

/**
 * A test plan in a runs list: one row, with ▸ to open its runs in place. The name opens the
 * plan page. `projectKey` is the test cycle the plan is in; `tag` shows its name in umbrella lists.
 */
export function PlanListRow({ plan, runs, projectKey, tag }: { plan: PlanInfo; runs: ListRun[]; projectKey: string; tag?: string }) {
  const statuses = runs.flatMap((r) => r.entries.map((e) => e.status));
  const c = planCounts(statuses);
  const failedFirst = [...runs].sort((a, b) => Number(planCounts(b.entries.map((e) => e.status)).failed > 0) - Number(planCounts(a.entries.map((e) => e.status)).failed > 0));
  return (
    <details className="group" data-testid="plan-row">
      <summary className="grid cursor-pointer list-none gap-2 px-4 py-3 hover:bg-slate-50 sm:grid-cols-[1fr_18rem] [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-start gap-2">
          <span aria-hidden className="mt-0.5 text-slate-500 transition-transform group-open:rotate-90">
            ▸
          </span>
          <p className="min-w-0 font-medium text-slate-900">
            <Link href={`/p/${projectKey}/plans/${plan.number}`} className="hover:underline">
              {plan.name}
            </Link>
            <Badge tone="violet" className="ml-2">
              Test plan · {plan.runCount === 1 ? "1 run" : `${plan.runCount} runs`}
            </Badge>
            {tag && (
              <Badge tone="gray" className="ml-1">
                {tag}
              </Badge>
            )}
            <span className="sr-only"> (press to show its runs)</span>
          </p>
        </div>
        <div className="text-xs text-slate-500">
          <StatusBar counts={countStatuses(statuses)} />
          <p className="mt-1 tabular-nums">
            {c.tested}/{c.total} tested · {passedPct(c)} passed{c.failed ? ` · ${c.failed} failed` : ""}
          </p>
        </div>
      </summary>
      <ul className="border-t border-slate-100 bg-slate-50/60" aria-label={`Runs in ${plan.name}`}>
        {failedFirst.map((r) => {
          const rc = planCounts(r.entries.map((e) => e.status));
          return (
            <li key={r.id}>
              <Link href={`/p/${projectKey}/runs/${r.number}`} className="grid gap-1 py-2 pr-4 pl-10 text-sm hover:bg-slate-100 sm:grid-cols-[1fr_18rem]">
                <span className="min-w-0 truncate text-slate-800">{valuesLabel(parsePlanValues(r.planValues))}</span>
                <span className="text-xs text-slate-500">
                  <StatusBar counts={countStatuses(r.entries.map((e) => e.status))} />
                  <span className="mt-1 block tabular-nums">
                    {rc.failed ? `${rc.failed} failed · ` : ""}
                    {rc.tested} of {rc.total} done
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
        <li>
          <Link href={`/p/${projectKey}/plans/${plan.number}`} className="block py-2 pr-4 pl-10 text-xs font-medium text-accent-700 hover:underline">
            Open the plan
          </Link>
        </li>
      </ul>
    </details>
  );
}

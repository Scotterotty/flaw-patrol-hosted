import Link from "next/link";
import { notFound } from "next/navigation";
import type { ResultStatus } from "@prisma/client";
import { CrumbName } from "@/components/crumb-name";
import { PlanRunTester, PlanTools } from "@/components/plan-tools";
import { StatusBar, StatusIcon } from "@/components/status";
import { Badge, Card, cx, PageHeader } from "@/components/ui";
import { ViewTabs } from "@/components/view-tabs";
import { assignable } from "@/lib/assignable";
import { parseConfigurations, passedPct, planCounts, valuesLabel } from "@/lib/configurations";
import { can } from "@/lib/permissions";
import { planPage, type PlanRunRow } from "@/lib/plan-data";
import { parsePlanDetails } from "@/lib/plans-server";
import { projectAccess } from "@/lib/session";
import { countStatuses, STATUS_LABEL, STATUS_STYLE } from "@/lib/status";
import { projectMembers } from "@/lib/suite-data";
import { loadUmbrella, umbrellaOf } from "@/lib/umbrella";

export const metadata = { title: "Test plan" };

/** A test plan: a summary, then one row per run (one per Configuration value), or a Grid of cases × values. */
export default async function PlanPage({ params, searchParams }: { params: Promise<{ key: string; number: string }>; searchParams: Promise<{ view?: string }> }) {
  const { key, number } = await params;
  const sp = await searchParams;
  const { project, user, who } = await projectAccess(key);
  const n = Number(number);
  if (!Number.isInteger(n)) notFound();
  const data = await planPage(project.id, n);
  if (!data) notFound();
  const { plan, runs, cases, cells, counts } = data;
  const grid = sp.view === "grid";
  const closed = plan.state === "COMPLETED";
  const base = `/p/${project.key}`;
  const details = parsePlanDetails(plan.details);

  const members = assignable(await projectMembers(project.id)).map((m) => ({ id: m.id, name: m.name }));
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const u = await umbrellaOf(project);
  const umbrella = u ? await loadUmbrella(u.group.id, user) : null;
  // Copy to: the umbrella's other test cycles, newest first.
  const cycles = umbrella ? [...umbrella.current, ...umbrella.older].filter((p) => p.id !== project.id && !p.archivedAt).map((p) => ({ id: p.id, name: p.name })) : [];
  const live = umbrella ? parseConfigurations(umbrella.group.configurations) : [];
  const toolConfigs = plan.configs.map((c) => {
    const have = new Set(c.values.map((v) => v.toLowerCase()));
    return { name: c.name, more: (live.find((x) => x.name === c.name)?.values ?? []).filter((v) => !have.has(v.toLowerCase())) };
  });
  const label = (r: PlanRunRow) => valuesLabel(r.values);
  const unfinished = runs.filter((r) => r.state === "ACTIVE" && planCounts(r.statuses).notRun > 0).map(label);
  // Phones: failed ones first, then the rest in order.
  const phoneOrder = [...runs].sort((a, b) => Number(planCounts(b.statuses).failed > 0) - Number(planCounts(a.statuses).failed > 0));

  return (
    <div className="page page-list">
      <CrumbName href={`${base}/plans/${plan.number}`} label={plan.name} />
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {plan.name}
            <Badge tone="violet">Test plan</Badge>
            {closed && <Badge tone="gray">Closed</Badge>}
          </span>
        }
        subtitle={[
          `${runs.length === 1 ? "1 run" : `${runs.length} runs`} on ${plan.configs.map((c) => c.name).join(" × ")}`,
          details.release && `Release ${details.release}`,
          details.build && `build ${details.build}`,
          `${counts.tested} of ${counts.total} done`,
          `started by ${plan.createdBy}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <PlanTools
            projectId={project.id}
            planId={plan.id}
            closed={closed}
            configs={toolConfigs}
            members={members}
            cycles={cycles}
            unfinished={unfinished}
            runCount={runs.length}
            canCreate={can(who, "run:create") && !project.archivedAt}
            canAssign={can(who, "run:assign")}
            canManage={can(who, "run:manage")}
            canRemember={!!umbrella && can(umbrella.who, "umbrella:fields")}
          />
        }
      />

      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Plan summary" data-testid="plan-summary">
        {[
          ["Passed", String(counts.passed), "text-st-passed-ink"],
          ["Failed", String(counts.failed), counts.failed ? "text-st-failed-ink" : "text-slate-900"],
          ["Not run", String(counts.notRun), "text-slate-900"],
          ["Plan", `${passedPct(counts)} passed`, "text-slate-900"],
        ].map(([k, v, tone]) => (
          <div key={k} className="rounded-lg border border-slate-200 bg-surface px-4 py-3">
            <dt className="text-[11px] font-semibold tracking-wide text-accent-700 uppercase">{k}</dt>
            <dd className={cx("text-lg font-semibold tabular-nums", tone)}>{v}</dd>
          </div>
        ))}
      </dl>

      <ViewTabs
        label="Plan view"
        tabs={[
          { label: "Runs", href: `${base}/plans/${plan.number}`, current: !grid, count: runs.length },
          { label: "Grid", href: `${base}/plans/${plan.number}?view=grid`, current: grid },
        ]}
      />

      {grid ? (
        <Card className="p-3">
          <div className="overflow-x-auto" data-testid="plan-grid">
            <table className="border-collapse text-sm">
              <caption className="sr-only">Every case on every value. Read across: is one case broken everywhere? Read down: is one value broken?</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 bg-surface px-2 py-1.5 text-left align-bottom text-xs font-semibold text-slate-500">
                    Case
                  </th>
                  {runs.map((r) => (
                    <th key={r.id} scope="col" className="px-1 py-1.5 align-bottom">
                      <Link href={`${base}/runs/${r.number}`} className="inline-block max-h-44 overflow-hidden text-left text-xs font-medium whitespace-nowrap text-slate-800 hover:underline [writing-mode:vertical-rl] rotate-180" title={label(r)}>
                        {label(r)}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.caseId} className="border-t border-slate-100">
                    <th scope="row" className="sticky left-0 min-w-52 bg-surface px-2 py-1.5 text-left font-normal text-slate-800">
                      <span className="mr-1.5 font-mono text-xs text-slate-500">{c.key}</span>
                      {c.title}
                    </th>
                    {runs.map((r) => {
                      const cell = cells.get(`${r.id}:${c.caseId}`);
                      if (!cell) return <td key={r.id} className="px-1 py-1 text-center text-xs text-slate-400">·</td>;
                      const what = `${c.key} on ${label(r)}: ${STATUS_LABEL[cell.status]}${cell.bugs.length ? `, ${cell.bugs.join(", ")}` : ""}`;
                      return (
                        <td key={r.id} className="px-1 py-1 text-center">
                          <Link href={`${base}/runs/${r.number}/execute?entry=${cell.entryId}`} aria-label={what} title={what} className={cx("inline-grid h-7 w-8 place-items-center rounded-md ring-1 ring-inset", STATUS_STYLE[cell.status].soft)}>
                            <StatusIcon status={cell.status} always className="size-3.5" />
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
            {(["PASSED", "FAILED", "UNTESTED"] as ResultStatus[]).map((s) => (
              <span key={s} className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 ring-1 ring-inset", STATUS_STYLE[s].soft)}>
                <StatusIcon status={s} always />
                {s === "UNTESTED" ? "Not run" : STATUS_LABEL[s]}
              </span>
            ))}
            <span>Read across: is one case broken everywhere? Read down: is one value broken? Click a square to open it.</span>
          </p>
        </Card>
      ) : (
        <>
          <Card className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm" data-testid="plan-runs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  {plan.configs.map((c) => (
                    <th key={c.name} scope="col" className="px-4 py-2 font-semibold">
                      {c.name}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Progress
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Passed
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Bugs
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Tester
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => {
                  const c = planCounts(r.statuses);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      {plan.configs.map((cfg, i) => (
                        <td key={cfg.name} className="px-4 py-2">
                          {i === 0 ? (
                            <Link href={`${base}/runs/${r.number}`} className="font-medium text-slate-900 hover:underline" data-howto="plan-run">
                              {r.values.find((v) => v.name === cfg.name)?.value ?? "–"}
                            </Link>
                          ) : (
                            <span className="text-slate-800">{r.values.find((v) => v.name === cfg.name)?.value ?? "–"}</span>
                          )}
                        </td>
                      ))}
                      <td className="w-40 px-3 py-2">
                        <StatusBar counts={countStatuses(r.statuses)} />
                      </td>
                      <td className="px-3 py-2">
                        <RunStatus counts={c} closed={r.state === "COMPLETED"} />
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-700">{passedPct(c)}</td>
                      <td className="px-3 py-2">
                        <Bugs bugs={r.bugs} />
                      </td>
                      <td className="px-3 py-2">
                        {can(who, "run:assign") && r.state === "ACTIVE" ? (
                          <PlanRunTester projectId={project.id} planId={plan.id} runId={r.id} label={label(r)} testerId={r.testerId} mixed={r.mixed} members={members} />
                        ) : (
                          <span className="text-slate-700">{r.mixed ? "Several people" : r.testerId ? (r.testerId === user.id ? "You" : (nameOf.get(r.testerId) ?? "Someone")) : "Nobody yet"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <ul className="space-y-2 sm:hidden" aria-label="Runs in this plan">
            {phoneOrder.map((r) => {
              const c = planCounts(r.statuses);
              return (
                <li key={r.id}>
                  <Link href={`${base}/runs/${r.number}`} className="block space-y-1.5 rounded-lg border border-slate-200 bg-surface p-3">
                    <span className="block font-medium text-slate-900">{label(r)}</span>
                    <StatusBar counts={countStatuses(r.statuses)} />
                    <span className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <RunStatus counts={c} closed={r.state === "COMPLETED"} />
                      <span>{passedPct(c)} passed</span>
                      {r.bugs.map((b) => (
                        <span key={b.label}>{b.label}</span>
                      ))}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-slate-500">Click a value to open its run. It&apos;s a normal run: same runner, same bug form. Grid shows every case on every value in one table.</p>
        </>
      )}
    </div>
  );
}

/** "✕ 1 failed", "✓ Done" or "◐ 2 of 3 done", in words next to the bar. */
function RunStatus({ counts, closed }: { counts: ReturnType<typeof planCounts>; closed: boolean }) {
  const [s, text]: [ResultStatus, string] = counts.failed
    ? ["FAILED", `${counts.failed} failed`]
    : counts.notRun === 0
      ? ["PASSED", closed ? "Done, closed" : "Done"]
      : ["IN_PROGRESS", `${counts.tested} of ${counts.total} done`];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", s === "IN_PROGRESS" ? "bg-slate-100 text-slate-700 ring-slate-200" : STATUS_STYLE[s].soft)}>
      <StatusIcon status={s} always />
      {text}
    </span>
  );
}

function Bugs({ bugs }: { bugs: PlanRunRow["bugs"] }) {
  if (!bugs.length) return <span className="text-slate-400">–</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {bugs.map((b) =>
        b.href ? (
          <a key={b.label} href={b.href} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">
            {b.label}
          </a>
        ) : (
          <span key={b.label} className="text-slate-700">
            {b.label}
          </span>
        ),
      )}
    </span>
  );
}

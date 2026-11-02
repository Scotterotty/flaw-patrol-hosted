import { mySpelling } from "@/lib/session";
import { fieldBits } from "@/lib/run-fields";
import type { ResultStatus } from "@prisma/client";
import Link from "next/link";
import { badgeOf } from "@/lib/game";
import { db } from "@/lib/db";
import { count, minutesSpent, relativeTime } from "@/lib/format";
import { isFlaky } from "@/lib/run-history";
import { countStatuses, pct, STATUS_LABEL, totals } from "@/lib/status";
import { parseSessionLog } from "@/lib/charter";
import { withoutHeadings } from "@/lib/step-checks";
import { rowsLine } from "@/lib/test-data";
import { rowsOfResult, rowsTip } from "@/lib/test-data-history";
import { PersonLabel } from "./avatar";
import { SessionLogDetails } from "./charter-view";
import { HistoryStrip, StatusChip } from "./status";
import { Card } from "./ui";
import { RegressionBadge } from "./badges";
import { historyMarks, VERDICTS } from "@/lib/regression";
import { regressionSettingsFor } from "@/lib/regression-data";

/** Where a result's run opens: the run page for automated results, else that case in the runner. */
const runHref = (r: { automated: boolean; entryId: string | null; run: { number: number; project: { key: string } } }) =>
  r.automated || !r.entryId ? `/p/${r.run.project.key}/runs/${r.run.number}` : `/p/${r.run.project.key}/runs/${r.run.number}/execute?entry=${r.entryId}`;

/** Every execution of a case across runs, newest first. */
export async function CaseHistory({ caseId, charter, canRun = true }: { caseId: string; projectKey: string; charter?: boolean; canRun?: boolean }) {
  const spelling = await mySpelling();
  const results = await db.testResult.findMany({
    where: { caseId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      run: { select: { number: true, name: true, release: true, build: true, cspVersion: true, fields: true, environment: true, project: { select: { key: true, platform: true } } } },
      entry: { select: { regressionOff: true, steps: true } },
      defects: { include: { defect: true } },
      attachments: { select: { id: true, fileName: true } },
    },
  });
  const testerIds = [...new Set(results.map((r) => r.testerId).filter((x): x is string => !!x))];
  const testers = new Map((await db.user.findMany({ where: { id: { in: testerIds } }, select: { id: true, avatarAt: true, gameEnabled: true, gameTitle: true, gameFrame: true } })).map((u) => [u.id, u]));
  const counts = countStatuses(results.map((r) => r.status));
  const t = totals(counts);
  const lastPass = results.find((r) => r.status === "PASSED");
  const flaky = isFlaky(results.map((r) => r.status));
  // Regression flag (ver_93): kept on the result where it broke, with "Fixed again" on the pass after.
  const home = await db.testCase.findUnique({ where: { id: caseId }, select: { project: { select: { id: true, groupId: true } } } });
  const reg = home ? await regressionSettingsFor(home.project) : null;
  const marks = reg?.on
    ? historyMarks(
        results
          .filter((r) => VERDICTS.includes(r.status))
          .map((r) => ({
            id: r.id,
            status: r.status,
            at: r.createdAt,
            release: r.run.release,
            build: r.run.build,
            runNumber: r.run.number,
            runName: r.run.name,
            projectKey: r.run.project.key,
            platform: r.run.project.platform,
            entryId: r.entryId,
            caseVersion: r.caseVersion,
            tester: r.testerName,
            stepStatuses: [],
            off: r.entry.regressionOff,
          })),
        reg.compare,
        flaky,
      )
    : new Map();

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Execution history</h2>
        {results.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <HistoryStrip
              statuses={[...results].reverse().map((r) => {
                const rows = rowsOfResult(r.entry?.steps, r.stepResults);
                return { status: r.status, rows, title: `${r.automated ? "🤖 " : ""}R${r.run.number} ${r.run.name}: ${STATUS_LABEL[r.status].toLowerCase()}${rows ? `. ${rowsTip(rows)}` : ""}`, href: runHref(r) };
              })}
              max={30}
            />
            <span>
              {count(results.length, "run")} · {pct(t.passRate)} passed
              {lastPass ? ` · last passed ${relativeTime(lastPass.createdAt, spelling)}` : " · never passed"}
            </span>
            {flaky && <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200">Flaky</span>}
          </div>
        )}
      </div>
      {results.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">{!canRun ? (charter ? "Not explored yet." : "Not run yet. When someone runs it, the results show here.") : charter ? "Not explored yet. Use Start exploring above." : "Not run yet. Use Run this case above, or add it to a suite."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Run</th>
                <th className="px-4 py-2 font-medium">Result</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">Steps</th>
                <th className="px-4 py-2 font-medium">Bugs</th>
                <th className="hidden px-4 py-2 font-medium lg:table-cell">Tester</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {results.map((r) => {
                const steps = countStatuses(withoutHeadings(r.entry?.steps, (r.stepResults as { status: ResultStatus }[]) ?? []).map((s) => s.status));
                const rows = rowsOfResult(r.entry?.steps, r.stepResults);
                const session = r.sessionLog ? parseSessionLog(r.sessionLog) : null;
                return (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-2 text-xs whitespace-nowrap text-slate-500" title={r.createdAt.toISOString()}>
                      {relativeTime(r.createdAt, spelling)}
                    </td>
                    <td className="px-4 py-2">
                      <Link href={runHref(r)} className="hover:underline">
                        <span className="font-mono text-xs text-slate-500">R{r.run.number}</span> {r.run.name}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {[r.run.release && `Release ${r.run.release}`, r.run.build && `build ${r.run.build}`, ...fieldBits(r.run), r.run.environment, `case v${r.caseVersion}`].filter(Boolean).join(" · ")}
                      </p>
                      {r.comment && <p className="mt-0.5 text-xs text-slate-600">“{r.comment}”</p>}
                      {session && <SessionLogDetails notes={session} elapsedSec={r.elapsedSec} />}
                      {!session && r.attachments.length > 0 && (
                        <p className="mt-0.5 text-xs">
                          {r.attachments.map((a) => (
                            <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="mr-2 text-accent-700 hover:underline">
                              📎 {a.fileName}
                            </a>
                          ))}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <StatusChip status={r.status} />
                      {marks.get(r.id) === "regression" && (
                        <span className="ml-1 align-middle">
                          <RegressionBadge tip="Passed the last time it ran in an earlier release on this platform, and failed here." compact />
                        </span>
                      )}
                      {marks.get(r.id) === "fixed" && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200">Fixed again</span>}
                      {r.automated && (
                        <span className="ml-1 cursor-help" title="From an automation upload" aria-label="Automated">
                          🤖
                        </span>
                      )}
                    </td>
                    <td className="hidden px-4 py-2 text-xs whitespace-nowrap text-slate-600 md:table-cell">
                      {session ? (
                        `Session${r.elapsedSec !== null ? ` · ${minutesSpent(r.elapsedSec)}` : ""}`
                      ) : (
                        <>
                          {steps.PASSED} passed{steps.FAILED ? `, ${steps.FAILED} failed` : ""}
                          {steps.BLOCKED ? `, ${steps.BLOCKED} blocked` : ""}
                          {rows && (
                            <span className="block text-slate-500" title={rowsTip(rows)}>
                              {rowsLine(rows)}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {r.defects.map((l) =>
                        l.defect.externalUrl ? (
                          <a key={l.defectId} href={l.defect.externalUrl} target="_blank" rel="noreferrer" className="mr-1 font-mono text-accent-700 hover:underline" title={l.defect.title}>
                            {l.defect.externalKey}
                          </a>
                        ) : (
                          <span key={l.defectId} className="mr-1 font-mono" title={l.defect.title}>
                            D-{l.defect.number}
                          </span>
                        ),
                      )}
                    </td>
                    <td className="hidden px-4 py-2 text-xs text-slate-600 lg:table-cell">
                      {r.testerId ? <PersonLabel person={{ id: r.testerId, name: r.testerName, avatarAt: testers.get(r.testerId)?.avatarAt, ...badgeOf(testers.get(r.testerId) ?? {}) }} size={18} /> : r.testerName}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

import Link from "next/link";
import { PartTitle } from "@/components/report-part-title";
import { StatusBar } from "@/components/status";
import { Card, cx } from "@/components/ui";
import { splitProgress } from "@/lib/progress-split";
import type { RunRow } from "@/lib/reports";
import { pct, totals } from "@/lib/status";

/**
 * One row per test cycle: how its runs in range are going. Hand testing and
 * automation get their own rows, so automation never reads as manual progress.
 */
export function ByCycle({ runs, colorOf }: { runs: RunRow[]; colorOf: (platform: string) => string }) {
  const cycles = new Map<string, { key: string; name: string; platform: string; runs: RunRow[] }>();
  for (const r of runs) {
    const c = cycles.get(r.projectKey) ?? { key: r.projectKey, name: r.projectName, platform: r.platform, runs: [] };
    c.runs.push(r);
    cycles.set(r.projectKey, c);
  }
  const cell = "px-4 py-2 text-right tabular-nums";
  return (
    <Card className="overflow-x-auto" data-export-skip="">
      <PartTitle part="status.cycles" className="border-b border-slate-200 px-4 py-3">
        By test cycle
      </PartTitle>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Test cycle</th>
            <th className="px-4 py-2 font-medium">Who ran it</th>
            <th className="px-4 py-2 text-right font-medium">Runs</th>
            <th className="w-56 px-4 py-2 font-medium">Cases</th>
            <th className="px-4 py-2 text-right font-medium">Done</th>
            <th className="px-4 py-2 text-right font-medium">Passed</th>
            <th className="px-4 py-2 text-right font-medium">Failed</th>
            <th className="px-4 py-2 text-right font-medium">Bugs</th>
          </tr>
        </thead>
        {[...cycles.values()].map((c) => {
          const { manual, auto } = splitProgress(c.runs);
          const rows = [
            manual.runs > 0 && { id: "manual", label: "✋ Manual", tone: "text-blue-700", runs: manual.runs, counts: manual.counts, bugs: manual.bugs, title: undefined },
            auto.runs > 0 && {
              id: "auto",
              label: "🤖 Automated",
              tone: "text-teal-700",
              runs: auto.runs,
              counts: auto.latest,
              bugs: auto.bugs,
              title: `Latest result of each automated case. ${auto.runs} ${auto.runs === 1 ? "run" : "runs"}, ${auto.counts.PASSED} of ${totals(auto.counts).tested} results passed overall.`,
            },
          ].filter((x) => !!x);
          return (
            <tbody key={c.key} className="border-t border-slate-100">
              {rows.map((row, i) => {
                const t = totals(row.counts);
                return (
                  <tr key={row.id} title={row.title} data-testid={`cycle-${row.id}`}>
                    <td className="px-4 py-2">
                      {i === 0 && (
                        <Link href={`/p/${c.key}/reports`} className="font-medium hover:underline">
                          {c.platform && <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: colorOf(c.platform) }} />}
                          {c.name}
                        </Link>
                      )}
                    </td>
                    <td className={cx("px-4 py-2 text-xs whitespace-nowrap", row.tone)}>{row.label}</td>
                    <td className={cell}>{row.runs}</td>
                    <td className="px-4 py-2">
                      <StatusBar counts={row.counts} />
                    </td>
                    <td className={cx(cell, "whitespace-nowrap")}>
                      {t.tested} / {t.total}
                    </td>
                    <td className={cell}>{pct(t.passRate)}</td>
                    <td className={cell}>{row.counts.FAILED}</td>
                    <td className={cell}>{row.bugs}</td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
    </Card>
  );
}

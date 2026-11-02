import Link from "next/link";
import type { RegressionRow } from "@/lib/regression-data";
import { AutoFilterForm } from "./auto-filter-form";
import { PartTitle } from "./report-part-title";
import { Card, cx, EmptyState, Select } from "./ui";

/**
 * Reports → Regression: what got worse since the last release, in one table. Cases that
 * passed in the older release and broke in the newer one, per platform, still broken or fixed again.
 */
export function RegressionView({
  data,
  show,
  hidden,
  qs,
  inReport,
}: {
  data: { releases: string[]; newer: string | null; older: string | null; rows: RegressionRow[]; before: number | null };
  show: "all" | "still" | "fixed";
  /** Other filters to keep (view, platform), as hidden fields. */
  hidden: Record<string, string>;
  qs: (extra: Record<string, string | undefined>) => string;
  /** Inside a custom report: no release pickers or list switch, every regression shows. */
  inReport?: boolean;
}) {
  const { releases, newer, older, rows } = data;
  if (!newer || !older)
    return (
      <EmptyState title="Nothing to compare yet">
        The Regression tab compares two releases. Once runs with a release (like RC 21 and RC 22) have results, cases that passed in the older one and fail in the newer one show here.
      </EmptyState>
    );
  const still = rows.filter((r) => r.now === "still");
  const fixed = rows.filter((r) => r.now === "fixed");
  const shown = show === "still" ? still : show === "fixed" ? fixed : rows;
  return (
    <div className="space-y-4">
      <PartTitle part="regression" quiet>
        Regression list
      </PartTitle>
      {inReport ? (
        <p className="text-sm text-slate-600">
          {newer} compared with {older}
        </p>
      ) : (
      <AutoFilterForm className="flex flex-wrap items-center gap-2 text-sm">
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <Select name="rc" defaultValue={newer} className="w-auto" aria-label="Newer release">
          {releases.slice(0, -1).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <span className="text-slate-500">vs</span>
        <Select name="vs" defaultValue={older} className="w-auto" aria-label="Older release">
          {releases
            .filter((r) => r !== newer)
            .map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
        </Select>
      </AutoFilterForm>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-slate-500">Regressions in {newer}</p>
          <p className="text-2xl font-semibold text-pink-700 tabular-nums">{rows.length}</p>
          <p className="text-[11px] text-slate-400">{data.before !== null ? `${older} had ${data.before}` : `compared with ${older}`}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">Still broken</p>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">{still.length}</p>
          <p className="text-[11px] text-slate-400">{still.filter((r) => r.bug).length} have a bug</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">Fixed again</p>
          <p className="text-2xl font-semibold text-emerald-700 tabular-nums">{fixed.length}</p>
          <p className="text-[11px] text-slate-400">passed in a later run</p>
        </Card>
      </div>
      <div className={cx("flex flex-wrap gap-2", inReport && "hidden")} role="group" aria-label="Show">
        {(
          [
            ["all", `All ${rows.length}`],
            ["still", `Still broken ${still.length}`],
            ["fixed", `Fixed again ${fixed.length}`],
          ] as const
        ).map(([id, label]) => (
          <Link
            key={id}
            href={`?${qs({ show: id === "all" ? undefined : id })}`}
            aria-current={show === id ? "page" : undefined}
            className={cx("rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset", show === id ? "bg-pink-600 text-white ring-pink-600" : "bg-surface text-slate-700 ring-slate-200 hover:bg-slate-50")}
          >
            {label}
          </Link>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          {rows.length ? "Nothing in this list." : `Nothing that passed in ${older} fails in ${newer}.`}
        </p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Case</th>
                <th className="px-4 py-2 font-medium">Platform</th>
                <th className="px-4 py-2 font-medium">Last passed</th>
                <th className="px-4 py-2 font-medium">Broke in</th>
                <th className="px-4 py-2 font-medium">Now</th>
                <th className="px-4 py-2 font-medium">Bug</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((r) => (
                <tr key={`${r.caseId}-${r.platform}`}>
                  <td className="px-4 py-2">
                    <Link href={r.href} className="hover:underline">
                      <span className="font-mono text-xs text-slate-500">{r.caseKey}</span> {r.title}
                    </Link>
                    {r.automated && (
                      <span className="ml-1 cursor-help" title="From automation" aria-label="Automated">
                        🤖
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-700">{r.platform || "—"}</td>
                  <td className="px-4 py-2 text-xs text-slate-600">{r.lastPassed}</td>
                  <td className="px-4 py-2 text-xs text-slate-600">{r.brokeIn}</td>
                  <td className="px-4 py-2">
                    {r.now === "still" ? (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-red-200">Still broken</span>
                    ) : (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200">Fixed again</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.bug ? (
                      r.bug.url ? (
                        <a href={r.bug.url} target="_blank" rel="noreferrer" className="font-mono text-accent-700 hover:underline">
                          {r.bug.key}
                        </a>
                      ) : (
                        <span className="font-mono">{r.bug.key}</span>
                      )
                    ) : (
                      <span className="text-slate-400">None yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

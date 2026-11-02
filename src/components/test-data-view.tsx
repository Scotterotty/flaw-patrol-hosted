import type { TestData } from "@/lib/test-data";

/** The case page's read-only Test data table. */
export function TestDataView({ data }: { data: TestData }) {
  const n = data.rows.length;
  return (
    <section aria-label="Test data" className="mt-4 rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Test data</h2>
        <span className="text-xs text-slate-500">
          Runs {n === 1 ? "once" : `${n} times`}, once for each row
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Each <code className="rounded bg-violet-100 px-1 text-violet-800">{"{{column}}"}</code> in the steps is filled in from the row being run. The case passes only when every row passes.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-max border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-8" />
              {data.columns.map((c) => (
                <th key={c} className="border-b border-slate-200 px-2 py-1 text-left font-mono text-xs font-medium text-violet-800">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i}>
                <td className="pr-1 text-right font-mono text-xs text-slate-400 tabular-nums">{i + 1}</td>
                {r.map((v, j) => (
                  <td key={j} className="border-b border-slate-100 px-2 py-1 text-slate-800">
                    {v || <span className="text-slate-400">blank</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

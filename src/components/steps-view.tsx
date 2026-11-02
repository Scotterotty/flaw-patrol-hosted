import type { ExpandedStep } from "@/lib/steps";
import { StepText } from "./step-text";
import { StepsTable, actionCell, expectedCell } from "./steps-table";
import { cx } from "./ui";

/** Read-only steps table; consecutive steps from one shared step are grouped, with a line above each of their steps. */
export function StepsView({ steps, projectKey }: { steps: ExpandedStep[]; projectKey: string }) {
  if (!steps.length) return <p className="px-4 py-6 text-sm text-slate-500">No steps yet.</p>;
  const groups: { shared?: ExpandedStep["shared"]; items: ExpandedStep[]; root: string }[] = [];
  for (const s of steps) {
    const root = s.number.split(".")[0];
    const last = groups[groups.length - 1];
    if (s.shared && last?.shared?.id === s.shared.id && last.root === root) last.items.push(s);
    else groups.push({ shared: s.shared, items: [s], root });
  }
  return (
    <StepsTable>
      {groups.map((g, gi) => (
        <tbody key={gi} className={cx("border-b border-slate-100", g.shared && "bg-violet-50/40")}>
          {g.shared && (
            <tr>
              <td />
              <td colSpan={2} className="px-4 pt-2 text-xs wrap-anywhere">
                <span className="rounded bg-violet-100 px-1.5 py-0.5 font-medium text-violet-700">Shared</span>{" "}
                <a className="font-medium text-slate-800 hover:underline" href={`/p/${projectKey}/shared-steps/${g.shared.id}`}>
                  {g.shared.name}
                </a>{" "}
                <span className="text-slate-400">v{g.shared.version}</span>
              </td>
            </tr>
          )}
          {g.items.map((s) => (
            <tr key={s.number} className={cx("align-top", g.shared && "border-t border-violet-200/60")}>
              <td className="px-4 py-2 font-mono text-xs text-slate-500">{s.number}</td>
              <td className={cx("px-4 text-slate-800", actionCell)}>
                <StepText text={s.action} />
              </td>
              <td className={cx("px-4", expectedCell)}>
                <StepText text={s.expected} />
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </StepsTable>
  );
}

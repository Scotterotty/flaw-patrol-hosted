import { isSectionTitle } from "@/lib/step-checks";
import type { ExpandedStep } from "@/lib/steps";
import { StepText } from "./step-text";
import { StepsTable, actionCell, expectedCell } from "./steps-table";
import { cx } from "./ui";

/** Read-only steps table; consecutive steps from one shared step are grouped, with a line above each of their steps. */
export function StepsView({ steps, projectKey }: { steps: ExpandedStep[]; projectKey: string }) {
  if (!steps.length) return <p className="px-4 py-6 text-sm text-slate-500">No steps yet.</p>;
  // Section titles (a step with nothing to check, like "SIGN IN / OUT STEPS") show as a heading row.
  const groups: { shared?: ExpandedStep["shared"]; items: { s: ExpandedStep; at: number; title: boolean }[]; root: string }[] = [];
  steps.forEach((s, at) => {
    const root = s.number.split(".")[0];
    const last = groups[groups.length - 1];
    const item = { s, at, title: isSectionTitle(steps, at) };
    if (s.shared && last?.shared?.id === s.shared.id && last.root === root) last.items.push(item);
    else groups.push({ shared: s.shared, items: [item], root });
  });
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
          {g.items.map(({ s, at, title }) =>
            title ? (
              <tr key={at} className={cx("bg-slate-100/70", g.shared && "border-t border-violet-200/60")}>
                <th scope="rowgroup" colSpan={3} className="px-4 pt-2.5 pb-1.5 text-left text-sm font-bold text-slate-800 wrap-anywhere">
                  {s.action.trim()}
                </th>
              </tr>
            ) : (
            <tr key={at} className={cx("align-top", g.shared && "border-t border-violet-200/60")}>
              <td className="px-4 py-2 font-mono text-xs text-slate-500">{s.number}</td>
              <td className={cx("px-4 text-slate-800", actionCell)}>
                <StepText text={s.action} />
              </td>
              <td className={cx("px-4", expectedCell)}>
                <StepText text={s.expected} />
              </td>
            </tr>
            ),
          )}
        </tbody>
      ))}
    </StepsTable>
  );
}

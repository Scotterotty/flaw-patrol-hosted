import type { ReactNode } from "react";
import { cx } from "./ui";

/**
 * The one table shell every read-only steps list uses (case page, old versions, shared steps).
 * Fixed layout keeps Action and Expected result at an even split, with a divider between them,
 * so a long link or word wraps inside its own column instead of pushing the table wider.
 */
export function StepsTable({ lead, compact, children }: { lead?: boolean; compact?: boolean; children: ReactNode }) {
  const pad = compact ? "px-3" : "px-4";
  return (
    <table className="w-full table-fixed text-sm" data-steps-table>
      <colgroup>
        {lead && <col className="w-10" />}
        <col className={compact ? "w-12" : "w-14"} />
        <col />
        <col />
      </colgroup>
      <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
        <tr>
          {lead && (
            <th className={cx(pad, "py-2")}>
              <span className="sr-only">Select</span>
            </th>
          )}
          <th className={cx(pad, "py-2 font-medium")}>#</th>
          <th className={cx(pad, "py-2 font-medium")}>Action</th>
          <th className={cx(pad, "border-l border-slate-200 py-2 font-medium")}>Expected result</th>
        </tr>
      </thead>
      {children}
    </table>
  );
}

/** Classes for the Action and Expected result cells, so every steps table wraps and divides the same way. */
export const actionCell = "py-2 whitespace-pre-wrap wrap-anywhere";
export const expectedCell = "border-l border-slate-200 py-2 whitespace-pre-wrap wrap-anywhere text-slate-600";

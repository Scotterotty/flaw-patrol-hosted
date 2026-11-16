import Link from "next/link";
import { valuesLabel } from "@/lib/configurations";
import type { planLineFor } from "@/lib/plan-data";

type Line = NonNullable<Awaited<ReturnType<typeof planLineFor>>>;

/**
 * The blue line on a test plan's run: which plan it's part of and its values, with the plan's
 * runs before and after it. `tail` keeps you on the runner ("/execute") when stepping across.
 */
export function PlanLine({ line, projectKey, tail = "" }: { line: Line; projectKey: string; tail?: string }) {
  return (
    <nav aria-label="Test plan" className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800" data-testid="plan-line">
      <span>
        Part of test plan{" "}
        <Link href={`/p/${projectKey}/plans/${line.number}`} className="font-medium underline">
          {line.name}
        </Link>
        {line.values.map((v) => (
          <span key={v.name}>
            {" · "}
            {v.name}: <b>{v.value}</b>
          </span>
        ))}
      </span>
      {(line.prev || line.next) && (
        <span className="flex flex-wrap gap-3">
          {line.prev && (
            <Link href={`/p/${projectKey}/runs/${line.prev.number}${tail}`} className="hover:underline" aria-label={`Previous run in the plan: ${valuesLabel(line.prev.values)}`}>
              ‹ {valuesLabel(line.prev.values)}
            </Link>
          )}
          {line.next && (
            <Link href={`/p/${projectKey}/runs/${line.next.number}${tail}`} className="hover:underline" aria-label={`Next run in the plan: ${valuesLabel(line.next.values)}`}>
              {valuesLabel(line.next.values)} ›
            </Link>
          )}
        </span>
      )}
    </nav>
  );
}

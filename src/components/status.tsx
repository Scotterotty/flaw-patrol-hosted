import Link from "next/link";
import type { ResultStatus } from "@prisma/client";
import type { ReactNode } from "react";
import { STATUSES, STATUS_LABEL, STATUS_STYLE, totals, type StatusCounts } from "@/lib/status";
import { cx } from "./ui";

const ICON: Record<ResultStatus, ReactNode> = {
  PASSED: <path d="M3.5 8.5l3 3 6-7" />,
  FAILED: <path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" />,
  BLOCKED: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M4.1 11.9l7.8-7.8" />
    </>
  ),
  RETEST: (
    <>
      <path d="M12.6 8.6a4.7 4.7 0 1 1-1.5-4" />
      <path d="M11.6 1.9v3h-3" />
    </>
  ),
  SKIPPED: <path d="M3.5 4l4 4-4 4M8.5 4l4 4-4 4" />,
  IN_PROGRESS: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" stroke="none" />
    </>
  ),
  // A compass needle, for exploring (ver_96).
  EXPLORED: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M10.2 5.8l-1.3 3.1-3.1 1.3 1.3-3.1z" />
    </>
  ),
  UNTESTED: <circle cx="8" cy="8" r="5.6" strokeDasharray="2.2 2" />,
};

/**
 * The status's shape (ver_96): check, X, circle-slash, arrow, double chevron, half circle,
 * dashed circle. Hidden unless the person turned on Shapes and patterns (or `always`).
 */
export function StatusIcon({ status, className, always = false }: { status: ResultStatus; className?: string; always?: boolean }) {
  return (
    <svg className={cx(!always && "st-shape", "size-3 flex-none", className)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICON[status]}
    </svg>
  );
}

export function StatusChip({ status, solid, className }: { status: ResultStatus; solid?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        solid ? STATUS_STYLE[status].solid : cx("ring-1 ring-inset", STATUS_STYLE[status].soft),
        className,
      )}
    >
      <StatusIcon status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Stacked bar of status counts, worst outcomes after passed so problems stand out. */
export function StatusBar({ counts, className, height = "h-2" }: { counts: StatusCounts; className?: string; height?: string }) {
  const { total } = totals(counts);
  return (
    <div className={cx("flex w-full gap-[2px] overflow-hidden rounded-full", total === 0 && "bg-slate-100", height, className)} role="img" aria-label={summary(counts)}>
      {total > 0 &&
        STATUSES.map((s) =>
          counts[s] ? (
            <div key={s} className={STATUS_STYLE[s].bar} style={{ width: `${(counts[s] / total) * 100}%` }} title={`${STATUS_LABEL[s]}: ${counts[s]}`} />
          ) : null,
        )}
    </div>
  );
}

export function summary(c: StatusCounts) {
  return STATUSES.filter((s) => c[s]).map((s) => `${c[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(", ") || "No cases";
}

export function StatusLegend({ counts }: { counts: StatusCounts }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {STATUSES.filter((s) => counts[s]).map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <StatusIcon status={s} className={STATUS_STYLE[s].ink} />
          <span className={cx("h-2.5 w-2.5 rounded-sm", STATUS_STYLE[s].bar)} />
          {STATUS_LABEL[s]} <span className="font-semibold text-slate-800 tabular-nums">{counts[s]}</span>
        </li>
      ))}
    </ul>
  );
}

/** Tiny history strip: one square per execution, oldest first. */
export function HistoryStrip({ statuses, max = 20 }: { statuses: { status: ResultStatus; title?: string; href?: string }[]; max?: number }) {
  const shown = statuses.slice(-max);
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {shown.map((s, i) => {
        const cls = cx("st-pip h-3 w-2 rounded-[2px]", STATUS_STYLE[s.status].bar);
        const title = s.title ?? STATUS_LABEL[s.status];
        // A pip with a run behind it opens that run (ver_89).
        return s.href ? (
          <Link key={i} href={s.href} className={cx(cls, "transition hover:scale-y-125 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-500")} title={title} aria-label={`${title}. Open the run`} />
        ) : (
          <span key={i} className={cls} title={title} />
        );
      })}
    </span>
  );
}

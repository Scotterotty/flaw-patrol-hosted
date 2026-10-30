import { cx } from "./ui";

// New and Updated cases in a run (ver_96): the small tag by a case's title.

export function NewsTag({ kind, title, className }: { kind: "new" | "updated"; title?: string; className?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center rounded-full px-2 py-px align-middle text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset",
        kind === "new" ? "bg-sky-50 text-sky-800 ring-sky-200" : "bg-amber-50 text-amber-900 ring-amber-200",
        className,
      )}
    >
      {kind === "new" ? "New" : "Updated"}
    </span>
  );
}

/** The Test runs list's "3 new cases" and "2 updated" tags. */
export function NewsCountTags({ count }: { count?: { new: number; updated: number } }) {
  if (!count) return null;
  return (
    <>
      {count.new > 0 && (
        <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 align-middle text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200 ring-inset" title="Cases never run before">
          {count.new} new {count.new === 1 ? "case" : "cases"}
        </span>
      )}
      {count.updated > 0 && (
        <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 align-middle text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200 ring-inset" title="Cases whose steps changed since their last run">
          {count.updated} updated
        </span>
      )}
    </>
  );
}

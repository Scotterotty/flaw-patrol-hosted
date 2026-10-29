import Link from "next/link";
import { cx } from "./ui";

/** List | Risk board (ver_93): two views of the same Jira requirements. */
export function RequirementsViews({ base, current, release }: { base: string; current: "list" | "risk"; release?: string }) {
  const q = release ? `?release=${encodeURIComponent(release)}` : "";
  const tab = (id: "list" | "risk", label: string, href: string) => (
    <Link href={href} aria-current={current === id ? "page" : undefined} className={cx("rounded-md px-3 py-1 text-sm", current === id ? "bg-surface font-medium text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}>
      {label}
    </Link>
  );
  return (
    <nav aria-label="Requirements view" className="mb-4 inline-flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
      {tab("list", "List", `${base}/stories${q}`)}
      {tab("risk", "Risk board", `${base}/risk${q}`)}
    </nav>
  );
}

import Link from "next/link";

/** Run page header: where this test cycle's Slack alerts go. Hover or focus for what posts; leads click through to the settings. */
export function SlackBell({ channels, href }: { channels: { name: string; what: string }[]; href: string | null }) {
  const label = `Slack: ${channels.map((c) => c.name).join(", ")}`;
  const tip = channels.map((c) => `${c.name}: ${c.what}`).join("\n");
  const cls = "group relative inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-surface px-2.5 text-xs text-slate-600 hover:bg-slate-50 focus:outline-2 focus:outline-accent-600";
  const body = (
    <>
      <span aria-hidden>🔔</span>
      <span className="max-w-48 truncate">{label}</span>
      <span role="tooltip" className="pointer-events-none absolute top-full right-0 z-20 mt-1 hidden w-72 rounded-md border border-slate-200 bg-surface p-2 text-left whitespace-pre-line text-slate-700 shadow-md group-hover:block group-focus:block">
        {tip}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className={cls} aria-label={`${label}. ${tip.replace(/\n/g, ". ")}. Open Slack settings`}>
      {body}
    </Link>
  ) : (
    <span tabIndex={0} className={cls} aria-label={`${label}. ${tip.replace(/\n/g, ". ")}`}>
      {body}
    </span>
  );
}

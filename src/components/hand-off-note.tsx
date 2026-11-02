"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CopyText } from "./copy-text";

/**
 * After a lead starts a run with every case assigned to someone else:
 * say it worked and give them the run's link to send that tester.
 */
export function HandOffNote({ runLabel, cases, name }: { runLabel: string; cases: number; name: string }) {
  const router = useRouter();
  const path = usePathname();
  const [url, setUrl] = useState(path);
  useEffect(() => setUrl(`${window.location.origin}${path}`), [path]);
  const first = name.split(/\s+/)[0] || name;
  return (
    <div role="status" className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" data-testid="hand-off">
      <span className="min-w-0 flex-1">
        ✓ Started {runLabel} with {cases} {cases === 1 ? "case" : "cases"} for <b>{name}</b>. No email goes out, so send them the link.
        <span className="mt-1 block truncate font-mono text-xs text-emerald-800">{url}</span>
      </span>
      <CopyText text={url} label={`Copy link for ${first}`} />
      <button type="button" aria-label="Hide this note" className="text-emerald-800 hover:text-emerald-950" onClick={() => router.replace(path, { scroll: false })}>
        ✕
      </button>
    </div>
  );
}

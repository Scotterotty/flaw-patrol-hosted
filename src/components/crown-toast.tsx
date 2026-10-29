"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ackCrowns, wearCrown } from "@/server/account";

export type CrownChange = { id: string; kind: "took" | "lost"; label: string; umbrella: string; titleId?: string; line: string; sub: string };

/**
 * Mini game crowns (ver_96): a one-time note on the next page after you take a crown or
 * someone takes yours. Seen as soon as it shows; no email or Slack.
 */
export function CrownToaster({ changes, held }: { changes: CrownChange[]; held: string[] }) {
  const router = useRouter();
  const [shown, setShown] = useState(changes);
  const [, start] = useTransition();
  useEffect(() => {
    void ackCrowns(held);
    // Only once per page load with these changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!shown.length) return null;
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-16 z-50 flex flex-col items-end gap-2 md:bottom-4" data-testid="crown-toasts">
      {shown.map((c) => (
        <div key={c.id} className="pointer-events-auto flex max-w-sm items-start gap-3 rounded-lg bg-slate-900 px-3.5 py-2.5 text-slate-50 shadow-lg">
          <span aria-hidden className="text-2xl leading-none">
            {c.kind === "took" ? "👑" : "🫥"}
          </span>
          <span className="min-w-0 text-sm">
            <strong className="block font-semibold">{c.line}</strong>
            <span className="block text-xs opacity-75">{c.sub}</span>
            {c.kind === "took" && c.titleId && (
              <button
                type="button"
                className="mt-1.5 rounded bg-amber-300 px-2 py-0.5 text-xs font-semibold text-slate-900 hover:bg-amber-200"
                onClick={() =>
                  start(async () => {
                    await wearCrown(c.titleId!);
                    setShown((s) => s.filter((x) => x.id !== c.id));
                    router.refresh();
                  })
                }
              >
                Wear it next to your name
              </button>
            )}
          </span>
          <button type="button" onClick={() => setShown((s) => s.filter((x) => x.id !== c.id))} aria-label="Dismiss" className="ml-1 text-xs opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

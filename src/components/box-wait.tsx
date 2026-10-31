"use client";

import { LoadingSpinner } from "./loading-spinner";
import { Button } from "./ui";

/**
 * What a box shows while it gets its data (ver_120): your spinner at 36 px and what it's getting,
 * or a Try again if that failed. It marks itself data-own-spinner so the corner spinner stays hidden.
 */
export function BoxWait({ failed, onRetry, testId, compact, children }: { failed: boolean; onRetry: () => void; testId: string; compact?: boolean; children: React.ReactNode }) {
  const pad = compact ? "py-4" : "py-10";
  if (failed)
    return (
      <div role="alert" data-testid={`${testId}-failed`} className={`grid justify-items-center gap-3 text-center text-sm text-slate-700 ${pad}`}>
        <p>Couldn&apos;t load this. Check your connection and try again.</p>
        <Button onClick={onRetry}>Try again</Button>
      </div>
    );
  return (
    <div role="status" data-own-spinner="" data-testid={testId} className={`grid justify-items-center gap-3 text-center text-sm text-slate-700 ${pad}`}>
      <LoadingSpinner size={36} />
      <p>{children}</p>
    </div>
  );
}

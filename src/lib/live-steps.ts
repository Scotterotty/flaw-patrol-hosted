import { useSyncExternalStore } from "react";
import type { ResultStatus } from "@prisma/client";

// The open case's step results as the runner has them right now, so the run list's
// pips keep up while the page itself is held from refreshing (see holdLive). Browser-only.
type Live = { entryId: string; steps: ResultStatus[]; at: string } | null;
let live: Live = null;
const listeners = new Set<() => void>();

export function publishLiveSteps(entryId: string, steps: ResultStatus[] | null) {
  if (!steps) {
    if (live?.entryId !== entryId) return;
    live = null;
  } else live = { entryId, steps, at: new Date().toISOString() };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The runner's live step results for this case, or null when it isn't the one open. */
export function useLiveSteps(entryId: string): Live {
  const l = useSyncExternalStore(subscribe, () => live, () => null);
  return l?.entryId === entryId ? l : null;
}

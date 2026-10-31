import { useSyncExternalStore } from "react";
import type { ResultStatus } from "@prisma/client";

// Run list rows as the last live check found them (ver_112), so other people's progress shows
// within a second or so without reloading the page, and keeps showing while you're filling in a
// case (when the page itself is held from refreshing, see holdLive). Browser-only.
export type LiveRow = {
  id: string;
  status: ResultStatus;
  assigneeId: string | null;
  progress: ResultStatus[] | null;
  lastChange: { name: string; at: string; mine: boolean; saved?: boolean } | null;
};

// `at` is the server's clock when the check read the rows. A row only wins over what the page
// drew when it was read after the page was (renderedAt), so your own Save never flicks back.
type Snap = { at: number; rows: Map<string, LiveRow> };
let snap: Snap | null = null;
const listeners = new Set<() => void>();

export function publishLiveRows(at: number, rows: LiveRow[]) {
  snap = { at, rows: new Map(rows.map((r) => [r.id, r])) };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Live rows newer than the page drawn at `renderedAt`, or null when the page is current. */
export function useLiveRows(renderedAt: number): Map<string, LiveRow> | null {
  const s = useSyncExternalStore(subscribe, () => snap, () => null);
  return s && s.at > renderedAt ? s.rows : null;
}

/** One row's live state, when it's newer than the page. */
export function useLiveRow(id: string, renderedAt: number): LiveRow | null {
  return useLiveRows(renderedAt)?.get(id) ?? null;
}

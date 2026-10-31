"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { liveHeld } from "@/lib/live-hold";
import { publishLiveRows, type LiveRow } from "@/lib/live-rows";

// Every second (2 until ver_112): a check is one small query, and only a change fetches more.
const EVERY_MS = 1000;
// With live rows the list is already current, so the full reload (counts, totals) can wait a little:
// at most one every 5 seconds instead of one per check while someone marks steps.
const REFRESH_GAP_MS = 5000;

/**
 * Keeps a page current with other people's changes: polls a small fingerprint
 * and refreshes the page's data when it changes. Pauses while the tab is
 * hidden and while a form on the page has unsaved input (holdLive).
 * With `rows`, a change also brings the run's rows, so run lists update straight
 * away, even while the refresh is held (ver_112).
 * `renderedAt` (server time the page was drawn) skips a reload the page doesn't need: after
 * Save and next, say, the new case was drawn after your own save already.
 */
export function LiveRefresh({ url, rows = false, renderedAt }: { url: string; rows?: boolean; renderedAt?: number }) {
  const router = useRouter();
  const drawnAt = useRef(renderedAt);
  useEffect(() => {
    drawnAt.current = renderedAt;
  }, [renderedAt]);

  useEffect(() => {
    let known: string | null = null;
    // The fingerprint the live rows last came with; separate from `known`, which a hold keeps old.
    let rowsV: string | null = null;
    let refreshedAt = 0;
    // The page drawing the last check saw; a newer one means the page was redrawn since.
    let seenDraw = drawnAt.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const check = async () => {
      if (!document.hidden) {
        try {
          const ask = rows && (rowsV ?? known);
          const res = await fetch(ask ? `${url}?rows=${encodeURIComponent(ask)}` : url, { cache: "no-store" });
          const body = res.ok ? ((await res.json()) as { v: string; at?: number; latest?: number; rows?: LiveRow[] }) : null;
          const v = body?.v ?? null;
          if (v && body?.rows && body.at) publishLiveRows(body.at, body.rows);
          if (v && rows) rowsV = v;
          // Redrawn since the last check, after the run's latest change: the page already shows it.
          const redrawn = drawnAt.current !== seenDraw;
          seenDraw = drawnAt.current;
          const shown = redrawn && !!drawnAt.current && body?.latest !== undefined && body.latest <= drawnAt.current;
          const changed = !!v && !!known && v !== known && !shown;
          const canRefresh = !liveHeld() && (!rows || Date.now() - refreshedAt >= REFRESH_GAP_MS);
          if (changed && canRefresh) {
            router.refresh();
            refreshedAt = Date.now();
          }
          // While held or waiting, keep the old fingerprint so the change is picked up later.
          if (v && (!known || !changed || canRefresh)) known = v;
        } catch {
          // Offline or the server restarted; try again next time.
        }
      }
      if (!stopped) timer = setTimeout(check, EVERY_MS);
    };
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void check();
      }
    };

    void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, rows, router]);

  return null;
}

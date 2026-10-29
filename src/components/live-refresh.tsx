"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { liveHeld } from "@/lib/live-hold";

const EVERY_MS = 2000;

/**
 * Keeps a page current with other people's changes: polls a small fingerprint
 * and refreshes the page's data when it changes. Pauses while the tab is
 * hidden and while a form on the page has unsaved input (holdLive).
 */
export function LiveRefresh({ url }: { url: string }) {
  const router = useRouter();

  useEffect(() => {
    let known: string | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const check = async () => {
      if (!document.hidden) {
        try {
          const res = await fetch(url, { cache: "no-store" });
          const { v } = res.ok ? ((await res.json()) as { v: string }) : { v: null };
          if (v && known && v !== known && !liveHeld()) router.refresh();
          // While held, keep the old fingerprint so the change is picked up once it's released.
          if (v && (!known || !liveHeld())) known = v;
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
  }, [url, router]);

  return null;
}

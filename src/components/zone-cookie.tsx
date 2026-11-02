"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ZONE_COOKIE } from "@/lib/zone";

/**
 * Saves the browser's time zone in a cookie (ver_137) so pages show times on your own clock.
 * When the page was drawn with another zone (first visit, or you traveled), it redraws once.
 */
export function ZoneCookie({ zone }: { zone: string }) {
  const router = useRouter();
  useEffect(() => {
    let mine = "";
    try {
      mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!mine || mine === zone) return;
    document.cookie = `${ZONE_COOKIE}=${encodeURIComponent(mine)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [zone, router]);
  return null;
}

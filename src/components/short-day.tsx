"use client";

import { shortDate } from "@/lib/spelling";
import { useSpelling, useZone } from "./spelling";

/** "Nov 12" on the viewer's own clock and spelling, for server-drawn tables. */
export function ShortDay({ at }: { at: Date | string }) {
  return <>{shortDate(new Date(at), useSpelling(), useZone())}</>;
}

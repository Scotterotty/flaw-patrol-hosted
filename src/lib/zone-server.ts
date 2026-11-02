import "server-only";
import { cookies } from "next/headers";
import { dateRange, type Spelling } from "./spelling";
import { cleanZone, rangeDays, ZONE_COOKIE } from "./zone";

/** The signed-in viewer's time zone, from the cookie their browser set; UTC until it has. */
export async function viewerZone() {
  try {
    return cleanZone((await cookies()).get(ZONE_COOKIE)?.value);
  } catch {
    return "UTC";
  }
}

/** A report's date range on the viewer's clock, in their Language setting. */
export async function reportRange(from: Date, to: Date, typed: { from?: string; to?: string }, spelling: Spelling) {
  const d = rangeDays(from, to, typed, await viewerZone());
  return dateRange(d.from, d.to, spelling);
}

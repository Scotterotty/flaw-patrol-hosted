// The Reports page filters a saved view keeps, in a stable order.
export const REPORT_KEYS = ["view", "range", "from", "to", "suite", "release", "run", "priority", "tag", "folder", "tester", "persona", "charter", "kinds", "open", "runs", "kind", "platform"] as const;

/** Keep only report filters, drop empty ones; "" when nothing is set. */
export function cleanReportQuery(input: string | Record<string, string | undefined>) {
  const src = typeof input === "string" ? Object.fromEntries(new URLSearchParams(input.replace(/^\?/, ""))) : input;
  const out = new URLSearchParams();
  for (const k of REPORT_KEYS) {
    const v = src[k]?.trim();
    if (v) out.set(k, v.slice(0, 200));
  }
  return out.toString();
}

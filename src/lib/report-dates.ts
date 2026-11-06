/**
 * Whether a report's dates were changed from the usual last 30 days, for the Filter (n) count
 * (ver_187). The form sends its From and To boxes with every change, so matching the defaults
 * doesn't count, and a release ignores the dates. Same defaults as parseFilters in reports.ts.
 */
export function datesChanged(sp: Record<string, string | undefined>, now = new Date()): boolean {
  if (sp.release) return false;
  if (sp.range === "all") return true;
  const today = now.toISOString().slice(0, 10);
  const to = sp.to ? new Date(`${sp.to}T23:59:59.999Z`) : now;
  const usualFrom = isNaN(to.getTime()) ? "" : new Date(to.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
  return (!!sp.to && sp.to !== today) || (!!sp.from && sp.from !== usualFrom);
}

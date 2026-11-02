import "server-only";
import { NOT_BASH_RUN } from "./bash-cases";
import { db } from "./db";
import { TOOL_IDS, type ToolId } from "./tools";
import type { Umbrella } from "./umbrella";

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const and = (parts: string[]) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

/** What each of these tools holds in the umbrella, like "86 cases and 4 suites"; tools with nothing are left out. */
export async function toolHoldings(u: Umbrella, which: readonly ToolId[]): Promise<Partial<Record<ToolId, string>>> {
  if (!which.length) return {};
  const ids = [u.hub.id, ...u.projects.map((p) => p.id)];
  const want = (t: ToolId) => which.includes(t);
  const [runs, bashes, ratings, autoRuns] = await Promise.all([
    want("runs") ? db.testRun.count({ where: { projectId: { in: ids }, automated: false, ...NOT_BASH_RUN } }) : 0,
    want("bashes") ? db.bugBash.count({ where: { projectId: { in: ids } } }) : 0,
    want("risk") ? db.riskRating.count({ where: { projectId: u.hub.id } }) : 0,
    want("auto") ? db.testRun.count({ where: { projectId: { in: ids }, automated: true } }) : 0,
  ]);
  const c = u.counts;
  const parts = (list: [number, string, string?][]) => and(list.filter(([k]) => k > 0).map(([k, one, many]) => n(k, one, many)));
  const all: Partial<Record<ToolId, string>> = {
    cases: parts([
      [c.cases, "case"],
      [c.suites, "suite"],
      [c.shared, "shared step"],
    ]),
    runs: parts([
      [runs, "run"],
      [u.projects.length, "test cycle"],
    ]),
    charters: parts([
      [c.charters, "charter"],
      [c.personas, "persona"],
    ]),
    bashes: bashes ? n(bashes, "bug bash", "bug bashes") : "",
    risk: ratings ? n(ratings, "risk rating") : "",
    auto: parts([
      [autoRuns, "automated run"],
      [c.repos, "connected repository", "connected repositories"],
    ]),
  };
  return Object.fromEntries(Object.entries(all).filter(([t, v]) => v && want(t as ToolId)));
}

/**
 * For each tool that's off, what it still holds, like "The 14 runs from before are safe."
 * Only asked for when a tool is off, so umbrellas with every tool pay nothing.
 */
export async function keptLines(u: Umbrella): Promise<Partial<Record<ToolId, string>>> {
  const held = await toolHoldings(
    u,
    TOOL_IDS.filter((t) => !u.tools.includes(t)),
  );
  return Object.fromEntries(
    Object.entries(held).map(([t, v]) => [t, `The ${v} from before ${v!.startsWith("1 ") && !v!.includes(" and ") ? "is" : "are"} safe.`]),
  );
}

/** What the old-link note needs. */
export async function gateInfo(u: Umbrella) {
  return { g: u.group.id, hub: u.hub.key, cycles: u.projects.map((p) => p.key), name: u.group.name, tools: u.tools, canTurnOn: u.role === "ADMIN" && !u.group.archivedAt, kept: await keptLines(u) };
}

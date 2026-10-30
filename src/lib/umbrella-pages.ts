import "server-only";
import { db } from "./db";
import { isSevere } from "./severity";
import { severityScaleFor } from "./severity-server";
import { rcGlanceLine } from "@/server/rc-status";
import { OPEN_BUG, type Shortcut, type Umbrella } from "./umbrella";

/** The numbers on the umbrella home's shortcut row, for one viewer. */
export async function hubCounts(u: Umbrella, userId: string) {
  const ids = [u.hub.id, ...u.projects.map((p) => p.id)];
  const [mine, bugs, flagged] = await Promise.all([
    db.runEntry.count({ where: { assigneeId: userId, status: { in: ["UNTESTED", "RETEST", "IN_PROGRESS"] }, run: { projectId: { in: ids }, state: "ACTIVE" } } }),
    db.defect.findMany({ where: { projectId: { in: ids }, ...OPEN_BUG }, select: { id: true, externalKey: true, severity: true } }),
    db.testCase.count({ where: { projectId: u.hub.id, archived: false, flag: { not: null } } }),
  ]);
  const scale = await severityScaleFor(u.hub.id);
  const critical = new Set(bugs.filter((b) => isSevere(b.severity, scale)).map((b) => b.externalKey ?? b.id)).size;
  return { mine, critical, flagged };
}

/** The umbrella's latest RC at a glance, such as "RC 22 · 1 of 3 done": counted, not the whole report (ver_100). */
export const rcGlance = (u: Umbrella) =>
  rcGlanceLine(
    [u.hub.id, ...u.projects.map((p) => p.id)],
    u.platforms.map((p) => p.name),
  );

/** Saved shortcuts from before ver_70 point at the old all-projects Release status page. */
export const freshShortcut = (u: Umbrella, s: Shortcut): Shortcut =>
  s.href === "/rc" ? { ...s, label: "Release status", href: `/g/${u.group.id}/rc` } : s.label === "RC status" ? { ...s, label: "Release status" } : s; // RC status became Release status in ver_94

/** Every page the shortcut editor offers: the hub's, each current project's, their active runs and shared saved reports. */
export async function shortcutChoices(u: Umbrella, release: string | Promise<string> = "Quick view of each release") {
  const g = `/g/${u.group.id}`;
  const hub = `/p/${u.hub.key}`;
  const n = (count: number, word: string) => `${count} ${word}`;
  // The release line can still be loading (ver_100): it's waited for alongside this page's own queries.
  const [runs, saved, rc] = await Promise.all([
    db.testRun.findMany({ where: { projectId: { in: u.current.map((p) => p.id) }, state: "ACTIVE" }, orderBy: { createdAt: "desc" }, select: { projectId: true, number: true, name: true } }),
    db.savedReport.findMany({ where: { projectId: { in: [u.hub.id, ...u.current.map((p) => p.id)] }, shared: true }, select: { projectId: true, name: true, query: true } }),
    release,
  ]);
  const sections: { section: string; items: Shortcut[] }[] = [
    {
      section: `${u.group.name} hub`,
      items: [
        { label: "Test runs", sub: n(u.counts.activeRuns, "active"), href: `${g}/runs`, icon: "play" },
        { label: "Case library", sub: n(u.counts.cases, u.counts.cases === 1 ? "case" : "cases"), href: `${hub}/cases`, icon: "book" },
        { label: "Suites", sub: String(u.counts.suites), href: `${hub}/suites`, icon: "layers" },
        { label: "Shared steps", sub: String(u.counts.shared), href: `${hub}/shared-steps`, icon: "link" },
        { label: "Bugs", sub: n(u.counts.openBugs, "open"), href: `${g}/bugs`, icon: "bug" },
        { label: "Critical bugs", sub: "Showstoppers and criticals", href: `${g}/bugs?sev=critical`, icon: "bug" },
        { label: "Release status", sub: rc, href: `${g}/rc`, icon: "chart" },
        { label: "My assigned cases", sub: "For whoever opens it", href: `${g}/runs?mine=1`, icon: "user" },
        { label: "Flagged cases", sub: "Cases to fix", href: `${hub}/cases?flagged=1`, icon: "folder" },
        { label: "Reports", sub: "Each test cycle's reports", href: `${g}/reports`, icon: "chart" },
        { label: "Import cases", sub: `Into the ${u.group.name} case library`, href: `${hub}/import`, icon: "down" },
        { label: "Settings", sub: `${u.group.name} settings`, href: `${g}/settings`, icon: "cog" },
      ],
    },
  ];
  for (const p of u.current) {
    const short = p.platform || p.name;
    const base = `/p/${p.key}`;
    sections.push({
      section: p.name,
      items: [
        { label: `${short} · Test runs`, sub: n(p._count.runs, "active"), href: `${base}/runs`, icon: "play" },
        ...runs.filter((r) => r.projectId === p.id).map((r) => ({ label: `${short} · ${r.name}`, sub: `R${r.number} · run in progress`, href: `${base}/runs/${r.number}`, icon: "play" as const })),
        { label: `${short} · Reports`, sub: `${short} only`, href: `${base}/reports`, icon: "chart" },
        ...saved.filter((s) => s.projectId === p.id).map((s) => ({ label: `${short} · ${s.name}`, sub: "Saved report", href: `${base}/reports?${s.query}`, icon: "chart" as const })),
        { label: `${short} · Bugs`, sub: "Bugs", href: `${base}/bugs`, icon: "bug" },
        { label: `${short} · Settings`, sub: "Test cycle settings", href: `${base}/settings`, icon: "cog" },
      ],
    });
  }
  return sections;
}

/** The card's shortcuts before anyone has picked any. */
export function defaultShortcuts(u: Umbrella): Shortcut[] {
  const g = `/g/${u.group.id}`;
  return [
    { label: "Test runs", sub: `${u.counts.activeRuns} active`, href: `${g}/runs`, icon: "play" },
    { label: "Case library", sub: `${u.counts.cases}`, href: `/p/${u.hub.key}/cases`, icon: "book" },
    { label: "Bugs", sub: `${u.counts.openBugs} open`, href: `${g}/bugs`, icon: "bug" },
    { label: "Release status", sub: "Quick view of each release", href: `${g}/rc`, icon: "chart" },
  ];
}

import "server-only";
import { bugsByPlatform, platformLine, plusOnesOf } from "./bash";
import { noteCounts, parseCharter, parsePersona, parseSessionLog } from "./charter";
import { db } from "./db";
import { releaseKey } from "./rc-status";

// Wrap-ups: bug bash reports and exploring sessions you can attach to Release
// status and every Reports tab. They never touch a pass rate; they show as their own
// section, "Exploring and bug bashes · Not counted in pass rates".

export type WrapUp = {
  /** "bash:<bash id>" or "explore:<result id>". */
  id: string;
  type: "bash" | "explore";
  title: string;
  href: string;
  at: string;
  who: string;
  minutes: number;
  limit: number;
  people: number;
  bugs: number;
  notes: number;
  questions: number;
  summary: string;
  persona: string;
  worst: string;
  /** The release a bash counts toward, picked by name (ver_152); "" when none. */
  release?: string;
  /** "Web 4, iOS 5": bugs per platform, when people said (ver_146). */
  platforms?: string;
};

/** Saved per person: which wrap-ups a report carries, and whether new ones join by themselves. */
export type WrapPick = { ids: string[]; auto: boolean };
export function wrapPickOf(prefs: unknown, key: string): WrapPick {
  const all = prefs && typeof prefs === "object" ? (prefs as { wrapUps?: Record<string, WrapPick> }).wrapUps : undefined;
  const p = all?.[key];
  return { ids: Array.isArray(p?.ids) ? p.ids.filter((x): x is string => typeof x === "string") : [], auto: p?.auto === true };
}
export const rcWrapKey = (scope: string, release: string) => `rc|${scope}|${releaseKey(release)}`;
export const reportsWrapKey = (scope: string) => `reports|${scope}`;

/** When a release started in these projects: its first run, else null. */
export async function releaseStart(projectIds: string[], release: string) {
  const runs = await db.testRun.findMany({ where: { projectId: { in: projectIds }, release: { not: "" } }, select: { release: true, createdAt: true }, orderBy: { createdAt: "asc" } });
  return runs.find((r) => releaseKey(r.release) === releaseKey(release))?.createdAt ?? null;
}

/**
 * Wrap-ups in these projects, newest first: finished bug bashes, and exploring sessions
 * saved outside bashes. `since`/`until` bound when they happened; `ids` picks exact ones.
 */
export async function listWrapUps(projectIds: string[], opts: { since?: Date; until?: Date; ids?: string[] }): Promise<WrapUp[]> {
  if (!projectIds.length) return [];
  const bashIds = opts.ids?.filter((i) => i.startsWith("bash:")).map((i) => i.slice(5));
  const resultIds = opts.ids?.filter((i) => i.startsWith("explore:")).map((i) => i.slice(8));
  const when = { ...(opts.since && { gte: opts.since }), ...(opts.until && { lte: opts.until }) };
  const now = new Date();
  const [bashes, results] = await Promise.all([
    bashIds && !bashIds.length
      ? []
      : db.bugBash.findMany({
          where: {
            OR: [{ projectId: { in: projectIds } }, { run: { projectId: { in: projectIds } } }],
            startsAt: { lte: now },
            ...(bashIds ? { id: { in: bashIds } } : { startsAt: { ...when, lte: opts.until ?? now } }),
          },
          orderBy: { startsAt: "desc" },
          take: 100,
          select: {
            id: true,
            name: true,
            startsAt: true,
            minutes: true,
            endedAt: true,
            endsAt: true,
            createdBy: true,
            release: true,
            platforms: true,
            project: { select: { key: true } },
            _count: { select: { people: true } },
            items: { where: { mergedIntoId: null, kind: { in: ["bug", "note", "question"] } }, select: { kind: true, text: true, severity: true, platform: true, plusOnes: true } },
          },
        }),
    resultIds && !resultIds.length
      ? []
      : db.testResult.findMany({
          where: {
            run: { projectId: { in: projectIds }, bugBash: null },
            entry: { kind: "EXPLORATORY" },
            ...(resultIds ? { id: { in: resultIds } } : { createdAt: when }),
          },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: { id: true, createdAt: true, testerName: true, elapsedSec: true, comment: true, sessionLog: true, run: { select: { number: true, name: true, project: { select: { key: true } } } }, entry: { select: { title: true, charter: true, persona: true } } },
        }),
  ]);
  const ORDER = ["SHOWSTOPPER", "CRITICAL", "PROBLEMATIC", "MINOR", "ENHANCEMENT"];
  const fromBashes: WrapUp[] = bashes.map((b) => {
    const bugs = b.items.filter((i) => i.kind === "bug");
    const worst = [...bugs].sort((x, y) => ORDER.indexOf(x.severity) - ORDER.indexOf(y.severity))[0];
    const end = b.endedAt ?? (b.endsAt < now ? b.endsAt : now);
    return {
      id: `bash:${b.id}`,
      type: "bash",
      title: b.name,
      href: `/p/${b.project.key}/bashes/${b.id}/report`,
      at: b.startsAt.toISOString(),
      who: b.createdBy,
      minutes: Math.max(0, Math.round((end.getTime() - b.startsAt.getTime()) / 60_000)),
      limit: b.minutes,
      people: b._count.people,
      bugs: bugs.length,
      notes: b.items.filter((i) => i.kind === "note").length,
      questions: b.items.filter((i) => i.kind === "question").length,
      summary: "",
      persona: "",
      worst: worst ? `${worst.text} (${worst.severity.toLowerCase()})` : "",
      release: b.release,
      platforms: platformLine(bugsByPlatform(bugs.map((i) => ({ platform: i.platform, severity: i.severity, plusOnes: plusOnesOf(i.plusOnes) })), b.platforms)),
    };
  });
  const fromSessions: WrapUp[] = results.map((r) => {
    const c = noteCounts(parseSessionLog(r.sessionLog));
    const persona = parsePersona(r.entry.persona);
    return {
      id: `explore:${r.id}`,
      type: "explore",
      title: r.run.name.startsWith("Explore: ") ? r.run.name : `Explore: ${r.entry.title}`,
      href: `/p/${r.run.project.key}/runs/${r.run.number}`,
      at: r.createdAt.toISOString(),
      who: r.testerName,
      minutes: Math.round((r.elapsedSec ?? 0) / 60),
      limit: parseCharter(r.entry.charter).minutes,
      people: 1,
      bugs: c.bug,
      notes: c.note,
      questions: c.question,
      summary: r.comment,
      persona: persona ? `${persona.emoji} ${persona.name}` : "",
      worst: "",
    };
  });
  return [...fromBashes, ...fromSessions].sort((a, b) => b.at.localeCompare(a.at));
}

/** What a report carries: the ones ticked, plus every one since `autoSince` when "attach new ones" is on. */
export async function attachedWrapUps(projectIds: string[], pick: WrapPick, autoSince: Date | null) {
  const [ticked, auto] = await Promise.all([pick.ids.length ? listWrapUps(projectIds, { ids: pick.ids }) : [], pick.auto && autoSince ? listWrapUps(projectIds, { since: autoSince }) : []]);
  const seen = new Set<string>();
  return [...ticked, ...auto].filter((w) => !seen.has(w.id) && !!seen.add(w.id)).sort((a, b) => b.at.localeCompare(a.at));
}

/** Bashes counted toward this release by name (ver_152): they join its Release status by themselves. */
export async function countedBashWrapUps(projectIds: string[], release: string) {
  if (!projectIds.length || !release.trim()) return [];
  const rows = await db.bugBash.findMany({
    where: { release: { not: "" }, OR: [{ projectId: { in: projectIds } }, { run: { projectId: { in: projectIds } } }] },
    select: { id: true, release: true },
    take: 500,
  });
  const ids = rows.filter((b) => releaseKey(b.release) === releaseKey(release)).map((b) => `bash:${b.id}`);
  return ids.length ? listWrapUps(projectIds, { ids }) : [];
}

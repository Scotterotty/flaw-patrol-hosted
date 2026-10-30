import "server-only";
import { ITEM_KINDS, parseAreas, parseLinks, phaseOf, plusOnesOf } from "./bash";
import { db } from "./db";

// Live finds (ver_96): what the Log a bug page's panel polls every 2 seconds, apart from the
// page itself, so it keeps filling in while someone types.

export async function bashFinds(bashId: string) {
  const bash = await db.bugBash.findUnique({
    where: { id: bashId },
    select: {
      projectId: true,
      startsAt: true,
      endsAt: true,
      endedAt: true,
      wrappedAt: true,
      areas: true,
      links: true,
      people: { select: { userId: true, name: true, areaId: true } },
      items: {
        where: { kind: { in: [...ITEM_KINDS, "add"] }, mergedIntoId: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, areaId: true, kind: true, replyToId: true, text: true, details: true, severity: true, byId: true, byName: true, plusOnes: true, defectId: true, createdAt: true, attachments: { select: { id: true, fileName: true, contentType: true } } },
      },
    },
  });
  if (!bash) return null;
  const defects = await db.defect.findMany({ where: { id: { in: bash.items.map((i) => i.defectId).filter((x): x is string => !!x) } }, select: { id: true, number: true, externalKey: true, externalUrl: true } });
  const keyOf = new Map(defects.map((d) => [d.id, { key: d.externalKey ?? `D-${d.number}`, url: d.externalUrl }]));
  const adds = bash.items.filter((i) => i.kind === "add");
  return {
    projectId: bash.projectId,
    phase: phaseOf(bash),
    areas: parseAreas(bash.areas).map((a) => ({ id: a.id, name: a.name, links: a.links, people: bash.people.filter((p) => p.areaId === a.id).map((p) => ({ id: p.userId, name: p.name })) })),
    links: parseLinks(bash.links),
    items: bash.items
      .filter((i) => i.kind !== "add")
      .map((i) => ({
        id: i.id,
        areaId: i.areaId,
        kind: i.kind as (typeof ITEM_KINDS)[number],
        text: i.text,
        details: i.details,
        severity: i.severity,
        byId: i.byId,
        byName: i.byName,
        plusOnes: plusOnesOf(i.plusOnes),
        at: i.createdAt.toISOString(),
        attachments: i.attachments,
        bug: i.defectId ? (keyOf.get(i.defectId) ?? null) : null,
        adds: adds
          .filter((a) => a.replyToId === i.id)
          .reverse()
          .map((a) => ({ id: a.id, byId: a.byId, byName: a.byName, text: a.text, at: a.createdAt.toISOString() })),
      })),
  };
}
export type BashFinds = NonNullable<Awaited<ReturnType<typeof bashFinds>>>;
export type LiveFind = BashFinds["items"][number];

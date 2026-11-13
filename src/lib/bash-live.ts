import "server-only";
import { createHash } from "node:crypto";
import { ITEM_KINDS, parseAreas, parseLinks, phaseOf, plusOnesOf } from "./bash";
import { findTemplate } from "./bash-template";
import { withOko } from "./bash-oko";
import { bashOkoFor } from "./bash-oko-data";
import { db } from "./db";

// Live finds: what the Log a bug page's panel polls every 2 seconds, apart from the
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
      run: { select: { build: true, environment: true, projectId: true } },
      people: { select: { userId: true, name: true, areaId: true } },
      items: {
        where: { kind: { in: [...ITEM_KINDS, "add"] }, mergedIntoId: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, areaId: true, kind: true, replyToId: true, text: true, details: true, severity: true, byId: true, byName: true, plusOnes: true, defectId: true, templateName: true, layout: true, answers: true, platform: true, build: true, review: true, reviewReason: true, createdAt: true, attachments: { select: { id: true, fileName: true, contentType: true, size: true } } },
      },
    },
  });
  if (!bash) return null;
  const defects = await db.defect.findMany({ where: { id: { in: bash.items.map((i) => i.defectId).filter((x): x is string => !!x) } }, select: { id: true, number: true, externalKey: true, externalUrl: true } });
  const keyOf = new Map(defects.map((d) => [d.id, { key: d.externalKey ?? `D-${d.number}`, url: d.externalUrl }]));
  const adds = bash.items.filter((i) => i.kind === "add");
  const oko = bash.run ? await bashOkoFor(bash.run.projectId) : null;
  return {
    projectId: bash.projectId,
    phase: phaseOf(bash),
    areas: parseAreas(bash.areas).map((a) => ({ id: a.id, name: a.name, links: a.links, addedAt: a.addedAt ?? null, people: bash.people.filter((p) => p.areaId === a.id).map((p) => ({ id: p.userId, name: p.name })) })),
    links: parseLinks(bash.links),
    build: bash.run?.build ?? "",
    environment: bash.run?.environment ?? "",
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
        platform: i.platform,
        plusOnes: plusOnesOf(i.plusOnes),
        at: i.createdAt.toISOString(),
        attachments: i.attachments,
        // Its bug template: what it still needs, so anyone can add it.
        template: findTemplate(withOko(i, oko), i.attachments),
        notABug: i.kind === "bug" && i.review === "skip" ? i.reviewReason : null,
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

/**
 * A cheap fingerprint of everything Live finds shows (ver_237, bug bash of fifty): the panel sends
 * the last one it got, and while nothing changed it gets back only this, not every find again.
 * Null when there's no such bash. Leaves out the cycle's Jira bug form; the panel asks for the full
 * list every 30 seconds anyway, which picks that up.
 */
export async function bashFindsVersion(bashId: string) {
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
      run: { select: { build: true, environment: true } },
      people: { select: { userId: true, name: true, areaId: true }, orderBy: { userId: "asc" } },
      items: {
        where: { kind: { in: [...ITEM_KINDS, "add"] } },
        orderBy: { id: "asc" },
        select: { id: true, areaId: true, text: true, details: true, severity: true, plusOnes: true, defectId: true, answers: true, platform: true, review: true, reviewReason: true, mergedIntoId: true, _count: { select: { attachments: true } } },
      },
    },
  });
  if (!bash) return null;
  const hash = createHash("sha1");
  hash.update(`${phaseOf(bash)}|${JSON.stringify(bash.areas)}|${JSON.stringify(bash.links)}|${bash.run?.build ?? ""}|${bash.run?.environment ?? ""}`);
  for (const p of bash.people) hash.update(`|${p.userId}:${p.name}:${p.areaId}`);
  for (const i of bash.items) hash.update(`|${JSON.stringify(i)}`);
  return { projectId: bash.projectId, v: hash.digest("base64url") };
}

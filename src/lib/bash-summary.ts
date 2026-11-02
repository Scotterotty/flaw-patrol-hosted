import "server-only";
import { bugsByPlatform, cleanPlatforms, parseAreas, parseLinks, phaseOf, platformLine, plusOnesOf, sevRank, timeRange } from "./bash";
import { dayName, type Spelling } from "./spelling";
import { parseCharter } from "./charter";
import { findTemplate } from "./bash-template";
import { loadBugTemplates } from "./bug-templates-data";
import { db } from "./db";
import { severityScaleFor } from "./severity-server";

// What a bug bash found: the board while it's on, and the one-page report after.

export async function loadBashFull(bashId: string) {
  const bash = await db.bugBash.findUnique({
    where: { id: bashId },
    include: {
      project: { select: { id: true, key: true, name: true, groupId: true } },
      run: { select: { id: true, number: true, projectId: true, project: { select: { key: true, name: true, platform: true } } } },
      people: { orderBy: { joinedAt: "asc" } },
      items: { orderBy: { createdAt: "desc" }, include: { attachments: { select: { id: true, fileName: true, contentType: true } } } },
    },
  });
  if (!bash) return null;
  const areas = parseAreas(bash.areas);
  const charters = await db.testCase.findMany({ where: { id: { in: areas.map((a) => a.caseId) } }, select: { id: true, number: true, project: { select: { key: true } }, versions: { orderBy: { version: "desc" }, take: 1, select: { charter: true } } } });
  const charterOf = new Map(charters.map((c) => [c.id, { ...parseCharter(c.versions[0]?.charter), key: c.project.key, number: c.number }]));
  const defects = await db.defect.findMany({ where: { id: { in: bash.items.map((i) => i.defectId).filter((x): x is string => !!x) } }, select: { id: true, number: true, externalKey: true, externalUrl: true } });
  const defectOf = new Map(defects.map((d) => [d.id, d]));
  // Each area's run entry, so "File this bug…" can file against the area's charter.
  const entries = bash.run ? await db.runEntry.findMany({ where: { runId: bash.run.id, caseId: { in: areas.map((a) => a.caseId) } }, select: { id: true, caseId: true } }) : [];
  const entryOf = Object.fromEntries(areas.flatMap((a) => { const e = entries.find((x) => x.caseId === a.caseId); return e ? [[a.id, e.id] as const] : []; }));
  // Additions and answers hang off the find they add to.
  const addsOf = (id: string) => bash.items.filter((a) => a.kind === "add" && a.replyToId === id).reverse().map((a) => ({ id: a.id, byId: a.byId, byName: a.byName, text: a.text, at: a.createdAt }));
  const items = bash.items.filter((i) => i.kind !== "add").map((i) => ({
    id: i.id,
    areaId: i.areaId,
    kind: i.kind,
    text: i.text,
    details: i.details,
    severity: i.severity,
    byId: i.byId,
    byName: i.byName,
    platform: i.platform,
    plusOnes: plusOnesOf(i.plusOnes),
    review: i.review,
    fileError: i.fileError,
    mergedIntoId: i.mergedIntoId,
    at: i.createdAt,
    attachments: i.attachments,
    template: findTemplate(i, i.attachments),
    bug: i.defectId ? (defectOf.get(i.defectId) ?? null) : null,
    adds: addsOf(i.id),
  }));
  // Bug templates: the team's list, for the log box and for switching the bash's template.
  const runProject = bash.run ? await db.project.findUnique({ where: { id: bash.run.projectId }, select: { id: true, key: true, groupId: true } }) : null;
  const choices = runProject ? (await loadBugTemplates(runProject)).templates.map(({ id, name, hint, layout }) => ({ id, name, hint, layout })) : [];
  return {
    bash,
    bugTemplates: choices,
    bugTemplate: choices.find((t) => t.id === bash.bugTemplateId) ?? null,
    phase: phaseOf(bash),
    areas: areas.map((a) => ({ ...a, charter: charterOf.get(a.caseId) ?? null, people: bash.people.filter((p) => p.areaId === a.id).map((p) => ({ id: p.userId, name: p.name })) })),
    items,
    entryOf,
    links: parseLinks(bash.links),
    // The team's own severity names, so bash levels show what they file as.
    sevNames: (await severityScaleFor(bash.run?.projectId ?? bash.projectId)).labels,
  };
}
export type BashFull = NonNullable<Awaited<ReturnType<typeof loadBashFull>>>;

/** The report: counts, by area, worst bugs, prompts covered and not touched, and vs the last bash. */
export async function bashReport(bashId: string, clock: { spelling?: Spelling; zone?: string } = {}) {
  const full = await loadBashFull(bashId);
  if (!full) return null;
  const { bash, areas, items } = full;
  const bugs = items.filter((i) => i.kind === "bug" && !i.mergedIntoId);
  // Every bug logged counts as found, filed or not: the report used to drop unfiled ones and say 0.
  const counted = bugs;
  const previous = await db.bugBash.findFirst({
    where: { projectId: bash.projectId, wrappedAt: { not: null }, createdAt: { lt: bash.createdAt } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, items: { where: { kind: "bug", mergedIntoId: null }, select: { id: true } } },
  });
  const byArea = areas.map((a) => ({ id: a.id, name: a.name, bugs: counted.filter((b) => b.areaId === a.id).length })).sort((x, y) => y.bugs - x.bugs);
  const worst = [...counted].sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || b.plusOnes.length - a.plusOnes.length).slice(0, 3);
  const coverage = areas.map((a) => {
    const prompts = a.charter?.prompts ?? [];
    const covered = new Set(items.filter((i) => i.kind === "covered" && i.areaId === a.id).map((i) => i.text));
    const notes = items.filter((i) => i.areaId === a.id && i.kind !== "covered").length;
    return { id: a.id, name: a.name, prompts: prompts.length, covered: prompts.filter((p) => covered.has(p)).length, untouched: prompts.filter((p) => !covered.has(p)), notes };
  });
  const people = new Set([...bash.people.map((p) => p.userId), ...items.map((i) => i.byId).filter(Boolean)]).size;
  const end = bash.endedAt && bash.endedAt < bash.endsAt ? bash.endedAt : bash.endsAt;
  return {
    ...full,
    // On the viewer's clock and Language setting when the page passes them.
    when: `${dayName(bash.startsAt, clock.spelling ?? "us", clock.zone)} ${timeRange(bash.startsAt, end, clock)}`,
    people,
    bugs: counted,
    notFiled: bash.wrappedAt ? counted.filter((b) => !b.bug).length : 0,
    high: counted.filter((b) => b.severity === "CRITICAL" || b.severity === "SHOWSTOPPER").length,
    questions: items.filter((i) => i.kind === "question").length,
    // Everything found: every kind, with what people added.
    unanswered: items.filter((i) => i.kind === "question" && !i.adds.length).length,
    notes: items.filter((i) => i.kind === "note").length,
    ideas: items.filter((i) => i.kind === "idea").length,
    finds: items.filter((i) => ["bug", "question", "note", "idea"].includes(i.kind) && !i.mergedIntoId),
    plusOnes: bugs.reduce((n, b) => n + b.plusOnes.length, 0),
    vsLast: previous ? { name: previous.name, diff: counted.length - previous.items.length } : null,
    byArea,
    // Bugs per platform (ver_146): counts bugs, never people. Empty when nobody gave a platform.
    byPlatform: counted.some((b) => b.platform || b.plusOnes.some((p) => p.platform)) ? bugsByPlatform(counted, bash.platforms) : [],
    worst,
    coverage,
  };
}
export type BashReport = NonNullable<Awaited<ReturnType<typeof bashReport>>>;

/** "10 people found 11 bugs in an hour (2 High). Most in Checkout (5). Worst: PRJ-812 …" */
export async function bashSummaryLine(bashId: string) {
  const r = await bashReport(bashId);
  if (!r) return "";
  const length = r.bash.minutes === 60 ? "an hour" : r.bash.minutes % 60 === 0 ? `${r.bash.minutes / 60} hours` : `${r.bash.minutes} minutes`;
  const top = r.byArea[0];
  const worst = r.worst[0];
  return [
    `${r.people} ${r.people === 1 ? "person" : "people"} found ${r.bugs.length} ${r.bugs.length === 1 ? "bug" : "bugs"} in ${length}${r.high ? ` (${r.high} High or Blocker)` : ""}.`,
    top?.bugs ? `Most in ${top.name} (${top.bugs}).` : "",
    platformLine(r.byPlatform) ? `By platform: ${platformLine(r.byPlatform)}.` : "",
    worst ? `Worst: ${worst.bug?.externalKey ?? (worst.bug ? `D-${worst.bug.number}` : "")} ${worst.text}`.replace(/\s+/g, " ").trim() : "",
    r.questions || r.notes || r.ideas
      ? `Also ${[r.questions && `${r.questions} ${r.questions === 1 ? "question" : "questions"}${r.unanswered ? ` (${r.unanswered} not answered)` : ""}`, r.notes && `${r.notes} ${r.notes === 1 ? "note" : "notes"}`, r.ideas && `${r.ideas} ${r.ideas === 1 ? "idea" : "ideas"}`].filter(Boolean).join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** What the bash screens need, with plain strings for times. */
export function bashView(full: BashFull, me: { id: string; canManage: boolean; lastPlatform?: string }) {
  const { bash } = full;
  const mine = bash.people.find((p) => p.userId === me.id);
  return {
    id: bash.id,
    name: bash.name,
    phase: full.phase,
    minutes: bash.minutes,
    startsAt: bash.startsAt.toISOString(),
    endsAt: (bash.endedAt && bash.endedAt < bash.endsAt ? bash.endedAt : bash.endsAt).toISOString(),
    createdBy: bash.createdBy,
    isOwner: bash.createdById === me.id || me.canManage,
    collectFirst: bash.collectFirst,
    bugTemplates: full.bugTemplates,
    bugTemplateId: full.bugTemplate?.id ?? null,
    funExtras: bash.funExtras,
    homeKey: bash.project.key,
    entryOf: full.entryOf,
    sevNames: full.sevNames,
    runProjectId: bash.run?.projectId ?? bash.projectId,
    runHref: bash.run ? `/p/${bash.run.project.key}/runs/${bash.run.number}` : null,
    areas: full.areas.map((a) => ({ id: a.id, name: a.name, template: a.template, prompts: a.charter?.prompts ?? [], charterHref: a.charter ? `/p/${a.charter.key}/cases/${a.charter.number}` : null, people: a.people, links: a.links })),
    links: full.links,
    people: bash.people.map((p) => ({ id: p.userId, name: p.name, areaId: p.areaId, platform: p.platform })),
    // Platforms people can say they're on (ver_146); empty means nobody is asked.
    platforms: cleanPlatforms(bash.platforms),
    items: full.items.map((i) => ({ ...i, at: i.at.toISOString(), adds: i.adds.map((a) => ({ ...a, at: a.at.toISOString() })) })),
    me: { id: me.id, areaId: mine?.areaId ?? null, platform: mine ? mine.platform : (me.lastPlatform ?? "") },
  };
}
export type BashView = ReturnType<typeof bashView>;

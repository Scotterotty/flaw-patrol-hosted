import "server-only";
import { notFound } from "next/navigation";
import { can } from "./permissions";
import { bashReport, bashView, loadBashFull, type BashReport } from "./bash-summary";
import { projectAccessOrGuest } from "./session";
import type { ReportData } from "@/components/bash-report";

/** The bash on a /p/KEY/bashes/ID page, for someone who can see the project. */
export async function bashPageData(key: string, id: string) {
  const { project, user, who, guest } = await projectAccessOrGuest(key);
  // A guest sees only the bash their link opened.
  if (guest && guest.bashId !== id) notFound();
  const full = await loadBashFull(id);
  if (!full || full.bash.projectId !== project.id) notFound();
  return { project, user, who, guest: !!guest, full, view: bashView(full, { id: user.id, canManage: !guest && can(who, "run:manage") }) };
}

export function reportData(r: BashReport, file?: ReportData["file"]): ReportData {
  const wrapped = !!r.bash.wrappedAt;
  const bug = (b: BashReport["bugs"][number]) => ({
    id: b.id,
    text: b.text,
    details: b.details,
    severity: b.severity,
    areaId: b.areaId,
    byName: b.byName,
    seen: 1 + b.plusOnes.length,
    key: b.bug ? (b.bug.externalKey ?? `D-${b.bug.number}`) : "",
    url: b.bug?.externalUrl ?? null,
    // Unfiled bugs stay on the report, tagged, with Jira's reason.
    unfiled: b.bug || !wrapped ? null : b.review === "skip" ? ("left" as const) : ("not-filed" as const),
    why: b.fileError,
    attachments: b.attachments,
  });
  return {
    id: r.bash.id,
    name: r.bash.name,
    homeKey: r.bash.project.key,
    when: r.when,
    createdBy: r.bash.createdBy,
    people: r.people,
    areas: r.areas.map((a) => ({ id: a.id, name: a.name, links: a.links })),
    links: r.links,
    wrapped: !!r.bash.wrappedAt,
    bugs: r.bugs.map(bug),
    notFiled: r.notFiled,
    entryOf: r.entryOf,
    sevNames: r.sevNames,
    file: file ?? null,
    high: r.high,
    questions: r.questions,
    unanswered: r.unanswered,
    notes: r.notes,
    ideas: r.ideas,
    plusOnes: r.plusOnes,
    finds: r.finds.map((f) => ({
      id: f.id,
      kind: f.kind as "bug" | "question" | "note" | "idea",
      text: f.text,
      areaId: f.areaId,
      byName: f.byName,
      severity: f.severity,
      plusOnes: f.plusOnes.map((p) => p.name),
      adds: f.adds.map((a) => ({ by: a.byName, text: a.text })),
      at: f.at.toISOString(),
      key: f.bug ? (f.bug.externalKey ?? `D-${f.bug.number}`) : "",
      url: f.bug?.externalUrl ?? null,
      left: f.kind === "bug" && wrapped && !f.bug && f.review === "skip",
    })),
    vsLast: r.vsLast,
    byArea: r.byArea,
    worst: r.worst.map(bug),
    coverage: r.coverage,
  };
}

export { bashReport };

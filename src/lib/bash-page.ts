import "server-only";
import { notFound } from "next/navigation";
import { can } from "./permissions";
import { bashReport, bashView, loadBashFull, type BashReport } from "./bash-summary";
import { projectAccess } from "./session";
import type { ReportData } from "@/components/bash-report";

/** The bash on a /p/KEY/bashes/ID page, for someone who can see the project. */
export async function bashPageData(key: string, id: string) {
  const { project, user, who } = await projectAccess(key);
  const full = await loadBashFull(id);
  if (!full || full.bash.projectId !== project.id) notFound();
  return { project, user, who, full, view: bashView(full, { id: user.id, canManage: can(who, "run:manage") }) };
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
    // ver_94: unfiled bugs stay on the report, tagged, with Jira's reason.
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
    areas: r.areas.map((a) => ({ id: a.id, name: a.name })),
    wrapped: !!r.bash.wrappedAt,
    bugs: r.bugs.map(bug),
    notFiled: r.notFiled,
    entryOf: r.entryOf,
    sevNames: r.sevNames,
    file: file ?? null,
    high: r.high,
    questions: r.questions,
    vsLast: r.vsLast,
    byArea: r.byArea,
    worst: r.worst.map(bug),
    coverage: r.coverage,
  };
}

export { bashReport };

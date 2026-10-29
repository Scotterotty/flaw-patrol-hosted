import "server-only";
import { Prisma } from "@prisma/client";
import { pathOf } from "@/lib/folders";
import { expandSteps, parseCaseSteps, parseParams, parsePlainSteps, sharedStepIdsIn, type SharedStepDef } from "@/lib/steps";

type Tx = Prisma.TransactionClient;

/**
 * Freeze the current version of each case into run entries: shared steps are
 * expanded with the version in force right now, so the run records exactly
 * what the tester was asked to do.
 */
export async function buildEntries(tx: Tx, projectId: string | string[], caseIds: string[], assigneeId: string | null) {
  // A project in an umbrella also runs cases from the umbrella's shared library.
  const projectIds = Array.isArray(projectId) ? projectId : [projectId];
  const cases = await tx.testCase.findMany({
    where: { id: { in: caseIds }, projectId: { in: projectIds }, archived: false },
    include: { versions: { orderBy: { version: "desc" }, take: 1 }, persona: { select: { name: true, emoji: true, description: true } } },
  });
  const byId = new Map(cases.map((c) => [c.id, c]));
  const ordered = caseIds.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c);

  const items = ordered.map((c) => parseCaseSteps(c.versions[0]?.steps));
  const sharedIds = [...new Set(items.flatMap(sharedStepIdsIn))];
  const shared = await tx.sharedStep.findMany({
    where: { id: { in: sharedIds } },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  const defs = new Map<string, SharedStepDef>(
    shared.map((s) => [
      s.id,
      { id: s.id, name: s.name, version: s.currentVersion, parameters: parseParams(s.versions[0]?.parameters), steps: parsePlainSteps(s.versions[0]?.steps) },
    ]),
  );
  const folders = await tx.folder.findMany({ where: { projectId: { in: projectIds } }, select: { id: true, parentId: true, name: true } });

  return ordered.map((c, i) => ({
    caseId: c.id,
    caseVersion: c.currentVersion,
    position: i,
    title: c.title,
    preconditions: c.preconditions,
    priority: c.priority,
    folderPath: pathOf(folders, c.folderId).join(" / "),
    steps: (c.type === "EXPLORATORY" ? [] : expandSteps(items[i], defs)) as unknown as Prisma.InputJsonValue,
    kind: c.type,
    charter: c.type === "EXPLORATORY" ? ((c.versions[0]?.charter ?? {}) as Prisma.InputJsonValue) : Prisma.DbNull,
    persona: c.persona ? (c.persona as Prisma.InputJsonValue) : Prisma.DbNull,
    assigneeId,
  }));
}

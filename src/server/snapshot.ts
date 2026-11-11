import "server-only";
import { Prisma } from "@prisma/client";
import { pathOf } from "@/lib/folders";
import { parseTestData } from "@/lib/test-data";
import { clientsForCase, withClients } from "@/lib/clients";
import { expandForRun, expandSteps, parseCaseSteps, parseParams, parsePlainSteps, sharedStepIdsIn, type SharedStepDef } from "@/lib/steps";

type Tx = Prisma.TransactionClient;

/**
 * Freeze the current version of each case into run entries: shared steps are
 * expanded with the version in force right now, so the run records exactly
 * what the tester was asked to do.
 */
export async function buildEntries(
  tx: Tx,
  projectId: string | string[],
  caseIds: string[],
  assigneeId: string | null,
  /** clients (ver_214): the test cycle's clients; each case tested by hand runs once per client it covers. */
  opts?: { wholeCase?: boolean; clients?: string[] },
) {
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

  return ordered.map((c, i) => {
    // Automation results (wholeCase) give one result for the whole case, so rows are left out.
    const own = c.type === "EXPLORATORY" || opts?.wholeCase ? null : parseTestData(c.versions[0]?.testData);
    const folderPath = pathOf(folders, c.folderId).join(" / ");
    // Clients: the ones picked on the case, or a guess from its words ("Web - Move an asset" is Web only).
    const byClient = c.type === "MANUAL" && !opts?.wholeCase && opts?.clients?.length;
    const clients = byClient
      ? clientsForCase(
          c.clients,
          opts!.clients!,
          [c.title, folderPath, ...expandSteps(items[i], defs).flatMap((s) => [s.action, s.expected])].join("\n"),
        )
      : [];
    const data = clients.length ? withClients(own, clients) : own;
    // A case with only a title still runs once per client: one step each, the title standing in for it.
    const caseItems = clients.length && !items[i].length ? [{ kind: "step" as const, action: "", expected: "" }] : items[i];
    return {
    caseId: c.id,
    caseVersion: c.currentVersion,
    position: i,
    title: c.title,
    preconditions: c.preconditions,
    priority: c.priority,
    folderPath,
    steps: (c.type === "EXPLORATORY" ? [] : expandForRun(caseItems, defs, data)) as unknown as Prisma.InputJsonValue,
    testData: data ? (data as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    clients,
    kind: c.type,
    charter: c.type === "EXPLORATORY" ? ((c.versions[0]?.charter ?? {}) as Prisma.InputJsonValue) : Prisma.DbNull,
    persona: c.persona ? (c.persona as Prisma.InputJsonValue) : Prisma.DbNull,
    assigneeId,
    };
  });
}

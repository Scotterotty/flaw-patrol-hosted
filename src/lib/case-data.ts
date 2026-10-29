import "server-only";
import { db } from "./db";
import { buildTree, flattenTree, pathOf, subtreeIds, type FolderRow } from "./folders";
import { parseParams, parsePlainSteps, type SharedStepDef } from "./steps";

/** Latest version of each shared step, keyed by id. Includes archived ones a case still references. */
export async function sharedStepDefs(projectId: string, alsoIds: string[] = []): Promise<SharedStepDef[]> {
  const rows = await db.sharedStep.findMany({
    where: { projectId, OR: [{ archived: false }, { id: { in: alsoIds } }] },
    orderBy: { name: "asc" },
    include: { versions: { orderBy: { version: "desc" }, take: 1 }, _count: { select: { usages: true } } },
  });
  return rows.map((r) => {
    const v = r.versions[0];
    return { id: r.id, name: r.name, version: r.currentVersion, parameters: parseParams(v?.parameters), steps: parsePlainSteps(v?.steps), usedIn: r._count.usages };
  });
}

/**
 * Folders that hold only charters, like "Bug bashes" (ver_94). The Case library and the
 * case editor's Folder list leave them out; the charters live on the Charters page.
 */
export async function charterOnlyFolderIds(projectId: string, folders: FolderRow[]): Promise<Set<string>> {
  const rows = await db.testCase.groupBy({ by: ["folderId", "type"], where: { projectId, archived: false, folderId: { not: null } }, _count: true });
  const charters = new Set(rows.filter((r) => r.type === "EXPLORATORY").map((r) => r.folderId!));
  const cases = new Set(rows.filter((r) => r.type !== "EXPLORATORY").map((r) => r.folderId!));
  const out = new Set<string>();
  for (const f of folders) {
    const ids = subtreeIds(folders, f.id);
    if (ids.some((id) => charters.has(id)) && !ids.some((id) => cases.has(id))) out.add(f.id);
  }
  return out;
}

export async function editorContext(projectId: string, referencedSharedIds: string[] = [], personaId: string | null = null, charter = false) {
  const [allFolders, sharedSteps, tagRows, personas] = await Promise.all([
    db.folder.findMany({ where: { projectId }, select: { id: true, parentId: true, name: true } }),
    sharedStepDefs(projectId, referencedSharedIds),
    db.$queryRaw<{ tag: string }[]>`SELECT DISTINCT unnest(tags) AS tag FROM "TestCase" WHERE "projectId" = ${projectId} ORDER BY tag`,
    // Archived personas stay listed only for the case already tagged with one.
    db.persona.findMany({
      where: { projectId, OR: [{ archived: false }, ...(personaId ? [{ id: personaId }] : [])] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, emoji: true },
    }),
  ]);
  const hide = charter ? new Set<string>() : await charterOnlyFolderIds(projectId, allFolders);
  const folders = allFolders.filter((f) => !hide.has(f.id));
  return {
    folderOptions: flattenTree(buildTree(folders)).map((f) => ({ id: f.id, label: pathOf(folders, f.id).join(" / ") })),
    sharedSteps,
    knownTags: tagRows.map((t) => t.tag),
    folders,
    personas,
  };
}

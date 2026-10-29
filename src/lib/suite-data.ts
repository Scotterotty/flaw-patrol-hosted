import "server-only";
import { db } from "./db";
import { badgeOf } from "./game";
import { buildTree, flattenTree, pathOf, subtreeIds } from "./folders";
import { libraryProjectIds } from "./umbrella";

/**
 * Cases a suite can hold: the project's own, plus its umbrella's Case library.
 * Library folders are labeled "Case library / …" so they read apart from the project's own.
 */
export async function suitePickerData(project: { id: string; groupId: string | null }) {
  const ids = await libraryProjectIds(project);
  const [folders, cases, tagRows, keys] = await Promise.all([
    db.folder.findMany({ where: { projectId: { in: ids } }, select: { id: true, parentId: true, name: true, projectId: true } }),
    db.testCase.findMany({
      where: { projectId: { in: ids }, archived: false },
      orderBy: [{ projectId: "asc" }, { number: "asc" }],
      select: { id: true, number: true, title: true, folderId: true, priority: true, tags: true, projectId: true },
    }),
    db.$queryRaw<{ tag: string }[]>`SELECT DISTINCT unnest(tags) AS tag FROM "TestCase" WHERE "projectId" = ANY(${ids}) AND archived = false ORDER BY tag`,
    db.project.findMany({ where: { id: { in: ids } }, select: { id: true, key: true } }),
  ]);
  const keyOf = new Map(keys.map((p) => [p.id, p.key]));
  const shared = (projectId: string) => projectId !== project.id;
  const label = (folderId: string | null, projectId: string) => {
    const path = pathOf(folders, folderId).join(" / ");
    return shared(projectId) ? ["Case library", path].filter(Boolean).join(" / ") : path;
  };
  const byProject = ids.flatMap((pid) => flattenTree(buildTree(folders.filter((f) => f.projectId === pid))).map((f) => ({ ...f, projectId: pid })));
  // The library's cases first under an umbrella: that's where a test cycle's cases live.
  const order = (pid: string) => (shared(pid) ? 0 : 1);
  return {
    cases: cases
      .sort((a, b) => order(a.projectId) - order(b.projectId) || a.number - b.number)
      .map(({ projectId, ...c }) => ({ ...c, key: `${keyOf.get(projectId)}-${c.number}`, folderPath: label(c.folderId, projectId) })),
    folders: byProject
      .sort((a, b) => order(a.projectId) - order(b.projectId))
      .map((f) => ({ id: f.id, label: label(f.id, f.projectId), ids: subtreeIds(folders, f.id) })),
    tags: tagRows.map((t) => t.tag),
  };
}

export async function projectMembers(projectId: string) {
  const members = await db.projectMember.findMany({
    where: { projectId },
    select: { userId: true, user: { select: { name: true, email: true, avatarAt: true, gameEnabled: true, gameTitle: true, gameFrame: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return members.map((m) => ({ id: m.userId, name: m.user.name ?? m.user.email, avatarAt: m.user.avatarAt, ...badgeOf(m.user) }));
}

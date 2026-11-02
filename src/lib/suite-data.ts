import "server-only";
import { NOT_BASH_CASE } from "@/lib/bash-cases";
import { db } from "./db";
import { badgeOf } from "./game";
import { buildTree, flattenTree, pathOf, subtreeIds } from "./folders";
import { libraryProjectIds, umbrellaOf } from "./umbrella";
import { hasBracketTitle } from "./tags";

/**
 * Cases a suite can hold: the project's own, plus its umbrella's Case library.
 * Library folders are labeled "Case library / …" so they read apart from the project's own.
 */
export async function suitePickerData(project: { id: string; groupId: string | null }) {
  const ids = await libraryProjectIds(project);
  const [folders, cases, tagRows, keys, archived, umbrella] = await Promise.all([
    db.folder.findMany({ where: { projectId: { in: ids } }, select: { id: true, parentId: true, name: true, projectId: true } }),
    db.testCase.findMany({
      where: { projectId: { in: ids }, archived: false, ...NOT_BASH_CASE },
      orderBy: [{ projectId: "asc" }, { number: "asc" }],
      select: { id: true, number: true, title: true, folderId: true, priority: true, tags: true, projectId: true },
    }),
    db.$queryRaw<{ tag: string }[]>`SELECT DISTINCT unnest(tags) AS tag FROM "TestCase" WHERE "projectId" = ANY(${ids}) AND archived = false ORDER BY tag`,
    db.project.findMany({ where: { id: { in: ids } }, select: { id: true, key: true } }),
    // For "Can't find a case?" (ver_99): archived cases never show in a picker.
    db.testCase.count({ where: { projectId: { in: ids }, archived: true } }),
    umbrellaOf(project),
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
      // name and depth (ver_99) draw the folder list beside the cases; group splits the library from a test cycle's own folders.
      .map((f) => ({ id: f.id, label: label(f.id, f.projectId), name: f.name, depth: f.depth, group: ids.length > 1 ? (shared(f.projectId) ? "Case library" : "This test cycle only") : "", ids: subtreeIds(folders, f.id) })),
    tags: tagRows.map((t) => t.tag),
    archived,
    // [UNITY] at the start of a title isn't a tag until Case library → Review… makes it one.
    bracketTitles: cases.filter((c) => hasBracketTitle(c.title)).length,
    // Where archived cases and Review… live: the umbrella's Case library, or the project itself.
    libraryKey: keyOf.get(ids[ids.length - 1]) ?? "",
    umbrellaName: umbrella?.group.name ?? null,
  };
}

export async function projectMembers(projectId: string) {
  const members = await db.projectMember.findMany({
    where: { projectId },
    select: { userId: true, role: true, user: { select: { name: true, email: true, avatarAt: true, gameEnabled: true, gameTitle: true, gameFrame: true } } },
    orderBy: { user: { name: "asc" } },
  });
  // canTest (ver_137): Viewers can't record results, so Assign lists leave them out (see assignable).
  return members.map((m) => ({ id: m.userId, name: m.user.name ?? m.user.email, avatarAt: m.user.avatarAt, canTest: m.role !== "VIEWER", ...badgeOf(m.user) }));
}

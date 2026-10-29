import "server-only";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { libraryProjectIds } from "@/lib/umbrella";

export async function loadSharedStep(projectId: string, id: string) {
  const s = await db.sharedStep.findFirst({
    where: { id, projectId },
    include: {
      versions: { orderBy: { version: "desc" } },
      usages: {
        include: { testCase: { select: { number: true, title: true, archived: true } } },
        orderBy: { testCase: { number: "asc" } },
      },
    },
  });
  if (!s) {
    // A shared step from an umbrella's library, opened from one of its projects' runs.
    const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, groupId: true } });
    const elsewhere = project && (await db.sharedStep.findFirst({ where: { id, projectId: { in: await libraryProjectIds(project) } }, select: { project: { select: { key: true } } } }));
    if (elsewhere) redirect(`/p/${elsewhere.project.key}/shared-steps/${id}`);
    notFound();
  }
  return s;
}

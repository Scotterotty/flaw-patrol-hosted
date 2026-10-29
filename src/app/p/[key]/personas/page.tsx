import { PersonasBoard } from "@/components/personas";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";

export const metadata = { title: "Personas" };

export default async function PersonasPage({ params }: { params: Promise<{ key: string }> }) {
  const { project, who } = await projectAccess((await params).key);
  const personas = await db.persona.findMany({
    where: { projectId: project.id },
    orderBy: { name: "asc" },
    include: { cases: { where: { archived: false }, select: { type: true } } },
  });
  return (
    <div className="mx-auto max-w-6xl">
      <PersonasBoard
        projectId={project.id}
        projectKey={project.key}
        canManage={can(who, "shared:manage")}
      canArchive={can(who, "library:archive")}
        canWrite={can(who, "case:edit")}
        personas={personas.map((p) => ({
          id: p.id,
          name: p.name,
          emoji: p.emoji,
          description: p.description,
          archived: p.archived,
          charters: p.cases.filter((c) => c.type === "EXPLORATORY").length,
          cases: p.cases.filter((c) => c.type !== "EXPLORATORY").length,
        }))}
      />
    </div>
  );
}

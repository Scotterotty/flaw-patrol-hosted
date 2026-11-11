import { notFound } from "next/navigation";
import { CsvImporter, type ImportPlace } from "@/components/csv-importer";
import { PageHeader } from "@/components/ui";
import { editorContext } from "@/lib/case-data";
import { db } from "@/lib/db";
import { areaContextFor } from "@/lib/tag-data";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";
import { umbrellaOf } from "@/lib/umbrella";

export const metadata = { title: "Import test cases" };

export default async function ImportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ folder?: string }> }) {
  const { key } = await params;
  const { folder } = await searchParams;
  const { project, user, who } = await projectAccess(key);
  if (!can(who, "import")) notFound();
  const umbrella = await umbrellaOf(project);
  const place = async (id: string, k: string, label: string, kind: ImportPlace["kind"]): Promise<ImportPlace> => ({
    id,
    key: k,
    label,
    kind,
    folderOptions: (await editorContext(id)).folderOptions,
    area: await areaContextFor(id),
  });

  // Inside an umbrella, cases go to its Case library unless you keep them in this test cycle.
  const places: ImportPlace[] = [];
  if (umbrella) {
    const hubRole = user.isAdmin ? "ADMIN" : (await db.projectMember.findUnique({ where: { projectId_userId: { projectId: umbrella.hub.id, userId: user.id } } }))?.role;
    if (umbrella.isHub || can(hubRole ?? null, "import")) places.push(await place(umbrella.hub.id, umbrella.hub.key, `${umbrella.group.name} case library`, "library"));
  }
  if (!umbrella?.isHub) places.push(await place(project.id, project.key, project.name, umbrella ? "cycle" : "own"));
  const start = places.find((p) => p.id === project.id) ?? places[0];
  return (
    <div className="max-w-6xl">
      <PageHeader title="Import test cases" subtitle="Bring existing cases in from a CSV or Excel file. Nothing is saved until you press Import." />
      <CsvImporter
        projectId={project.id}
        places={places}
        initialPlaceId={places[0].id}
        initialFolderId={start.folderOptions.some((f) => f.id === folder) ? folder! : null}
        initialFolderPlaceId={start.id}
        runHref={can(who, "run:create") ? (umbrella ? `/g/${umbrella.group.id}?start=run` : `/p/${project.key}/runs?start=run`) : null}
      />
    </div>
  );
}

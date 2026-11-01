import { db } from "@/lib/db";
import { fewNames } from "@/lib/link-access";
import { adminsOf, teamOf } from "@/lib/link-access-server";
import { ViewerNote } from "./viewer-note";

/** The Viewer note's names and whether they already asked (ver_124). */
export async function ViewerNoteFor({ project, userId }: { project: { id: string; key: string; name: string; groupId: string | null; keepMembersSeparate: boolean }; userId: string }) {
  const team = await teamOf(project);
  const [admins, asked] = await Promise.all([adminsOf(team.id), db.joinRequest.findUnique({ where: { projectId_userId: { projectId: team.id, userId } }, select: { id: true } })]);
  return <ViewerNote projectId={project.id} teamId={team.id} team={team.name} admins={fewNames(admins)} asked={!!asked} />;
}

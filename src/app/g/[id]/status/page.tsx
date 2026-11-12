import { notFound } from "next/navigation";
import { StatusBoard } from "@/components/status-board";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { loadUmbrella } from "@/lib/umbrella";
import { statusSources } from "@/server/status-checks";

export const metadata = { title: "Status" };

/**
 * Status (ver_228): GitHub, TeamCity, Sentry and CI uploads in one place, under Results.
 * The page lists what's connected right away; each card then asks its own tool.
 */
export default async function StatusPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const u = await loadUmbrella((await params).id, user);
  if (!u) notFound();
  const sources = await statusSources(u);
  return (
    <StatusBoard
      groupId={u.group.id}
      name={u.group.name}
      sources={sources}
      canManage={can(u.who, "jira:manage") && !u.group.archivedAt}
      canBug={can(u.who, "run:execute") && !u.group.archivedAt}
    />
  );
}

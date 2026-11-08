import { mySpelling } from "@/lib/session";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { loadUmbrella, platformColor } from "@/lib/umbrella";
import { ProjectBadge } from "../umbrella-home";
import { CycleRowMenu } from "@/components/cycle-row-menu";
import { can } from "@/lib/permissions";

export const metadata = { title: "Test cycles" };

/** Every project under the umbrella: the current RC per platform, then older and archived ones. */
export default async function UmbrellaProjectsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const u = await loadUmbrella((await params).id, user);
  if (!u) notFound();
  const spelling = await mySpelling();
  const canPin = can(u.who, "cycle:archive");
  const row = (p: (typeof u.projects)[number]) => (
    <li key={p.id} className="flex items-center gap-3 px-4 py-3" data-testid={`cycle-row-${p.key}`}>
      <ProjectBadge name={p.platform || p.name} color={platformColor(u.platforms, p.platform)} />
      <span className="min-w-0 flex-1">
        <Link href={`/p/${p.key}`} className="block truncate font-medium text-slate-900 hover:underline">
          {p.keepCurrent && !p.archivedAt && (
            <span aria-hidden className="mr-1" title="Kept in Current">
              📌
            </span>
          )}
          {p.name}
        </Link>
        <span className="block text-xs text-slate-500">
          {[p.platform, p.rcName, p.keepCurrent && !p.archivedAt && "kept in Current", `made ${relativeTime(p.createdAt, spelling)}`, p.archivedAt && "archived"].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="text-sm text-slate-500">{p._count.runs} active {p._count.runs === 1 ? "run" : "runs"}</span>
      <LinkButton size="sm" href={`/p/${p.key}`}>
        Open
      </LinkButton>
      {canPin && <CycleRowMenu groupId={u.group.id} cycle={{ id: p.id, key: p.key, name: p.name, keepCurrent: p.keepCurrent, archived: !!p.archivedAt }} />}
    </li>
  );
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title={`Test cycles in ${u.group.name}`} subtitle={`The newest test cycle for each platform is current, plus any pinned with 📌 Keep in Current${canPin ? " (⋯ on its row)" : ""}.`} />
      <Card>
        <h2 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">Current</h2>
        <ul className="divide-y divide-slate-100" data-testid="current-cycles">{u.current.map(row)}</ul>
      </Card>
      {u.older.length > 0 && (
        <Card>
          <h2 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">Older test cycles</h2>
          <ul className="divide-y divide-slate-100" data-testid="older-cycles">{u.older.map(row)}</ul>
        </Card>
      )}
    </div>
  );
}

import { mySpelling } from "@/lib/session";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { loadUmbrella, platformColor } from "@/lib/umbrella";
import { ProjectBadge } from "../umbrella-home";

export const metadata = { title: "Test cycles" };

/** Every project under the umbrella: the current RC per platform, then older and archived ones. */
export default async function UmbrellaProjectsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const u = await loadUmbrella((await params).id, user);
  if (!u) notFound();
  const spelling = await mySpelling();
  const row = (p: (typeof u.projects)[number]) => (
    <li key={p.id} className="flex items-center gap-3 px-4 py-3">
      <ProjectBadge name={p.platform || p.name} color={platformColor(u.platforms, p.platform)} />
      <span className="min-w-0 flex-1">
        <Link href={`/p/${p.key}`} className="block truncate font-medium text-slate-900 hover:underline">
          {p.name}
        </Link>
        <span className="block text-xs text-slate-500">
          {[p.platform, p.rcName, `made ${relativeTime(p.createdAt, spelling)}`, p.archivedAt && "archived"].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="text-sm text-slate-500">{p._count.runs} active {p._count.runs === 1 ? "run" : "runs"}</span>
      <LinkButton size="sm" href={`/p/${p.key}`}>
        Open
      </LinkButton>
    </li>
  );
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title={`Test cycles in ${u.group.name}`} subtitle="The newest test cycle for each platform is the current one. Older test cycles stay as they were; archive them from their settings when you like." />
      <Card>
        <h2 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">Current</h2>
        <ul className="divide-y divide-slate-100">{u.current.map(row)}</ul>
      </Card>
      {u.older.length > 0 && (
        <Card>
          <h2 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">Older test cycles</h2>
          <ul className="divide-y divide-slate-100">{u.older.map(row)}</ul>
        </Card>
      )}
    </div>
  );
}

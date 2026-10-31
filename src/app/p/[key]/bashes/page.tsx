import Link from "next/link";
import { Countdown } from "@/components/bash";
import { StartBashAuto, StartBashButton } from "@/components/bash-start";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { parseAreas } from "@/lib/bash";
import { bashHome, bashList } from "@/lib/bash-data";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";
import { redirect } from "next/navigation";

export const metadata = { title: "Bug bashes" };

/**
 * Bug bashes (ver_93): start one, join the live one, and past bashes with their reports.
 * They live on the umbrella's hub, so every test cycle's menu leads here.
 */
export default async function BashesPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ bash?: string }> }) {
  const { key } = await params;
  const { bash: auto } = await searchParams;
  const { project, who } = await projectAccess(key);
  const home = await bashHome(project);
  if (home.id !== project.id) redirect(`/p/${home.key}/bashes${auto ? `?bash=${auto}` : ""}`);
  const list = await bashList(home.id);
  const canStart = can(who, "run:create");
  const live = list.filter((b) => b.phase === "live" || b.phase === "scheduled" || b.phase === "ended");
  const past = list.filter((b) => b.phase === "wrapped");
  const again = new Map((await db.bugBash.findMany({ where: { id: { in: past.map((p) => p.id) } }, select: { id: true, areas: true, minutes: true, name: true } })).map((b) => [b.id, { name: b.name, minutes: b.minutes, areas: parseAreas(b.areas).map((a) => a.name) }]));
  const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Bug bashes"
        subtitle="A short, timed session where anyone picks an area and logs bugs in one line. Whoever starts it wraps up and files the bugs."
        actions={canStart ? <StartBashButton projectId={project.id} variant="primary" /> : undefined}
      />
      {auto === "start" && canStart && <StartBashAuto projectId={project.id} />}
      {live.map((b) => (
        <Card key={b.id} className="mb-4 flex flex-wrap items-center gap-4 border-red-200 p-4" data-testid="live-bash">
          <span className={b.phase === "live" ? "rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white" : "rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700"}>
            {b.phase === "live" ? "● Live" : b.phase === "scheduled" ? "Coming up" : "Wrapping up"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900">Bug bash · {b.name}</p>
            <p className="text-xs text-slate-500">
              Started by {b.createdBy} · {b.people} {b.people === 1 ? "person" : "people"} · {b.areas} {b.areas === 1 ? "area" : "areas"} · {b.bugs} {b.bugs === 1 ? "bug" : "bugs"} so far
            </p>
          </div>
          <Countdown bash={{ startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), phase: b.phase }} className="text-lg font-semibold text-slate-900" />
          {b.phase !== "ended" && (
            <Link href={`/p/${home.key}/bashes/${b.id}/join`} className="inline-flex h-9 items-center rounded-md bg-accent-600 px-3 text-sm font-medium text-white hover:bg-accent-700">
              Join
            </Link>
          )}
          <Link href={`/p/${home.key}/bashes/${b.id}`} className="inline-flex h-9 items-center rounded-md px-3 text-sm text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
            {b.phase === "ended" ? "Open the wrap-up" : "Watch the board"}
          </Link>
        </Card>
      ))}
      <h2 className="mt-6 mb-2 text-sm font-semibold text-slate-800">Past bashes</h2>
      {past.length === 0 ? (
        <EmptyState title="No bug bashes yet">Start one before a release: pick a few areas, invite the team, and everyone logs what they find for an hour.</EmptyState>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Bash</th>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">People</th>
                <th className="px-4 py-2 font-medium">Bugs</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {past.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2 font-medium text-slate-900">Bug bash · {b.name}</td>
                  <td className="px-4 py-2 text-slate-600">{date(b.startsAt)}</td>
                  <td className="px-4 py-2 tabular-nums">{b.people}</td>
                  <td className="px-4 py-2 tabular-nums">{b.bugs}</td>
                  <td className="px-4 py-2 text-right">
                    <span className="inline-flex items-center gap-2">
                      <Link href={`/p/${home.key}/bashes/${b.id}/report`} className="text-accent-700 hover:underline">
                        Report
                      </Link>
                      {canStart && again.get(b.id) && <StartBashButton projectId={project.id} size="sm" again={again.get(b.id)} />}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

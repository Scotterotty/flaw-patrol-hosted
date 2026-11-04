import Link from "next/link";
import { Countdown } from "@/components/bash";
import { StartBashAuto, StartBashButton } from "@/components/bash-start";
import { AddToCalendar, ScheduleControls } from "@/components/bash-schedule";
import { whenLabel } from "@/lib/bash-schedule";
import { viewerZone } from "@/lib/zone-server";
import { buttonClass, Card, EmptyState, PageHeader } from "@/components/ui";
import { parseAreas, setupLine } from "@/lib/bash";
import { bashHome, bashList } from "@/lib/bash-data";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";
import { redirect } from "next/navigation";

export const metadata = { title: "Bug bashes" };

/**
 * Bug bashes: start one, join the live one, and past bashes with their reports.
 * They live on the umbrella's hub, so every test cycle's menu leads here.
 */
export default async function BashesPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ bash?: string }> }) {
  const { key } = await params;
  const { bash: auto } = await searchParams;
  const { project, who, user } = await projectAccess(key);
  const home = await bashHome(project);
  if (home.id !== project.id) redirect(`/p/${home.key}/bashes${auto ? `?bash=${auto}` : ""}`);
  const list = await bashList(home.id);
  const canStart = can(who, "run:create");
  const zone = await viewerZone();
  const length = (m: number) => (m % 60 === 0 ? `${m / 60} ${m === 60 ? "hour" : "hours"}` : `${m} min`);
  // Live first, then coming up (soonest first), then ended ones waiting for their wrap-up (oldest first).
  const rank = { live: 0, scheduled: 1, ended: 2, wrapped: 3 } as const;
  const live = list.filter((b) => b.phase !== "wrapped").sort((a, b) => rank[a.phase] - rank[b.phase] || (a.phase === "live" ? 0 : a.startsAt.getTime() - b.startsAt.getTime()));
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
      {live.map((b) => {
        // Red means live, and only live (ver_154). Coming up is blue; an ended bash waits in amber for its wrap-up.
        const canWrap = b.createdById === user.id || can(who, "run:manage");
        const tone = b.phase === "live" ? "border-2 border-red-400" : b.phase === "scheduled" ? "border-l-4 border-l-accent-500" : "border-l-4 border-l-amber-500";
        return (
          <Card key={b.id} className={`mb-4 flex flex-wrap items-center gap-4 p-4 ${tone}`} data-testid="live-bash" data-phase={b.phase}>
            <span
              className={
                b.phase === "live"
                  ? "rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white"
                  : b.phase === "scheduled"
                    ? "rounded-full bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-800 ring-1 ring-accent-200"
                    : "rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200"
              }
            >
              {b.phase === "live" ? "● Live" : b.phase === "scheduled" ? "Coming up" : "Needs wrap-up"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900">Bug bash · {b.name}</p>
              {b.phase === "scheduled" ? (
                <p className="text-xs text-slate-500" data-testid="bash-when-line">
                  {whenLabel(b.startsAt, zone)} · {length(b.minutes)} · {b.areas} {b.areas === 1 ? "area" : "areas"} · Set up by {b.createdBy}
                </p>
              ) : b.phase === "ended" ? (
                <p className="text-xs text-slate-500" data-testid="bash-wrap-line">
                  Ended {(b.endedAt ?? b.endsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: zone })} · {b.people} {b.people === 1 ? "person" : "people"} · {b.areas} {b.areas === 1 ? "area" : "areas"} ·{" "}
                  {b.bugs ? `${b.bugs} ${b.bugs === 1 ? "bug" : "bugs"} waiting to be filed by ${b.createdBy}` : `no bugs logged · ${b.createdBy} wraps it up`}
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  Started by {b.createdBy} · {b.people} {b.people === 1 ? "person" : "people"} · {b.areas} {b.areas === 1 ? "area" : "areas"} · {b.bugs} {b.bugs === 1 ? "bug" : "bugs"} so far
                </p>
              )}
              {b.phase !== "ended" && setupLine(b) && (
                <p className="text-xs text-slate-600" data-testid="bash-setup-line">
                  {setupLine(b)}
                </p>
              )}
            </div>
            {b.phase !== "ended" && <Countdown bash={{ startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), phase: b.phase }} className="text-lg font-semibold text-slate-900" />}
            {b.phase !== "ended" && (
              <Link href={`/p/${home.key}/bashes/${b.id}?join=1`} className="inline-flex h-9 items-center rounded-md bg-accent-600 px-3 text-sm font-medium text-white hover:bg-accent-700">
                Join
              </Link>
            )}
            {b.phase === "scheduled" && <AddToCalendar bash={{ id: b.id, name: b.name, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), areas: b.areaNames, by: b.createdBy, homeKey: home.key }} />}
            {b.phase === "ended" ? (
              <Link
                href={`/p/${home.key}/bashes/${b.id}`}
                className={canWrap ? "inline-flex h-9 items-center rounded-md bg-accent-600 px-3 text-sm font-medium text-white hover:bg-accent-700" : "inline-flex h-9 items-center rounded-md px-3 text-sm text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"}
              >
                {canWrap ? (b.bugs ? "Wrap up and file bugs" : "Wrap it up") : "See what was found"}
              </Link>
            ) : (
              <Link href={`/p/${home.key}/bashes/${b.id}`} className="inline-flex h-9 items-center rounded-md px-3 text-sm text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
                Watch the board
              </Link>
            )}
            {b.phase === "scheduled" && canWrap && <ScheduleControls bashId={b.id} startsAt={b.startsAt.toISOString()} homeKey={home.key} />}
          </Card>
        );
      })}
      <h2 className="mt-6 mb-2 text-sm font-semibold text-slate-800">Past bashes</h2>
      {past.length === 0 ? (
        <EmptyState title={live.length ? "None wrapped up yet" : "No bug bashes yet"}>{live.length ? "A bash moves here once its bugs are filed." : canStart ? "Start one before a release: pick a few areas, invite the team, and everyone logs what they find for an hour." : "When someone starts a bug bash, you can join it here."}</EmptyState>
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
              {past.map((b) => {
                // Everything a bash found lives in its report: a real button, and the whole row opens it.
                const also = [b.notes && `${b.notes} ${b.notes === 1 ? "note" : "notes"}`, b.questions && `${b.questions} ${b.questions === 1 ? "question" : "questions"}`, b.ideas && `${b.ideas} ${b.ideas === 1 ? "idea" : "ideas"}`].filter(Boolean).join(" · ");
                return (
                  <tr key={b.id} className="relative hover:bg-slate-50" data-testid="past-bash">
                    <td className="px-4 py-2">
                      <span className="font-medium text-slate-900">Bug bash · {b.name}</span>
                      {also && <span className="block text-xs text-slate-500">{also}</span>}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{date(b.startsAt)}</td>
                    <td className="px-4 py-2 tabular-nums">{b.people}</td>
                    <td className="px-4 py-2 tabular-nums">{b.bugs}</td>
                    <td className="px-4 py-2 text-right">
                      <span className="inline-flex items-center gap-2">
                        <Link href={`/p/${home.key}/bashes/${b.id}/report`} className={`${buttonClass("primary", "sm")} after:absolute after:inset-0 after:content-['']`}>
                          See results<span className="sr-only"> of {b.name}</span>
                        </Link>
                        {canStart && again.get(b.id) && (
                          <span className="relative z-10">
                            <StartBashButton projectId={project.id} size="sm" again={again.get(b.id)} />
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

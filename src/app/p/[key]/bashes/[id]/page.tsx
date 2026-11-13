import Link from "next/link";
import { redirect } from "next/navigation";
import { BashBoard, BashTabs, WrapUp } from "@/components/bash";
import { findCount } from "@/lib/bash";
import { BashRelease } from "@/components/bash-release";
import { bashReleases } from "@/lib/bash-data";
import { can } from "@/lib/permissions";
import { CrumbName } from "@/components/crumb-name";
import { LiveRefresh } from "@/components/live-refresh";
import { bashPageData } from "@/lib/bash-page";
import { teamOf } from "@/lib/link-access-server";
import { BashGuestNote } from "@/components/join-request";
import { jiraConfigFor } from "@/lib/umbrella";
import { bashTick } from "@/server/bashes";

export const metadata = { title: "Bug bash" };

/** The bash board while it's on; the wrap-up when time's up; the report once wrapped. */
export default async function BashPage({ params, searchParams }: { params: Promise<{ key: string; id: string }>; searchParams: Promise<{ join?: string; find?: string }> }) {
  const { key, id } = await params;
  const { join, find } = await searchParams;
  await bashTick(id).catch(() => {});
  const { view, guest, project, user, who, full } = await bashPageData(key, id);
  if (view.phase === "wrapped") redirect(`/p/${view.homeKey}/bashes/${id}/report`);
  const myArea = view.areas.find((a) => a.id === view.me.areaId);
  const [jira, releases] = await Promise.all([jiraConfigFor(view.runProjectId).then(Boolean), guest ? [] : bashReleases(project)]);
  return (
    <div className="page page-list">
      <CrumbName href={`/p/${view.homeKey}/bashes/${id}`} label={`Bug bash · ${view.name}`} />
      <LiveRefresh url={`/api/live/bashes/${id}`} everyMs={2000} gapMs={3000} />
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          Bug bash · {view.name}
          {view.phase === "ended" && <span className="ml-2 text-base font-normal text-slate-500">· Wrap up</span>}
        </h1>
        {view.runHref && !guest && (
          <Link href={view.runHref} className="text-xs text-slate-500 hover:underline">
            Its test run
          </Link>
        )}
      </div>
      {/* Joined: My area / Whole bash tabs, so the board and your area are one click apart. */}
      {myArea && <BashTabs homeKey={view.homeKey} bashId={id} area={myArea.name} finds={findCount(view.items)} current="board" />}
      {!guest && (
        <div className="-mt-2 mb-4">
          <BashRelease bashId={id} release={full.bash.release} releases={releases} canChange={full.bash.createdById === user.id || can(who, "run:create")} />
        </div>
      )}
      {/* People outside the team land here from the link now: say what they'll see. */}
      {guest && !view.me.areaId && view.phase !== "ended" && (
        <BashGuestNote
          team={(await teamOf(project)).name}
          startedBy={view.createdBy}
          people={view.people.length}
          bugs={view.items.filter((i) => i.kind === "bug").length}
          askHref={`/access?to=${encodeURIComponent(`/p/${project.key}`)}`}
        />
      )}
      {view.phase === "ended" ? <WrapUp bash={view} jiraConnected={jira} /> : <BashBoard bash={view} openJoin={join === "1" || !!guest} openFind={find ?? null} />}
    </div>
  );
}

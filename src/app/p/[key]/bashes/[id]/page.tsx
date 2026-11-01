import Link from "next/link";
import { redirect } from "next/navigation";
import { BashBoard, WrapUp } from "@/components/bash";
import { CrumbName } from "@/components/crumb-name";
import { LiveRefresh } from "@/components/live-refresh";
import { bashPageData } from "@/lib/bash-page";
import { teamOf } from "@/lib/link-access-server";
import { BashGuestNote } from "@/components/join-request";
import { jiraConfigFor } from "@/lib/umbrella";
import { bashTick } from "@/server/bashes";

export const metadata = { title: "Bug bash" };

/** The bash board while it's on; the wrap-up when time's up; the report once wrapped. */
export default async function BashPage({ params, searchParams }: { params: Promise<{ key: string; id: string }>; searchParams: Promise<{ join?: string }> }) {
  const { key, id } = await params;
  const { join } = await searchParams;
  await bashTick(id).catch(() => {});
  const { view, guest, project } = await bashPageData(key, id);
  if (view.phase === "wrapped") redirect(`/p/${view.homeKey}/bashes/${id}/report`);
  const jira = !!(await jiraConfigFor(view.runProjectId));
  return (
    <div className="mx-auto max-w-6xl">
      <CrumbName href={`/p/${view.homeKey}/bashes/${id}`} label={`Bug bash · ${view.name}`} />
      <LiveRefresh url={`/api/live/bashes/${id}`} />
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
      {/* People outside the team (ver_115) land here from the link now (ver_121): say what they'll see. */}
      {guest && !view.me.areaId && view.phase !== "ended" && (
        <BashGuestNote
          team={(await teamOf(project)).name}
          startedBy={view.createdBy}
          people={view.people.length}
          bugs={view.items.filter((i) => i.kind === "bug").length}
          askHref={`/access?to=${encodeURIComponent(`/p/${project.key}`)}`}
        />
      )}
      {view.phase === "ended" ? <WrapUp bash={view} jiraConnected={jira} /> : <BashBoard bash={view} openJoin={join === "1" || !!guest} />}
    </div>
  );
}

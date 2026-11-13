import { redirect } from "next/navigation";
import { BashExplore, BashTabs } from "@/components/bash";
import { CrumbName } from "@/components/crumb-name";
import { LiveRefresh } from "@/components/live-refresh";
import { bashPageData } from "@/lib/bash-page";
import { bashFinds } from "@/lib/bash-live";
import { findCount } from "@/lib/bash";

export const metadata = { title: "Bug bash" };

/** Exploring one area of the bash: Log a bug on top, your finds, the clock and prompts. */
export default async function ExploreBashPage({ params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  const { view } = await bashPageData(key, id);
  if (view.phase === "wrapped") redirect(`/p/${view.homeKey}/bashes/${id}/report`);
  if (!view.me.areaId) redirect(`/p/${view.homeKey}/bashes/${id}?join=1`);
  const area = view.areas.find((a) => a.id === view.me.areaId);
  const { projectId: _p, ...finds } = (await bashFinds(id))!; // eslint-disable-line @typescript-eslint/no-unused-vars
  return (
    <div className="page max-w-7xl">
      <CrumbName href={`/p/${view.homeKey}/bashes/${id}/explore`} label={`${view.name} · ${area?.name ?? ""}`} />
      {/* Live finds keeps itself current, so the rest of the page (areas, who is where) can wait a bit (ver_237). */}
      <LiveRefresh url={`/api/live/bashes/${id}`} everyMs={2000} gapMs={15_000} />
      <h1 className="mb-4 text-xl font-semibold tracking-tight text-slate-900">
        Bug bash · {view.name}
      </h1>
      <BashTabs homeKey={view.homeKey} bashId={id} area={area?.name ?? ""} finds={findCount(view.items)} current="area" />
      {view.phase === "ended" && <p className="mb-3 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">Time&apos;s up. Your finds are saved, and {view.createdBy} is wrapping up.</p>}
      {view.phase === "scheduled" && <p className="mb-3 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">The bash hasn&apos;t started yet. Logging opens when it does.</p>}
      <BashExplore bash={view} finds={finds} />
    </div>
  );
}

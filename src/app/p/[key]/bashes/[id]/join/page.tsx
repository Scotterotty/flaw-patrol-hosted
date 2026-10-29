import { redirect } from "next/navigation";
import { JoinPicker } from "@/components/bash";
import { CrumbName } from "@/components/crumb-name";
import { LiveRefresh } from "@/components/live-refresh";
import { bashPageData } from "@/lib/bash-page";

export const metadata = { title: "Join the bug bash" };

/** Join the bash: pick an area and go (the Slack button and the shared link land here). */
export default async function JoinBashPage({ params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  const { view } = await bashPageData(key, id);
  if (view.phase === "wrapped") redirect(`/p/${view.homeKey}/bashes/${id}/report`);
  if (view.phase === "ended") redirect(`/p/${view.homeKey}/bashes/${id}`);
  return (
    <div className="mx-auto max-w-6xl">
      <CrumbName href={`/p/${view.homeKey}/bashes/${id}/join`} label={`Join · ${view.name}`} />
      <LiveRefresh url={`/api/live/bashes/${id}`} />
      <h1 className="mb-4 text-center text-xl font-semibold tracking-tight text-slate-900">Join Bug bash · {view.name}</h1>
      <JoinPicker bash={view} />
    </div>
  );
}

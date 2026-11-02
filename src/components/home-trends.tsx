import { db } from "@/lib/db";
import { trendPrefs } from "@/lib/home-trends-calc";
import { loadHomeTrends } from "@/lib/home-trends";
import { platformColor, type Umbrella } from "@/lib/umbrella";
import { HomeTrendsBox } from "./home-trends-box";

/** How testing is going on an umbrella's home. Streams in after the rest of the page. */
export async function HomeTrends({ u, userId, startHref }: { u: Umbrella; userId: string; startHref: string | null }) {
  const [data, me] = await Promise.all([loadHomeTrends(u.hub.id, u.projects.map((p) => p.id)), db.user.findUnique({ where: { id: userId }, select: { openCards: true } })]);
  const platforms = u.platforms.map((p) => ({ name: p.name, color: platformColor(u.platforms, p.name) }));
  return <HomeTrendsBox data={data} platforms={platforms} groupId={u.group.id} initial={trendPrefs(me?.openCards ?? [])} startHref={startHref} />;
}

/** Holds the box's place while its numbers load, so the cards below don't jump. */
export function HomeTrendsLoading() {
  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-surface" aria-busy="true" data-testid="home-trends-loading">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-4 py-3">
        <h2 className="font-semibold text-slate-900">How testing is going</h2>
        <span className="text-sm text-slate-500">Adding up the results…</span>
      </div>
    </section>
  );
}

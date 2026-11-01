import Link from "next/link";
import { redirect } from "next/navigation";
import { RiskBoard } from "@/components/risk-board";
import { RequirementsViews } from "@/components/requirements-views";
import { cx, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { BUILT_IN } from "@/lib/charter-templates";
import { charterHome, teamTemplates } from "@/lib/charter-data";
import { can } from "@/lib/permissions";
import { bashedRequirements } from "@/lib/bash-data";
import { riskBoard } from "@/lib/risk-data";
import { projectAccess } from "@/lib/session";
import { forgetStories } from "@/lib/stories";
import { newestRcNames, storyReleases, testedRelease } from "@/lib/story-coverage";
import { cycleSettingsHref, loadUmbrella, umbrellaOf } from "@/lib/umbrella";
import { db } from "@/lib/db";
import { parseRunKinds, kindLabel } from "@/lib/run-kinds";
import { countStatuses, totals } from "@/lib/status";
import type { PlanData } from "@/components/risk-board";

export const metadata = { title: "Risk board" };

/** Risk board (ver_93): a release's requirements on a grid of how likely to break by how much it would hurt. */
export default async function RiskPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ release?: string; fresh?: string }> }) {
  const { key } = await params;
  const sp = await searchParams;
  const { project, user, who } = await projectAccess(key);
  const home = await charterHome(project);
  const qs = (release?: string) => (release ? `?release=${encodeURIComponent(release)}` : "");
  if (home.id !== project.id) redirect(`/p/${home.key}/risk${qs(sp.release)}`);
  if (sp.fresh) {
    forgetStories();
    redirect(`/p/${project.key}/risk${qs(sp.release)}`);
  }
  const umbrella = await umbrellaOf(project);
  const full = umbrella ? await loadUmbrella(umbrella.group.id, user) : null;
  const cycles = full ? full.current : [project];
  const releases = await storyReleases(project.id);
  const rcNames = await newestRcNames(cycles);
  const release = releases.find((r) => r === sp.release) ?? testedRelease(releases, rcNames);
  // Tools (ver_128): without Test cases the guess leaves out "No tests yet"; without Test runs, Plan this release
  // becomes Start a bug bash on these; without Bug bashes there's no bash button.
  const tools = full?.tools;
  const withCases = !tools || tools.includes("cases");
  const withRuns = !tools || tools.includes("runs");
  const withBashes = !tools || tools.includes("bashes");
  const board = release ? await riskBoard({ homeId: project.id, release, columns: cycles.map((c) => ({ id: c.id, key: c.key, name: c.name })), withCases }) : null;
  const canRun = can(who, "run:create");
  const canPlan = canRun && withRuns;
  const team = canPlan ? await teamTemplates(project.id) : [];
  const bashed = canRun && withBashes ? await bashedRequirements(project.id) : {};
  const runCycles = full?.current.length ? full.current.map((c) => ({ id: c.id, name: c.name })) : [{ id: project.id, name: project.name }];
  // Plan this release (ver_96): run kinds, test personas and open runs to add to.
  const kinds = parseRunKinds(full?.group.runKinds).filter((k) => !k.hidden && k.id !== "bash");
  const planData: PlanData | undefined = canPlan && release
    ? await (async () => {
        const [personas, open] = await Promise.all([
          db.persona.findMany({ where: { projectId: project.id, archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true, emoji: true } }),
          db.testRun.findMany({
            where: { projectId: { in: runCycles.map((c) => c.id) }, state: "ACTIVE", automated: false, kind: { not: "bash" } },
            orderBy: { createdAt: "desc" },
            take: 40,
            select: { id: true, name: true, kind: true, release: true, project: { select: { name: true } }, entries: { select: { status: true } } },
          }),
        ]);
        const label = (r: (typeof open)[number]) => {
          const t = totals(countStatuses(r.entries.map((e) => e.status)));
          return [r.name, r.project.name, kindLabel(kinds, r.kind), `${t.tested} of ${t.total} done`].join(" · ");
        };
        return {
          homeKey: project.key,
          kinds: kinds.map((k) => ({ id: k.id, name: k.name })),
          personas,
          openRuns: [...open.filter((r) => r.release === release), ...open.filter((r) => r.release !== release)].map((r) => ({ id: r.id, label: label(r) })),
        };
      })()
    : undefined;
  const header = (
    <PageHeader
      title="Risk board"
      subtitle="Which requirements in a release are most likely to break, and how much it would hurt. Flaw Patrol makes a first guess; move cards to correct it."
      actions={
        <Link href={`/p/${project.key}/risk?fresh=1${release ? `&release=${encodeURIComponent(release)}` : ""}`} className="text-sm text-slate-500 hover:underline" prefetch={false}>
          Refresh
        </Link>
      }
    />
  );

  if (!releases.length || !board?.connected)
    return (
      <div className="mx-auto max-w-6xl">
        {header}
        <RequirementsViews base={`/p/${project.key}`} current="risk" />
        <EmptyState title={board && !board.connected ? "Jira isn't connected" : "No Jira releases yet"} action={can(who, "jira:manage") ? <LinkButton href={full ? `/g/${full.group.id}/settings#stories` : await cycleSettingsHref(project, user, "jira")}>Open Settings</LinkButton> : null}>
          The Risk board shows the requirements in one Jira release (fix version). Connect Jira and give requirements a fix version, and they show up here.
        </EmptyState>
      </div>
    );

  return (
    <div className="mx-auto max-w-6xl">
      {header}
      <RequirementsViews base={`/p/${project.key}`} current="risk" release={release ?? undefined} />
      <div className="mb-4">
        <div className="mb-1 text-xs font-medium text-slate-500">Release</div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Release">
          {releases.slice(0, 10).map((r) => (
            <Link key={r} href={`/p/${project.key}/risk${qs(r)}`} aria-current={release === r ? "true" : undefined} className={cx("rounded-md border px-2.5 py-1 text-sm", release === r ? "border-accent-600 bg-accent-50 font-medium text-accent-800" : "border-slate-200 hover:bg-slate-50")}>
              {r}
            </Link>
          ))}
        </div>
      </div>
      {board.jiraError && <p className="mb-3 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">Couldn&apos;t read the release from Jira: {board.jiraError}</p>}
      {board.cards.length ? (
        <RiskBoard key={release} homeId={project.id} release={release!} cards={board.cards} canMove={can(who, "risk:move")} canPlan={canPlan} cycles={runCycles} templates={[...BUILT_IN, ...team]} bash={canRun && withBashes ? project.id : undefined} bashed={bashed} planData={planData} withCases={withCases} />
      ) : (
        <EmptyState title="Nothing in this release">Jira has no requirements in {release}. Pick another release above.</EmptyState>
      )}
    </div>
  );
}

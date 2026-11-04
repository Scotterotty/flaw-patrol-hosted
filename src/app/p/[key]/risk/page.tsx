import Link from "next/link";
import { redirect } from "next/navigation";
import { RiskBoard } from "@/components/risk-board";
import { RequirementsViews } from "@/components/requirements-views";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { BUILT_IN } from "@/lib/charter-templates";
import { charterHome, teamTemplates } from "@/lib/charter-data";
import { can } from "@/lib/permissions";
import { bashedRequirements } from "@/lib/bash-data";
import { riskBoard } from "@/lib/risk-data";
import { projectAccess } from "@/lib/session";
import { forgetStories } from "@/lib/stories";
import { newestRcNames, storyReleases, testedRelease } from "@/lib/story-coverage";
import { requirementProjects } from "@/lib/stories-config";
import { pickedProject, pickedReleases, projectOfKey, releaseLabel, reqQuery } from "@/lib/req-filter";
import { ProjectPicker, ReleasePicker } from "@/components/requirement-filters";
import { cycleSettingsHref, loadUmbrella, umbrellaOf } from "@/lib/umbrella";
import { db } from "@/lib/db";
import { parseRunKinds, kindLabel } from "@/lib/run-kinds";
import { countStatuses, totals } from "@/lib/status";
import type { PlanData } from "@/components/risk-board";

export const metadata = { title: "Risk board" };

/** Risk board: a release's requirements on a grid of how likely to break by how much it would hurt. */
export default async function RiskPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ release?: string | string[]; proj?: string | string[]; fresh?: string }> }) {
  const { key } = await params;
  const sp = await searchParams;
  const { project, user, who } = await projectAccess(key);
  const home = await charterHome(project);
  // The picks as they came in, for redirects (several releases and a project since ver_161).
  const asIs = reqQuery({ releases: (Array.isArray(sp.release) ? sp.release : sp.release ? [sp.release] : []).filter((r) => r !== "any"), proj: Array.isArray(sp.proj) ? sp.proj[0] : sp.proj });
  if (home.id !== project.id) redirect(`/p/${home.key}/risk${asIs}`);
  if (sp.fresh) {
    forgetStories();
    redirect(`/p/${project.key}/risk${asIs}`);
  }
  const umbrella = await umbrellaOf(project);
  const full = umbrella ? await loadUmbrella(umbrella.group.id, user) : null;
  const cycles = full ? full.current : [project];
  const releases = await storyReleases(project.id);
  const rcNames = await newestRcNames(cycles);
  const picked = pickedReleases(sp.release, releases);
  const tested = testedRelease(releases, rcNames);
  // The Risk board always shows a release: the picked ones, else the one the current test cycles test.
  const chosen = picked && picked !== "any" ? picked : tested ? [tested] : [];
  const release = chosen.length ? releaseLabel(chosen) : null;
  // Tools: without Test cases the guess leaves out "No tests yet"; without Test runs, Plan this release
  // becomes Start a bug bash on these; without Bug bashes there's no bash button.
  const tools = full?.tools;
  const withCases = !tools || tools.includes("cases");
  const withRuns = !tools || tools.includes("runs");
  const withBashes = !tools || tools.includes("bashes");
  const board = release ? await riskBoard({ homeId: project.id, release: chosen, columns: cycles.map((c) => ({ id: c.id, key: c.key, name: c.name })), withCases }) : null;
  // Show stories from (ver_161): one of several requirement projects.
  const reqKeys = board?.config ? requirementProjects(board.config, board.bugProject ?? "") : null;
  const proj = pickedProject(sp.proj, reqKeys);
  const cards = board ? (proj ? board.cards.filter((c) => projectOfKey(c.key) === proj) : board.cards) : [];
  const here = (picks: { releases?: string[] | "any"; proj?: string | null }) => `/p/${project.key}/risk${reqQuery({ releases: "releases" in picks ? picks.releases : chosen, proj: "proj" in picks ? picks.proj : proj })}`;
  const canRun = can(who, "run:create");
  const canPlan = canRun && withRuns;
  const team = canPlan ? await teamTemplates(project.id) : [];
  const bashed = canRun && withBashes ? await bashedRequirements(project.id) : {};
  const runCycles = full?.current.length ? full.current.map((c) => ({ id: c.id, name: c.name })) : [{ id: project.id, name: project.name }];
  // Plan this release: run kinds, test personas and open runs to add to.
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
          openRuns: [...open.filter((r) => chosen.includes(r.release)), ...open.filter((r) => !chosen.includes(r.release))].map((r) => ({ id: r.id, label: label(r) })),
        };
      })()
    : undefined;
  const header = (
    <PageHeader
      title="Risk board"
      subtitle="Which requirements in a release are most likely to break, and how much it would hurt. Flaw Patrol makes a first guess; move cards to correct it."
      actions={
        <Link href={`/p/${project.key}/risk${reqQuery({ releases: chosen, proj }, { fresh: "1" })}`} className="text-sm text-slate-500 hover:underline" prefetch={false}>
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
      <RequirementsViews base={`/p/${project.key}`} current="risk" query={reqQuery({ releases: chosen, proj })} />
      <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3">
        <ProjectPicker keys={reqKeys} picked={proj} hrefFor={(k) => here({ proj: k })} />
        <ReleasePicker label="Release" releases={releases} picked={chosen} limit={10} hrefFor={(r) => here({ releases: r })} />
      </div>
      {board.jiraError && <p className="mb-3 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">Couldn&apos;t read the release from Jira: {board.jiraError}</p>}
      {cards.length ? (
        <RiskBoard key={`${chosen.join("|")}|${proj ?? ""}`} homeId={project.id} release={release!} releases={chosen} cards={cards} canMove={can(who, "risk:move")} canPlan={canPlan} cycles={runCycles} templates={[...BUILT_IN, ...team]} bash={canRun && withBashes ? project.id : undefined} bashed={bashed} planData={planData} withCases={withCases} />
      ) : (
        <EmptyState title="Nothing in this release">Jira has no requirements{proj ? ` from ${proj}` : ""} in {release}. Pick another release above.</EmptyState>
      )}
    </div>
  );
}

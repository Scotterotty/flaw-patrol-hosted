import Link from "next/link";
import { redirect } from "next/navigation";
import { StoryRows } from "@/components/story-coverage";
import { RequirementsViews } from "@/components/requirements-views";
import { cx, EmptyState, InfoTip, LinkButton, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { buildTree, flattenTree, pathOf } from "@/lib/folders";
import { projectAccess } from "@/lib/session";
import { forgetStories } from "@/lib/stories";
import { newestRcNames, storyCoverage, storyReleases, testedRelease, type CoverageState } from "@/lib/story-coverage";
import { requirementProjects, requirementSource } from "@/lib/stories-config";
import { pickedProject, pickedReleases, projectOfKey, releaseLabel, reqQuery } from "@/lib/req-filter";
import { ProjectPicker, ReleasePicker } from "@/components/requirement-filters";
import { suitePickerData } from "@/lib/suite-data";
import { cycleSettingsHref, loadUmbrella, umbrellaOf } from "@/lib/umbrella";

export const metadata = { title: "Requirements" };

const CHIPS: { id: "all" | CoverageState; label: string }[] = [
  { id: "all", label: "All" },
  { id: "none", label: "No cases" },
  { id: "failing", label: "Failing" },
  { id: "notrun", label: "Not run yet" },
  { id: "passing", label: "Passing" },
];

/** Jira requirements (stories, Epics, any linked type) and the cases that test them. Lives on an umbrella's hub, or on a test cycle outside an umbrella. */
export default async function StoriesPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { key } = await params;
  const sp = await searchParams;
  const { project, user, who } = await projectAccess(key);
  const umbrella = await umbrellaOf(project);
  if (umbrella && !umbrella.isHub) redirect(`/p/${umbrella.hub.key}/stories`);
  if (sp.fresh) {
    forgetStories();
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (k !== "fresh") for (const one of Array.isArray(v) ? v : v ? [v] : []) u.append(k, one);
    redirect(`/p/${project.key}/stories${u.size ? `?${u}` : ""}`);
  }

  const full = umbrella ? await loadUmbrella(umbrella.group.id, user) : null;
  const latestAnywhere = sp.from === "latest";
  const cycles = full ? (latestAnywhere ? full.projects : full.current) : [project];
  const columns = cycles.map((c) => ({ id: c.id, key: c.key, name: c.name }));
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const releases = await storyReleases(project.id);
  // Starts on the release the current test cycles test, not Jira's newest. Several can be picked (ver_161).
  const picked = pickedReleases(sp.release, releases);
  const tested = picked ? null : testedRelease(releases, await newestRcNames(full ? full.current : [project]));
  const release: string[] | null = picked === "any" ? null : (picked ?? (tested ? [tested] : null));
  const relLabel = release ? releaseLabel(release) : null;
  const cov = await storyCoverage({ projectId: project.id, libraryIds: [project.id], columns, release, latestAnywhere, everything: true });
  // Show stories from (ver_161): one of several requirement projects.
  const reqKeys = cov.config ? requirementProjects(cov.config, cov.bugProject ?? "") : null;
  const proj = pickedProject(sp.proj, reqKeys);
  const inProj = proj ? cov.rows.filter((r) => projectOfKey(r.story.key) === proj) : cov.rows;
  // Hide done (ver_161), on unless the address says done=show: requirements Jira counts as Done.
  const hideDone = one(sp.done) !== "show";
  const doneCount = inProj.filter((r) => r.story.category === "done").length;
  const shown = hideDone ? inProj.filter((r) => r.story.category !== "done") : inProj;
  const counts = { all: shown.length, none: 0, failing: 0, notrun: 0, passing: 0 } as Record<"all" | CoverageState, number>;
  for (const r of shown) counts[r.state]++;
  const show = (CHIPS.find((c) => c.id === one(sp.show))?.id ?? "all") as "all" | CoverageState;
  // Type filter: only the Jira types that are on the page.
  const type = cov.types.find((t) => t.toLowerCase() === one(sp.type)?.toLowerCase()) ?? null;
  const openKey = one(sp.open);
  const made = one(sp.made);
  const rows = shown.filter((r) => (show === "all" || r.state === show) && (!type || r.story.type === type));
  const canEdit = can(who, "case:edit");
  const picker = canEdit ? (await suitePickerData(project)).cases.map((c) => ({ id: c.id, key: c.key, title: c.title, folder: c.folderPath })) : [];
  // New cases from a requirement go into this library's folders.
  const folderRows = canEdit ? await db.folder.findMany({ where: { projectId: project.id }, select: { id: true, parentId: true, name: true } }) : [];
  const folders = flattenTree(buildTree(folderRows)).map((f) => ({ id: f.id, label: pathOf(folderRows, f.id).join(" / ") }));
  // Links keep the other filters. Release and project picks are written by reqQuery.
  const qs = (extra: Record<string, string | undefined>, picks: { releases?: string[] | "any" | null; proj?: string | null } = {}) => {
    const rest: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(sp)) if (k !== "release" && k !== "proj") rest[k] = one(v);
    return reqQuery({ releases: "releases" in picks ? picks.releases : picked, proj: "proj" in picks ? picks.proj : proj }, { ...rest, ...extra }) || "?";
  };
  const source = cov.config ? requirementSource(cov.config, cov.bugProject ?? "") : "Jira";
  // "Stories and Epics from Jira project PB": says what the page lists.
  const many = cov.types.map((t) => (/[^aeiou]y$/i.test(t) ? `${t.slice(0, -1)}ies` : `${t}s`));
  const kinds = many.length === 0 ? "Requirements" : many.length === 1 ? many[0] : `${many.slice(0, -1).join(", ")} and ${many.at(-1)}`;

  if (!cov.connected)
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title="Requirements" />
        <EmptyState title="Jira isn't connected" action={can(who, "jira:manage") ? <LinkButton href={await cycleSettingsHref(project, user, "jira")}>Open Settings</LinkButton> : null}>
          Requirements come from Jira. Once Jira is connected, link cases to stories, Epics or other requirements, and their coverage shows here.
        </EmptyState>
      </div>
    );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Requirements"
        subtitle={`${kinds} from ${source}`}
        actions={
          <Link href={qs({ fresh: "1" })} className="text-sm text-slate-500 hover:underline" prefetch={false}>
            Refresh
          </Link>
        }
      />
      <RequirementsViews base={`/p/${project.key}`} current="list" query={reqQuery({ releases: release, proj })} />
      <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-3 text-sm">
        <ProjectPicker keys={reqKeys} picked={proj} hrefFor={(k) => qs({ show: undefined, type: undefined }, { proj: k })} />
        <ReleasePicker label="Jira release" releases={releases} picked={picked === "any" ? "any" : release} withAny hrefFor={(r) => qs({ show: undefined }, { releases: r })} />
        {release && (
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500">
              Results from <InfoTip text="Runs marked with this release in the current test cycles, or each case's newest result in any run." />
            </div>
            <div className="flex gap-1" role="group" aria-label="Results from">
              {[
                { id: undefined, label: `${relLabel} runs` },
                { id: "latest", label: "Latest anywhere" },
              ].map((o) => (
                <Link key={o.label} href={qs({ from: o.id })} aria-current={(o.id === "latest") === latestAnywhere ? "true" : undefined} className={cx("rounded-md border px-2.5 py-1", (o.id === "latest") === latestAnywhere ? "border-accent-600 bg-accent-50 font-medium text-accent-800" : "border-slate-200 hover:bg-slate-50")}>
                  {o.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
      {cov.jiraError && <p className="mb-3 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">Couldn&apos;t read the release from Jira: {cov.jiraError} Showing requirements that already have cases.</p>}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {CHIPS.map((c) => (
            <Link key={c.id} href={qs({ show: c.id === "all" ? undefined : c.id })} aria-current={show === c.id ? "true" : undefined} className={cx("rounded-full border px-3 py-1 text-sm", show === c.id ? "border-accent-600 bg-accent-600 text-white" : "border-slate-200 hover:bg-slate-50")}>
              {c.label} <span className={show === c.id ? "text-white/80" : "text-slate-500"}>{counts[c.id]}</span>
            </Link>
          ))}
        </div>
        <Link
          href={qs({ done: hideDone ? "show" : undefined })}
          role="switch"
          aria-checked={hideDone}
          title={hideDone ? "Done requirements are hidden. Click to show them." : "Click to hide requirements Jira counts as Done."}
          className="ml-auto flex items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
        >
          <span aria-hidden className={cx("relative inline-block h-4 w-7 rounded-full transition-colors", hideDone ? "bg-accent-600" : "bg-slate-300")}>
            <span className={cx("absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all", hideDone ? "right-0.5" : "left-0.5")} />
          </span>
          Hide done <span className="text-slate-500">({doneCount})</span>
        </Link>
      </div>
      {cov.types.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-sm" role="group" aria-label="Type">
          <span className="text-xs font-medium text-slate-500">Type:</span>
          {[null, ...cov.types].map((t) => (
            <Link key={t ?? "all"} href={qs({ type: t ?? undefined })} aria-current={type === t ? "true" : undefined} className={cx("rounded-md border px-2.5 py-0.5", type === t ? "border-accent-600 bg-accent-50 font-medium text-accent-800" : "border-slate-200 hover:bg-slate-50")}>
              {t ?? "All"}
            </Link>
          ))}
        </div>
      )}
      {rows.length ? (
        <StoryRows
          projectId={project.id}
          projectKey={project.key}
          rows={rows}
          canEdit={canEdit}
          library={picker}
          folders={folders}
          openKey={openKey}
          flash={made && openKey ? (made === "charter" ? `Created a charter and linked it to ${openKey}.` : `Created ${made} ${made === "1" ? "case" : "cases"} and linked ${made === "1" ? "it" : "them"} to ${openKey}.`) : undefined}
        />
      ) : (
        <EmptyState title={inProj.length ? "No requirements match" : "No requirements yet"}>
          {inProj.length
            ? hideDone && doneCount && !shown.length
              ? `All ${doneCount} are done in Jira. Turn off Hide done to see them.`
              : "Pick another filter above."
            : relLabel
              ? `Jira has no requirements${proj ? ` from ${proj}` : ""} in ${relLabel}, and no case links one.`
              : `Jira has no ${kinds.toLowerCase()} in ${proj ? `Jira project ${proj}` : source}, and no case links one. Check the issue types in Settings, Requirements.`}
        </EmptyState>
      )}
    </div>
  );
}

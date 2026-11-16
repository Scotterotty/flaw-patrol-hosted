import { Fragment } from "react";
import { forgivingFilter } from "@/lib/fuzzy";
import { NOT_BASH_CASE, NOT_BASH_RUN } from "@/lib/bash-cases";
import { CloseMatchesLabel } from "@/components/close-matches";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoFilterForm } from "@/components/auto-filter-form";
import { CrumbName } from "@/components/crumb-name";
import { EditGroupButton, type GroupChoice } from "@/components/group-dialogs";
import { OpenOnLoad } from "@/components/open-on-load";
import { TopBar } from "@/components/top-bar";
import { Badge, Card, cx, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { relativeTime } from "@/lib/format";
import { canManageGroups } from "@/lib/groups";
import { requireUser, mySpelling } from "@/lib/session";
import { readingBannerDue } from "@/lib/easier-reading";
import { ReadingBanner } from "@/components/reading-banner";
import { loadUmbrella } from "@/lib/umbrella";
import { MakeUmbrellaButton } from "@/components/umbrella-ui";
import { Runs } from "./lists";
import { UmbrellaHome } from "./umbrella-home";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const g = await db.projectGroup.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: g?.name ?? "Group" };
}

type Tab = "suites" | "projects" | "runs";
const TABS: { id: Tab; label: string }[] = [
  { id: "suites", label: "Suites" },
  { id: "projects", label: "Test cycles" },
  { id: "runs", label: "Test runs" },
];

/**
 * One project group: every suite, project and run across its projects in one place,
 * filtered to one project if you like. Archived projects only show when asked for.
 */
export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; project?: string; archived?: string; q?: string; state?: string; edit?: string; welcome?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const umbrella = await loadUmbrella(id, user);
  if (umbrella) return <UmbrellaHome u={umbrella} user={user} welcome={sp.welcome === "1"} />;
  const group = await db.projectGroup.findUnique({ where: { id } });
  if (!group) notFound();
  const manager = await canManageGroups(user);
  const all = await db.project.findMany({
    where: { groupId: id, ...(user.isAdmin ? {} : { members: { some: { userId: user.id } } }) },
    include: {
      members: { where: { userId: user.id } },
      _count: { select: { cases: { where: { archived: false, ...NOT_BASH_CASE } }, members: true, runs: { where: { state: "ACTIVE", ...NOT_BASH_RUN } } } },
    },
    orderBy: { name: "asc" },
  });
  if (all.length === 0 && !manager) notFound();

  const tab: Tab = sp.tab === "projects" || sp.tab === "runs" ? sp.tab : "suites";
  const withArchived = sp.archived === "1";
  const archivedCount = all.filter((p) => p.archivedAt).length;
  const shown = all.filter((p) => withArchived || !p.archivedAt);
  const only = shown.find((p) => p.key === sp.project?.toUpperCase());
  const ids = (only ? [only] : shown).map((p) => p.id);
  const q = (sp.q ?? "").trim();

  // For the Edit group box: every project you can see, and which ones you may move.
  let choices: GroupChoice[] = [];
  if (manager) {
    const visible = await db.project.findMany({
      where: user.isAdmin ? {} : { members: { some: { userId: user.id } } },
      include: { members: { where: { userId: user.id } }, group: { select: { name: true } } },
      orderBy: { name: "asc" },
    });
    choices = visible.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      archived: p.archivedAt !== null,
      groupId: p.groupId,
      groupName: p.group?.name ?? null,
      canMove: user.isAdmin || can(p.members[0]?.role ?? null, "project:group"),
    }));
  }

  const link = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { tab, project: only?.key, archived: withArchived ? "1" : undefined, q: q || undefined, state: sp.state, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "tab" && v === "suites")) next.set(k, v);
    const s = next.toString();
    return s ? `?${s}` : "?";
  };
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <>
      <TopBar user={user} />
      <main id="main" tabIndex={-1} className="page page-list px-4 py-8">
        {readingBannerDue(user, new Date()) && <ReadingBanner />}
        <PageHeader
          title={
            <>
              <span aria-hidden>📁 </span>
              {group.name}
            </>
          }
          subtitle={group.description || `${plural(all.length - archivedCount, "test cycle")}${archivedCount ? `, plus ${archivedCount} archived` : ""}. Everyone on the team sees this group.`}
          actions={
            manager ? (
              <div className="flex flex-wrap gap-2">
                {user.isAdmin && !group.hubProjectId && <MakeUmbrellaButton groupId={group.id} name={group.name} />}
                <EditGroupButton group={group} choices={choices} />
              </div>
            ) : undefined
          }
        />
        <CrumbName href={`/g/${group.id}`} label={group.name} />
        {manager && sp.edit === "1" && <OpenOnLoad label="Edit group" />}

        <nav className="mb-4 flex gap-1 border-b border-slate-200" aria-label="Group views">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={link({ tab: t.id, q: undefined, state: undefined })}
              aria-current={tab === t.id ? "page" : undefined}
              className={cx(
                "-mb-px border-b-2 px-3 py-2 text-sm",
                tab === t.id ? "border-accent-600 font-medium text-accent-700" : "border-transparent text-slate-600 hover:text-slate-900",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <AutoFilterForm className="mb-4 flex flex-wrap items-center gap-2">
          {tab !== "suites" && <input type="hidden" name="tab" value={tab} />}
          {tab !== "projects" && (
            <Select name="project" defaultValue={only?.key ?? ""} aria-label="Test cycle" className="w-auto min-w-56 max-w-full">
              <option value="">All test cycles</option>
              {shown.map((p) => (
                <option key={p.id} value={p.key}>
                  {p.name}
                  {p.archivedAt ? " (archived)" : ""}
                </option>
              ))}
            </Select>
          )}
          {tab === "suites" && <Input name="q" type="search" defaultValue={q} placeholder="Search suites" aria-label="Search suites" className="max-w-xs flex-1" />}
          {tab === "runs" && (
            <Select name="state" defaultValue={sp.state ?? ""} aria-label="Run state" className="w-auto max-w-full">
              <option value="">Active and closed</option>
              <option value="active">Active only</option>
              <option value="closed">Closed only</option>
            </Select>
          )}
          {archivedCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" name="archived" value="1" defaultChecked={withArchived} className="accent-accent-600" />
              Include archived test cycles ({archivedCount})
            </label>
          )}
        </AutoFilterForm>

        {all.length === 0 ? (
          <EmptyState title="No test cycles in this group yet">Press Edit group and tick the test cycles that belong here.</EmptyState>
        ) : tab === "suites" ? (
          <Suites projectIds={ids} q={q} />
        ) : tab === "runs" ? (
          <Runs projectIds={ids} state={sp.state} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p) => (
              <Link key={p.id} href={`/p/${p.key}`}>
                <Card className={cx("h-full p-4 transition hover:border-accent-500 hover:shadow", p.archivedAt && "opacity-75")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-accent-700">{p.key}</span>
                    {p.archivedAt && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">Archived</span>}
                  </div>
                  <h3 className="mt-1 font-semibold text-slate-900">{p.name}</h3>
                  <p className="mt-2 text-xs text-slate-500">
                    {p._count.runs > 0 ? `${plural(p._count.runs, "active run")} · ` : ""}
                    {plural(p._count.cases, "case")} · {plural(p._count.members, "member")}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

async function Suites({ projectIds, q }: { projectIds: string[]; q: string }) {
  const spelling = await mySpelling();
  // Forgiving search: exact matches, then close ones under their own label.
  const all = await db.testSuite.findMany({
    where: { projectId: { in: projectIds }, archived: false },
    include: {
      project: { select: { key: true, name: true, archivedAt: true } },
      _count: { select: { cases: true } },
      runs: { orderBy: { createdAt: "desc" }, take: 1, select: { number: true, release: true, createdAt: true } },
    },
    orderBy: [{ name: "asc" }],
    take: 2000,
  });
  const found = forgivingFilter(all, q, (s) => s.name);
  const suites = [...found.exact, ...found.close].slice(0, 500);
  const closeStart = found.close.length ? found.exact.length : -1;
  if (suites.length === 0) return <EmptyState title={q ? `No suites match “${q}”` : "No suites yet"}>{q ? "Try fewer words." : "Suites made in these test cycles show up here."}</EmptyState>;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="px-4 py-2 font-medium">Suite</th>
            <th className="px-4 py-2 font-medium">Test cycle</th>
            <th className="px-4 py-2 text-right font-medium">Cases</th>
            <th className="px-4 py-2 font-medium">Version</th>
            <th className="px-4 py-2 font-medium">Last run</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {suites.map((s, i) => {
            const last = s.runs[0];
            return (
              <Fragment key={s.id}>
              {i === closeStart && (
                <tr>
                  <td colSpan={8} className="px-0 py-1">
                    {closeStart === 0 && <p className="px-4 pb-1 text-xs text-slate-500">No exact matches.</p>}
                    <CloseMatchesLabel className="px-4" />
                  </td>
                </tr>
              )}
              <tr className={cx("hover:bg-slate-50", s.project.archivedAt && "opacity-60")}>
                <td className="px-4 py-2">
                  <Link href={`/p/${s.project.key}/suites/${s.id}`} className="font-medium text-accent-700 hover:underline">
                    {s.name}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <Badge tone="gray">
                    {s.project.name}
                    {s.project.archivedAt ? " · archived" : ""}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{s._count.cases}</td>
                <td className="px-4 py-2 text-slate-600">v{s.currentVersion}</td>
                <td className="px-4 py-2 text-slate-600">
                  {last ? (
                    <Link href={`/p/${s.project.key}/runs/${last.number}`} className="hover:underline">
                      {[last.release && `Release ${last.release}`, relativeTime(last.createdAt, spelling)].filter(Boolean).join(" · ")}
                    </Link>
                  ) : (
                    <span className="text-slate-400">Never run</span>
                  )}
                </td>
              </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

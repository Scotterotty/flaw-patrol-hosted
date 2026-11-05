import Link from "next/link";
import { MoreMenu } from "@/components/more-menu";
import { StatusBar } from "@/components/status";
import { ArchiveSuiteButton, RenameSuiteButton } from "@/components/suite-actions";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { count, relativeTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { projectAccess, mySpelling } from "@/lib/session";
import { hubGroupId, umbrellaOf } from "@/lib/umbrella";
import { countStatuses, pct, totals } from "@/lib/status";

export const metadata = { title: "Test suites" };

export default async function SuitesPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ archived?: string }> }) {
  const spelling = await mySpelling();
  const { key } = await params;
  const archived = (await searchParams).archived === "1";
  const { project, who } = await projectAccess(key);
  // Under an umbrella the umbrella's shared suites are listed too, ready to run here.
  const umbrella = await umbrellaOf(project);
  const library = umbrella && !umbrella.isHub ? [project.id, umbrella.hub.id] : [project.id];
  // Under an umbrella, new suites go in its library, so every test cycle can run them.
  const newSuite = umbrella && !umbrella.isHub ? `/p/${umbrella.hub.key}/suites/new` : `/p/${project.key}/suites/new`;
  const suites = await db.testSuite.findMany({
    where: { projectId: { in: library }, archived },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { cases: true, runs: { where: { projectId: project.id } } } },
      runs: { where: { projectId: project.id }, orderBy: { number: "desc" }, take: 1, include: { entries: { select: { status: true } } } },
    },
  });

  // Each of this project's own suites gets a ⋯ menu to rename (and archive, for people allowed to).
  // Shared umbrella suites are renamed in the umbrella.
  const manage = can(who, "suite:manage");
  const canArchive = can(who, "library:archive");
  const allNames = manage ? (await db.testSuite.findMany({ where: { projectId: project.id }, select: { id: true, name: true } })) : [];
  const hubOf = manage ? await hubGroupId(project.id) : null;
  const sharedWith = hubOf ? await db.project.count({ where: { groupId: hubOf, archivedAt: null, id: { not: project.id } } }) : 0;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={archived ? "Archived suites" : "Test suites"}
        subtitle="Sets of cases you run again and again, such as a smoke test or a release regression."
        actions={
          <>
            <Link href={archived ? "?" : "?archived=1"} className="text-sm text-slate-500 hover:underline">
              {archived ? "Show active" : "Show archived"}
            </Link>
            {can(who, "suite:manage") && (
              <LinkButton variant="primary" href={newSuite} data-howto="suites-new">
                New suite
              </LinkButton>
            )}
          </>
        }
      />
      {suites.length === 0 ? (
        <EmptyState
          title={archived ? "Nothing archived" : "No suites yet"}
          action={
            !archived && can(who, "suite:manage") ? (
              <LinkButton variant="primary" href={newSuite} data-howto="suites-new">
                New suite
              </LinkButton>
            ) : null
          }
        >
          {!archived && "Group the cases you run together, like “Smoke test” or “Checkout regression”, then start runs from them."}
        </EmptyState>
      ) : (
        <Card className="divide-y divide-slate-100">
          {suites.map((s) => {
            const last = s.runs[0];
            const counts = last ? countStatuses(last.entries.map((e) => e.status)) : null;
            return (
              <div key={s.id} className="flex items-center gap-2 hover:bg-slate-50">
              <Link href={`/p/${project.key}/suites/${s.id}`} className="grid min-w-0 flex-1 gap-2 px-4 py-3 sm:grid-cols-[1fr_16rem]">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {s.name}
                    {s.projectId !== project.id && <span className="ml-2 rounded-full bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700">Shared</span>}
                  </p>
                  <p className="truncate text-sm text-slate-500">
                    {count(s._count.cases, "case")} · {count(s._count.runs, "run")}{s.description ? ` · ${s.description}` : ""}
                  </p>
                </div>
                <div className="text-xs text-slate-500">
                  {last && counts ? (
                    <>
                      <StatusBar counts={counts} />
                      <p className="mt-1">
                        Last run R{last.number} {relativeTime(last.createdAt, spelling)} · {pct(totals(counts).passRate)} passed
                      </p>
                    </>
                  ) : (
                    "Not run yet"
                  )}
                </div>
              </Link>
              {manage && s.projectId === project.id && (
                <div className="pr-3">
                  <MoreMenu label="⋯" caret={false} size="sm" ariaLabel={`Actions for ${s.name}`} title="Rename or archive">
                    <RenameSuiteButton
                      projectId={project.id}
                      suiteId={s.id}
                      name={s.name}
                      otherNames={allNames.filter((n) => n.id !== s.id).map((n) => n.name)}
                      sharedWith={sharedWith}
                      look="menu"
                    />
                    {canArchive && <ArchiveSuiteButton projectId={project.id} suiteId={s.id} archived={s.archived} />}
                  </MoreMenu>
                </div>
              )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

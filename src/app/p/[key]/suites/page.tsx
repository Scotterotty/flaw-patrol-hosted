import Link from "next/link";
import { StatusBar } from "@/components/status";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { relativeTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { projectAccess, mySpelling } from "@/lib/session";
import { umbrellaOf } from "@/lib/umbrella";
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
              <LinkButton variant="primary" href={newSuite}>
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
              <LinkButton variant="primary" href={newSuite}>
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
              <Link key={s.id} href={`/p/${project.key}/suites/${s.id}`} className="grid gap-2 px-4 py-3 hover:bg-slate-50 sm:grid-cols-[1fr_16rem]">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {s.name}
                    {s.projectId !== project.id && <span className="ml-2 rounded-full bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700">Shared</span>}
                  </p>
                  <p className="truncate text-sm text-slate-500">
                    {s._count.cases} cases · {s._count.runs} runs{s.description ? ` · ${s.description}` : ""}
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
            );
          })}
        </Card>
      )}
    </div>
  );
}

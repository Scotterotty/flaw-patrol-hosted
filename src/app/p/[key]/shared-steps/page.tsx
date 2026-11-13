import Link from "next/link";
import { Badge, Card, EmptyState, InfoTip, LinkButton, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { relativeTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { projectAccess, mySpelling } from "@/lib/session";
import { parseParams, parsePlainSteps } from "@/lib/steps";

export const metadata = { title: "Shared steps" };

export default async function SharedStepsPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ archived?: string }> }) {
  const spelling = await mySpelling();
  const { key } = await params;
  const archived = (await searchParams).archived === "1";
  const { project, who } = await projectAccess(key);
  const rows = await db.sharedStep.findMany({
    where: { projectId: project.id, archived },
    orderBy: { name: "asc" },
    include: { versions: { orderBy: { version: "desc" }, take: 1 }, _count: { select: { usages: true } } },
  });

  return (
    <div className="page page-list">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {archived ? "Archived shared steps" : "Shared steps"}
            <InfoTip text="Looking for whole test cases? They're in the Case library (or Test cases in a test cycle)." />
          </span>
        }
        subtitle="A few steps written once, like “Sign in”. Add them to a new or existing case; they go in as extra steps and never replace the steps already there. Edit one and every case using it updates."
        actions={
          <>
            <Link href={archived ? "?" : "?archived=1"} className="text-sm text-slate-500 hover:underline">
              {archived ? "Show active" : "Show archived"}
            </Link>
            {can(who, "shared:manage") && (
              <LinkButton variant="primary" href={`/p/${project.key}/shared-steps/new`} data-howto="shared-new">
                New shared step
              </LinkButton>
            )}
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          title={archived ? "Nothing archived" : "No shared steps yet"}
          action={
            !archived && can(who, "shared:manage") ? (
              <LinkButton variant="primary" href={`/p/${project.key}/shared-steps/new`} data-howto="shared-new">
                New shared step
              </LinkButton>
            ) : null
          }
        >
          {!archived && "Make one here, or tick steps while editing a case and press Make shared step. Then add it to any case with + Insert shared step."}
        </EmptyState>
      ) : (
        <Card className="divide-y divide-slate-100">
          {rows.map((r) => {
            const v = r.versions[0];
            const steps = parsePlainSteps(v?.steps);
            const ps = parseParams(v?.parameters);
            return (
              <Link key={r.id} href={`/p/${project.key}/shared-steps/${r.id}`} className="block px-4 py-3 hover:bg-slate-50">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{r.name}</span>
                  {ps.map((p) => (
                    <Badge key={p.name} tone="violet">
                      {p.name}
                    </Badge>
                  ))}
                  <span className="ml-auto text-xs text-slate-500">
                    {steps.length} steps · used in {r._count.usages} {r._count.usages === 1 ? "case" : "cases"} · v{r.currentVersion} · {relativeTime(r.updatedAt, spelling)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-sm text-slate-500">{r.description || steps.map((s) => s.action).join(" → ")}</p>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}

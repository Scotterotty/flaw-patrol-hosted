import { KindSelect } from "@/components/kind-select";
import { parseRunKinds } from "@/lib/run-kinds";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoFilterForm } from "@/components/auto-filter-form";
import { StartRunBox } from "@/components/start-run-box";
import { StartBashButton } from "@/components/bash-start";
import { UploadAutomationButton } from "@/components/automation-upload";
import { can } from "@/lib/permissions";
import { Card, EmptyState, PageHeader, Select } from "@/components/ui";
import { ViewTabs } from "@/components/view-tabs";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { loadUmbrella } from "@/lib/umbrella";
import { Runs } from "../lists";

export const metadata = { title: "Test runs" };

/** Every run across the umbrella's projects, or just the cases waiting for you. */
export default async function UmbrellaRunsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ state?: string; project?: string; mine?: string; kind?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const u = await loadUmbrella(id, user);
  if (!u) notFound();
  const all = [u.hub, ...u.projects];
  const only = u.projects.find((p) => p.key === sp.project?.toUpperCase());
  const ids = only ? [only.id] : all.map((p) => p.id);
  const closed = sp.state === "closed";
  const automated = sp.state === "automated";
  const [active, done, auto] = await Promise.all([
    db.testRun.count({ where: { projectId: { in: ids }, state: "ACTIVE" } }),
    db.testRun.count({ where: { projectId: { in: ids }, state: "COMPLETED", automated: false } }),
    db.testRun.count({ where: { projectId: { in: ids }, automated: true } }),
  ]);
  const canUpload = !u.group.archivedAt && (await mayUpload(u, user));
  const q = (patch: Record<string, string | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries({ project: only?.key, state: sp.state, kind: sp.kind, ...patch })) if (v) s.set(k, v);
    return `?${s}`;
  };

  if (sp.mine === "1") {
    const runs = await db.testRun.findMany({
      where: { projectId: { in: ids }, state: "ACTIVE", entries: { some: { assigneeId: user.id, status: { in: ["UNTESTED", "RETEST", "IN_PROGRESS"] } } } },
      orderBy: { createdAt: "desc" },
      include: { project: { select: { key: true, name: true } }, entries: { where: { assigneeId: user.id }, select: { status: true } } },
    });
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="My assigned cases" subtitle={`Cases waiting for you in ${u.group.name}'s active runs`} />
        {runs.length === 0 ? (
          <EmptyState title="Nothing waiting for you">When someone assigns you cases in an active run, they show up here.</EmptyState>
        ) : (
          <Card className="divide-y divide-slate-100">
            {runs.map((r) => {
              const left = r.entries.filter((e) => e.status === "UNTESTED" || e.status === "RETEST" || e.status === "IN_PROGRESS").length;
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900">
                      <span className="font-mono text-xs text-slate-500">R{r.number}</span> {r.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {r.project.name} · {left} of {r.entries.length} still to test
                    </span>
                  </span>
                  <Link href={`/p/${r.project.key}/runs/${r.number}/execute?mine=1`} className="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700">
                    Test my cases
                  </Link>
                </div>
              );
            })}
          </Card>
        )}
      </div>
    );
  }

  const kinds = parseRunKinds(u.group.runKinds);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Test runs" subtitle={`Every run across ${u.group.name}'s test cycles, newest first`} 
        actions={
          !u.group.archivedAt && (
            <>
              {canUpload && <UploadAutomationButton scope={{ groupId: u.group.id }} />}
              {can(u.who, "run:create") && <StartBashButton projectId={u.hub.id} hideButton />}
              {can(u.who, "run:create") && <StartRunBox scope={{ groupId: u.group.id }} />}
            </>
          )
        }
      />
      <ViewTabs
        label="Run state"
        tabs={[
          { label: "Active", href: q({ state: undefined }), count: active, current: !closed && !automated },
          { label: "🤖 Automated", href: q({ state: "automated" }), count: auto, current: automated },
          { label: "Closed", href: q({ state: "closed" }), count: done, current: closed },
        ]}
      />
      <AutoFilterForm className="mb-4 flex flex-wrap items-center gap-2">
        {(closed || automated) && <input type="hidden" name="state" value={sp.state} />}
        {u.projects.length > 1 && (
          <Select name="project" defaultValue={only?.key ?? ""} aria-label="Test cycle" className="w-auto min-w-64 max-w-full">
            <option value="">All {u.group.name} test cycles</option>
            {u.projects.map((p) => (
              <option key={p.id} value={p.key}>
                {p.name}
                {p.archivedAt ? " (archived)" : ""}
              </option>
            ))}
          </Select>
        )}
        {!automated && <KindSelect kinds={kinds} value={sp.kind} />}
      </AutoFilterForm>
      <Runs projectIds={ids} state={closed ? "closed" : automated ? "automated" : "active"} kind={sp.kind} kinds={kinds} canStart={can(u.who, "run:create")} />
    </div>
  );
}

/** Leads and admins on at least one of the umbrella's test cycles see Upload automation results. */
async function mayUpload(u: NonNullable<Awaited<ReturnType<typeof loadUmbrella>>>, user: { id: string; isAdmin: boolean }) {
  if (user.isAdmin) return true;
  const roles = await db.projectMember.findMany({ where: { userId: user.id, projectId: { in: u.projects.filter((p) => !p.archivedAt).map((p) => p.id) } }, select: { role: true } });
  return roles.some((r) => can({ role: r.role, rules: u.who.rules }, "run:import"));
}

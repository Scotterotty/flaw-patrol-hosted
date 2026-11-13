import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { ViewTabs } from "@/components/view-tabs";
import { SisterCasesView, type DryCase, type LibCase, type LinkRow } from "@/components/sister-cases";
import { db } from "@/lib/db";
import { clientsForCase } from "@/lib/clients";
import { pathOf } from "@/lib/folders";
import { caseKey } from "@/lib/format";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";
import { parseCaseSteps } from "@/lib/steps";
import { headingRows } from "@/lib/step-checks";
import { sisterSteps, suggestSisters, type Suggestion } from "@/lib/sisters";
import { libraryProjectIds } from "@/lib/umbrella";
import { dryRunCycles } from "@/lib/sisters-server";

export const metadata = { title: "Sister cases" };

const plain = (json: unknown) => parseCaseSteps(json).flatMap((s) => (s.kind === "step" ? [{ action: s.action, expected: s.expected }] : []));
const withHeadings = (steps: { action: string; expected: string }[]) => {
  const h = headingRows(steps);
  return steps.map((s, i) => ({ ...s, heading: h.has(i) }));
};

export default async function SisterCasesPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ from?: string }> }) {
  const { key } = await params;
  const sp = await searchParams;
  const { project, user, who } = await projectAccess(key);
  const cycles = await dryRunCycles(user.id);
  const dry = cycles.find((c) => c.key === sp.from?.toUpperCase()) ?? cycles.find((c) => c.id !== project.id) ?? cycles[0];
  const tabs = (
    <ViewTabs
      label="Case state"
      tabs={[
        { label: "Active", href: `/p/${project.key}/cases`, current: false },
        { label: "Archived", href: `/p/${project.key}/cases?archived=1`, current: false },
        { label: "Sister cases", href: `/p/${project.key}/cases/sisters`, current: true },
      ]}
    />
  );
  const header = <PageHeader title="Sister cases" subtitle="When a dry run case gets a result, the steps you tick fill in on its sister cases in open runs." />;
  if (!dry)
    return (
      <div className="mx-auto max-w-5xl">
        {header}
        {tabs}
        <EmptyState title="No dry run yet">Sister cases link a dry run&apos;s cases to the cases they share a test with. Turn on Clients for your dry run&apos;s test cycle in Settings first.</EmptyState>
      </div>
    );

  const library = (await libraryProjectIds(project)).filter((id) => id !== dry.id);
  const [dryCases, libCases, folders, links] = await Promise.all([
    db.testCase.findMany({
      where: { projectId: dry.id, archived: false, type: "MANUAL" },
      orderBy: { number: "asc" },
      select: { id: true, number: true, title: true, clients: true, folderId: true, versions: { orderBy: { version: "desc" }, take: 1, select: { steps: true } } },
    }),
    db.testCase.findMany({
      where: { projectId: { in: library }, archived: false, type: { not: "EXPLORATORY" } },
      orderBy: [{ projectId: "asc" }, { number: "asc" }],
      select: { id: true, number: true, title: true, project: { select: { key: true } }, folderId: true, versions: { orderBy: { version: "desc" }, take: 1, select: { steps: true } } },
    }),
    db.folder.findMany({ where: { projectId: { in: [dry.id, ...library] } }, select: { id: true, parentId: true, name: true } }),
    db.sisterLink.findMany({ where: { fromCase: { projectId: dry.id }, toCase: { projectId: { in: library } } }, orderBy: { createdAt: "asc" } }),
  ]);

  const lib: LibCase[] = libCases.map((c) => ({
    id: c.id,
    key: caseKey(c.project.key, c.number),
    href: `/p/${c.project.key}/cases/${c.number}`,
    title: c.title,
    folder: c.folderId ? pathOf(folders, c.folderId).join(" / ") : "",
    steps: sisterSteps(withHeadings(plain(c.versions[0]?.steps))),
  }));
  const dryList: (DryCase & { suggestions: Suggestion[] })[] = dryCases.map((c) => {
    const steps = plain(c.versions[0]?.steps);
    const folder = c.folderId ? pathOf(folders, c.folderId).join(" / ") : "";
    const text = steps.map((s) => [s.action, s.expected].filter(Boolean).join("\n")).join("\n");
    const clients = clientsForCase(c.clients, dry.clients, [c.title, folder, text].join("\n"));
    const linked = links.filter((l) => l.fromCaseId === c.id);
    const suggestions = suggestSisters({ title: `${c.title} ${folder.split(" / ").pop() ?? ""}`, text }, clients, dry.clients, lib).filter(
      (s) => !linked.some((l) => l.toCaseId === s.caseId || (s.client && l.fromClient === s.client)),
    );
    return { id: c.id, key: caseKey(dry.key, c.number), title: c.title, folder, text, clients, suggestions };
  });
  const rows: LinkRow[] = links.map((l) => ({ id: l.id, fromCaseId: l.fromCaseId, fromClient: l.fromClient, toCaseId: l.toCaseId, steps: l.steps }));

  return (
    <div className="mx-auto max-w-5xl">
      {header}
      {tabs}
      {cycles.length > 1 && (
        <nav aria-label="Dry run" className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">Dry run:</span>
          {cycles.map((c) => (
            <Link key={c.id} href={`/p/${project.key}/cases/sisters?from=${c.key}`} aria-current={c.id === dry.id ? "page" : undefined} className={c.id === dry.id ? "rounded-full bg-accent-100 px-3 py-1 font-medium text-accent-800" : "rounded-full border border-slate-200 px-3 py-1 text-slate-700 hover:border-slate-300"}>
              {c.name}
            </Link>
          ))}
        </nav>
      )}
      <SisterCasesView projectId={project.id} dryName={dry.name} dry={dryList} lib={lib} links={rows} canEdit={can(who, "case:edit")} />
    </div>
  );
}

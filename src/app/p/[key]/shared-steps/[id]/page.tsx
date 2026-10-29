import { StepsTable, actionCell, expectedCell } from "@/components/steps-table";
import { CrumbName } from "@/components/crumb-name";
import Link from "next/link";
import { ArchiveSharedButton } from "@/components/shared-step-editor";
import { Badge, Card, LinkButton } from "@/components/ui";
import { caseKey, relativeTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { projectAccess, mySpelling } from "@/lib/session";
import { parseParams, parsePlainSteps } from "@/lib/steps";
import { loadSharedStep } from "./load";

export const metadata = { title: "Shared step" };

export default async function SharedStepPage({ params, searchParams }: { params: Promise<{ key: string; id: string }>; searchParams: Promise<{ v?: string }> }) {
  const spelling = await mySpelling();
  const { key, id } = await params;
  const { v: vParam } = await searchParams;
  const { project, who } = await projectAccess(key);
  const s = await loadSharedStep(project.id, id);
  const shown = s.versions.find((x) => x.version === Number(vParam)) ?? s.versions[0];
  const steps = parsePlainSteps(shown?.steps);
  const ps = parseParams(shown?.parameters);
  const isCurrent = shown?.version === s.currentVersion;

  return (
    <div className="mx-auto max-w-6xl">
      <CrumbName href={`/p/${project.key}/shared-steps/${s.id}`} label={s.name} />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{shown?.name ?? s.name}</h1>
            {s.archived && <Badge tone="orange">Archived</Badge>}
            {!isCurrent && <Badge tone="blue">Viewing version {shown?.version}</Badge>}
          </div>
          {shown?.description && <p className="mt-1 text-sm text-slate-600">{shown.description}</p>}
        </div>
        {can(who, "shared:manage") && (
          <div className="flex gap-2">
            {can(who, "library:archive") && <ArchiveSharedButton projectId={project.id} sharedStepId={s.id} archived={s.archived} usageCount={s.usages.length} />}
            <LinkButton variant="primary" href={`/p/${project.key}/shared-steps/${s.id}/edit`}>
              Edit
            </LinkButton>
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_17rem]">
        <div className="space-y-5">
          {ps.length > 0 && (
            <Card className="p-4">
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Parameters</h2>
              <ul className="flex flex-wrap gap-3 text-sm">
                {ps.map((p) => (
                  <li key={p.name}>
                    <code className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">{p.name}</code>
                    {p.defaultValue && <span className="ml-1 text-slate-500">default “{p.defaultValue}”</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card className="overflow-hidden">
            <StepsTable>
              <tbody className="divide-y divide-slate-100">
                {steps.map((st, i) => (
                  <tr key={i} className="align-top">
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{i + 1}</td>
                    <td className={`px-4 ${actionCell}`}>{highlight(st.action)}</td>
                    <td className={`px-4 ${expectedCell}`}>{highlight(st.expected)}</td>
                  </tr>
                ))}
              </tbody>
            </StepsTable>
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Used in {s.usages.length} {s.usages.length === 1 ? "case" : "cases"}
            </h2>
            {s.usages.length === 0 ? (
              <p className="text-sm text-slate-500">No case uses this yet. Insert it from the case editor.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {s.usages.map((u) => (
                  <li key={u.caseId}>
                    <Link href={`/p/${project.key}/cases/${u.testCase.number}`} className="hover:underline">
                      <span className="font-mono text-xs text-slate-500">{caseKey(project.key, u.testCase.number)}</span> {u.testCase.title}
                    </Link>
                    {u.testCase.archived && <span className="ml-1 text-xs text-slate-400">(archived)</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <aside>
          <Card className="p-4">
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Version history</h2>
            <ol className="space-y-2.5 text-sm">
              {s.versions.map((v) => (
                <li key={v.id}>
                  <Link href={`?v=${v.version}`} className={`font-medium hover:underline ${v.version === shown?.version ? "text-accent-700" : "text-slate-800"}`}>
                    Version {v.version}
                  </Link>
                  {v.version === s.currentVersion && <span className="ml-1.5 text-xs text-emerald-700">current</span>}
                  <p className="text-xs text-slate-500">
                    {v.authorName || "Unknown"} · {relativeTime(v.createdAt, spelling)}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function highlight(text: string) {
  return text.split(/(\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\})/g).map((part, i) =>
    part.startsWith("{{") ? (
      <code key={i} className="rounded bg-violet-50 px-1 text-violet-700">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

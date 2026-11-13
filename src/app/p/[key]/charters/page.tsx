import { Fragment } from "react";
import { NOT_BASH_CASE } from "@/lib/bash-cases";
import { CloseMatchesLabel } from "@/components/close-matches";
import Link from "next/link";
import { NewCharterMenu } from "@/components/charters";
import { PersonasBoard } from "@/components/personas";
import { StartExploringButton } from "@/components/start-exploring";
import { ViewTabs } from "@/components/view-tabs";
import { Card, cx, EmptyState, Input, PageHeader } from "@/components/ui";
import { charterHome, charterRows, teamTemplates } from "@/lib/charter-data";
import { db } from "@/lib/db";
import { relativeTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { mySpelling, projectAccess } from "@/lib/session";
import { caseKey, count } from "@/lib/format";

export const metadata = { title: "Charters" };

type Search = { q?: string; archived?: string; tab?: string; persona?: string };

/**
 * Charters: exploratory missions get their own page, with New charter ▾ for
 * a blank one or a tour or checklist. Since ver_96 the test personas you explore as
 * live here too, on the Personas tab, and each charter has Start exploring.
 */
export default async function ChartersPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Search> }) {
  const { key } = await params;
  const sp = await searchParams;
  const { q, archived } = sp;
  const tab = sp.tab === "personas" ? "personas" : "charters";
  const { project, who } = await projectAccess(key);
  const spelling = await mySpelling();
  const home = await charterHome(project);
  const [rows, team, archivedCount, personas] = await Promise.all([
    charterRows(project.id, { q, archived: archived === "1", persona: sp.persona }),
    teamTemplates(home.id),
    db.testCase.count({ where: { projectId: project.id, type: "EXPLORATORY", archived: true, ...NOT_BASH_CASE } }),
    db.persona.findMany({ where: { projectId: project.id }, orderBy: { name: "asc" }, include: { cases: { where: { archived: false }, select: { type: true } } } }),
  ]);
  // Bug bash area charters stay off this list, so point to where a bash's results live (once one is wrapped up).
  const wrappedBash = await db.bugBash.findFirst({ where: { projectId: home.id, wrappedAt: { not: null } }, select: { id: true } });
  const charterCount = await db.testCase.count({ where: { projectId: project.id, type: "EXPLORATORY", archived: false, ...NOT_BASH_CASE } });
  const canWrite = can(who, "case:edit");
  const canStart = can(who, "run:create");
  const activePersonas = personas.filter((p) => !p.archived);
  const link = (patch: Partial<Search>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, archived, persona: sp.persona, ...patch })) if (v) u.set(k, v);
    const s = u.toString();
    return `/p/${project.key}/charters${s ? `?${s}` : ""}`;
  };
  return (
    <div className="page page-list">
      <PageHeader
        title={archived === "1" ? "Archived charters" : "Charters"}
        subtitle="Missions to explore, and the people you can pretend to be while you do."
        actions={canWrite && archived !== "1" && tab === "charters" ? <NewCharterMenu projectKey={project.key} teamCount={team.length} /> : undefined}
      />
      {archived !== "1" && (
        <ViewTabs
          label="Charters and personas"
          tabs={[
            { label: "Charters", href: `/p/${project.key}/charters`, count: charterCount, current: tab === "charters" },
            { label: "Personas", href: `/p/${project.key}/charters?tab=personas`, count: activePersonas.length, current: tab === "personas" },
          ]}
        />
      )}
      {tab === "personas" ? (
        <PersonasBoard
          projectId={project.id}
          projectKey={project.key}
          canManage={can(who, "shared:manage")}
          canArchive={can(who, "library:archive")}
          canWrite={canWrite}
          embedded
          personas={personas.map((p) => ({
            id: p.id,
            name: p.name,
            emoji: p.emoji,
            description: p.description,
            archived: p.archived,
            charters: p.cases.filter((c) => c.type === "EXPLORATORY").length,
            cases: p.cases.filter((c) => c.type !== "EXPLORATORY").length,
          }))}
        />
      ) : (
        <>
          <form className="mb-3 flex flex-wrap items-center gap-2">
            {archived === "1" && <input type="hidden" name="archived" value="1" />}
            {sp.persona && <input type="hidden" name="persona" value={sp.persona} />}
            <Input name="q" defaultValue={q ?? ""} placeholder="Search charters" aria-label="Search charters" className="h-9 w-64" />
            <span className="ml-auto text-sm">
              {archived === "1" ? (
                <Link href={`/p/${project.key}/charters`} className="text-accent-700 hover:underline">
                  Back to charters
                </Link>
              ) : (
                archivedCount > 0 && (
                  <Link href={`/p/${project.key}/charters?archived=1`} className="text-slate-600 hover:underline">
                    Archived ({archivedCount})
                  </Link>
                )
              )}
            </span>
          </form>
          {activePersonas.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Test persona">
              {[{ id: "", label: "Any persona" }, ...activePersonas.map((p) => ({ id: p.id, label: `${p.emoji} ${p.name}` })), { id: "none", label: "No persona" }].map((o) => {
                const on = (sp.persona ?? "") === o.id;
                return (
                  <Link key={o.id || "any"} href={link({ persona: o.id || undefined })} aria-current={on ? "page" : undefined} className={cx("rounded-full border px-3 py-1 text-sm", on ? "border-violet-500 bg-violet-50 font-medium text-violet-800" : "border-slate-200 text-slate-700 hover:border-violet-400")}>
                    {o.label}
                  </Link>
                );
              })}
            </div>
          )}
          {rows.length === 0 ? (
            <EmptyState
              title={q || sp.persona ? "No charter matches." : archived === "1" ? "Nothing archived." : "No charters yet"}
              action={!q && !sp.persona && archived !== "1" && canWrite ? <NewCharterMenu projectKey={project.key} teamCount={team.length} /> : undefined}
            >
              {!q && !sp.persona && archived !== "1" && "A charter says what to explore and for how long, instead of listing steps. Start from a tour or checklist if you're not sure what to write."}
            </EmptyState>
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Charter</th>
                    <th className="px-4 py-2 font-medium">Test persona</th>
                    <th className="px-4 py-2 font-medium">Time limit</th>
                    <th className="px-4 py-2 font-medium">Last explored</th>
                    {canStart && archived !== "1" && <th className="px-4 py-2" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, i) => (
                    <Fragment key={r.id}>
                      {r.close && !rows[i - 1]?.close && (
                        <tr>
                          <td colSpan={5} className="px-0 py-1">
                            {i === 0 && <p className="px-4 pb-1 text-xs text-slate-500">No exact matches.</p>}
                            <CloseMatchesLabel className="px-4" />
                          </td>
                        </tr>
                      )}
                      <tr>
                        <td className="px-4 py-2">
                          <Link href={`/p/${r.key}/cases/${r.number}`} className="hover:underline">
                            <span className="font-mono text-xs text-slate-500">{caseKey(r.key, r.number)}</span> <span className="font-medium text-slate-900">{r.title}</span>
                          </Link>
                          {r.prompts > 0 && <span className="ml-2 text-[11px] text-slate-500">{count(r.prompts, "prompt")}</span>}
                        </td>
                        <td className="px-4 py-2 text-slate-700">{r.persona ? `${r.persona.emoji} ${r.persona.name}` : <span className="text-slate-400">Nobody in particular</span>}</td>
                        <td className="px-4 py-2 text-slate-700">{r.minutes} min</td>
                        <td className="px-4 py-2 text-xs text-slate-600">
                          {r.last ? (
                            <>
                              {relativeTime(r.last.at, spelling)} · {r.last.bugs ? `${r.last.bugs} ${r.last.bugs === 1 ? "bug" : "bugs"}` : "No issues"}
                            </>
                          ) : (
                            <span className="text-slate-400">Not explored yet</span>
                          )}
                        </td>
                        {canStart && archived !== "1" && (
                          <td className="px-4 py-2 text-right">
                            <StartExploringButton caseId={r.id} label="Start" size="sm" variant="secondary" />
                          </td>
                        )}
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {wrappedBash && archived !== "1" && (
            <p className="mt-3 text-sm text-slate-600" data-testid="bash-results-pointer">
              <span aria-hidden="true">🐞 </span>Bug bash results are on{" "}
              <Link href={`/p/${home.key}/bashes`} className="font-medium text-accent-700 hover:underline">
                Bug bashes
              </Link>
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}

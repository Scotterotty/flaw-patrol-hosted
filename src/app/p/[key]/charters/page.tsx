import { Fragment } from "react";
import { CloseMatchesLabel } from "@/components/close-matches";
import Link from "next/link";
import { NewCharterMenu } from "@/components/charters";
import { Card, EmptyState, Input, PageHeader } from "@/components/ui";
import { charterHome, charterRows, teamTemplates } from "@/lib/charter-data";
import { db } from "@/lib/db";
import { relativeTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { mySpelling, projectAccess } from "@/lib/session";
import { caseKey } from "@/lib/format";

export const metadata = { title: "Charters" };

/**
 * Charters (ver_93): exploratory missions get their own page, with New charter ▾ for
 * a blank one or a tour or checklist. The Case library lists only test cases.
 */
export default async function ChartersPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ q?: string; archived?: string }> }) {
  const { key } = await params;
  const { q, archived } = await searchParams;
  const { project, who } = await projectAccess(key);
  const spelling = await mySpelling();
  const home = await charterHome(project);
  const [rows, team, archivedCount] = await Promise.all([
    charterRows(project.id, { q, archived: archived === "1" }),
    teamTemplates(home.id),
    db.testCase.count({ where: { projectId: project.id, type: "EXPLORATORY", archived: true } }),
  ]);
  const canWrite = can(who, "case:edit");
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={archived === "1" ? "Archived charters" : "Charters"}
        subtitle="Missions to explore, with a time limit instead of steps. Run them like any case: a timer and a log of what you tried and found."
        actions={canWrite && archived !== "1" ? <NewCharterMenu projectKey={project.key} teamCount={team.length} /> : undefined}
      />
      <form className="mb-3 flex flex-wrap items-center gap-2">
        {archived === "1" && <input type="hidden" name="archived" value="1" />}
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
      {rows.length === 0 ? (
        <EmptyState
          title={q ? "No charter matches." : archived === "1" ? "Nothing archived." : "No charters yet"}
          action={!q && archived !== "1" && canWrite ? <NewCharterMenu projectKey={project.key} teamCount={team.length} /> : undefined}
        >
          {!q && archived !== "1" && "A charter says what to explore and for how long, instead of listing steps. Start from a tour or checklist if you're not sure what to write."}
        </EmptyState>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Charter</th>
                <th className="px-4 py-2 font-medium">Persona</th>
                <th className="px-4 py-2 font-medium">Time limit</th>
                <th className="px-4 py-2 font-medium">Last session</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <Fragment key={r.id}>
                {r.close && !rows[i - 1]?.close && (
                  <tr>
                    <td colSpan={4} className="px-0 py-1">
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
                    {r.prompts > 0 && <span className="ml-2 text-[11px] text-slate-500">{r.prompts} prompts</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-700">{r.persona ? `${r.persona.emoji} ${r.persona.name}` : <span className="text-slate-400">None</span>}</td>
                  <td className="px-4 py-2 text-slate-700">{r.minutes} min</td>
                  <td className="px-4 py-2 text-xs text-slate-600">
                    {r.last ? (
                      <>
                        {relativeTime(r.last.at, spelling)} · {r.last.bugs ? `${r.last.bugs} ${r.last.bugs === 1 ? "bug" : "bugs"}` : "No issues"}
                      </>
                    ) : (
                      <span className="text-slate-400">Not run</span>
                    )}
                  </td>
                </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

import Link from "next/link";
import { pickRelease } from "@/lib/rc-status";
import { coverageCsv, coverageHtml, storyCoverage, storyReleases, type CoverageColumn } from "@/lib/story-coverage";
import { CopyCoverage, CoverageExport } from "./story-copy";
import { Cell, TypeBadge } from "./story-coverage";
import { cx, EmptyState } from "./ui";

/**
 * Reports › Requirements: coverage of a Jira release's requirements, one column per test cycle.
 * Opens on the release the newest test cycles test (`rcNames`), or All when Jira has none by that name (ver_87).
 */
export async function StoryReport({
  projectId,
  libraryIds,
  columns,
  want,
  rcNames,
  base,
  scopeNote,
  exportTo,
}: {
  projectId: string;
  libraryIds: string[];
  columns: CoverageColumn[];
  want?: string;
  rcNames: string[];
  base: string;
  scopeNote: string;
  /** One Export menu, as on Run reports (ver_91). */
  exportTo?: { url: string; cycle: boolean; preparedBy: string };
}) {
  const all = await storyReleases(projectId);
  const release = pickRelease(all, want, rcNames);
  // The release shown goes first, then the rest as Jira lists them, then All.
  const releases = release ? [release, ...all.filter((r) => r !== release)] : all;
  const cov = await storyCoverage({ projectId, libraryIds, columns, release });
  if (!cov.connected) return <EmptyState title="Jira isn't connected">Requirements come from Jira. Connect it in Settings to see requirement coverage here.</EmptyState>;
  const title = `${release ?? "All linked requirements"} · requirement coverage`;
  const c = cov.counts;
  const withCases = c.all - c.none;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Jira release">
        {(all.length ? [...releases.slice(0, 8), null] : []).map((r) => (
          <Link
            key={r ?? "all"}
            href={`${base}?release=${encodeURIComponent(r ?? "all")}`}
            aria-current={r === release ? "true" : undefined}
            className={cx("rounded-md border px-2.5 py-1 text-sm", r === release ? "border-accent-600 bg-accent-50 font-medium text-accent-800" : "border-slate-200 hover:bg-slate-50")}
          >
            {r ?? "All"}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-slate-500">{release ? `Requirements in Jira release ${release} · ${scopeNote}` : `Every requirement a case links · ${scopeNote}`}</p>
        </div>
        {exportTo ? (
          <CoverageExport
            html={coverageHtml(title, columns, cov.rows)}
            csv={coverageCsv(columns, cov.rows)}
            fileName={`${(release ?? "requirements").replace(/[^\w.-]+/g, "_")}-requirement-coverage.csv`}
            exportTo={{ ...exportTo, url: `${exportTo.url}${release ? `?release=${encodeURIComponent(release)}` : ""}`, scopeLine: title }}
          />
        ) : (
          <CopyCoverage html={coverageHtml(title, columns, cov.rows)} csv={coverageCsv(columns, cov.rows)} fileName={`${(release ?? "requirements").replace(/[^\w.-]+/g, "_")}-requirement-coverage.csv`} />
        )}
      </div>
      {cov.jiraError && <p className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">Couldn&apos;t read the release from Jira: {cov.jiraError}</p>}
      <p className="text-sm">
        <strong>
          {withCases} of {c.all}
        </strong>{" "}
        requirements have cases · {c.passing} passing · {c.failing} failing · {c.notrun} not run yet · {c.none} no cases
      </p>
      {cov.rows.length ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Requirement</th>
                {columns.map((col) => (
                  <th key={col.id} className="px-3 py-2 font-medium">
                    {col.name}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">Open bugs</th>
              </tr>
            </thead>
            <tbody>
              {cov.rows.map((r) => (
                <tr key={r.story.key} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    {r.story.url ? (
                      <a href={r.story.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent-700 hover:underline">
                        {r.story.key}
                      </a>
                    ) : (
                      <span className="font-mono text-xs">{r.story.key}</span>
                    )}{" "}
                    {r.story.type && <TypeBadge type={r.story.type} />} {r.story.title}
                    {r.children && <span className="ml-1 text-xs text-slate-500">Includes {r.children.length} child {r.children.length === 1 ? "issue" : "issues"}</span>}
                  </td>
                  {r.cells.map((cell, i) => (
                    <td key={columns[i].id} className="px-3 py-2 whitespace-nowrap">
                      <Cell c={cell} />
                    </td>
                  ))}
                  <td className="px-3 py-2 text-xs">{r.bugs.length ? r.bugs.map((b) => b.key).join(", ") : <span className="text-slate-500">None</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No requirements">{release ? `Jira has no requirements in ${release}, and no case links one.` : "No case links a Jira requirement yet."}</EmptyState>
      )}
    </div>
  );
}

import { Fragment } from "react";
import { forgivingFilter } from "@/lib/fuzzy";
import { CloseMatchesLabel } from "@/components/close-matches";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Severity } from "@prisma/client";
import { AutoFilterForm } from "@/components/auto-filter-form";
import { Card, cx, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { caseKey } from "@/lib/format";
import { LocalDefectStatus, RefreshJiraButton, SendToJiraButton } from "@/components/defect-controls";
import { refreshDefectStatuses } from "@/lib/jira";
import { can } from "@/lib/permissions";
import { sendToJiraData } from "@/lib/send-to-jira";
import { mySpelling, requireUser } from "@/lib/session";
import { isSevere } from "@/lib/severity";
import { severityScaleFor } from "@/lib/severity-server";
import { jiraConfigFor, loadUmbrella, OPEN_BUG, platformColor } from "@/lib/umbrella";
import { BugAnswers } from "@/components/bug-answers";
import { BugDescription } from "@/components/bug-description";
import { parseAnswers } from "@/lib/bug-layout";
import { LastCheckLine, type LastCheck } from "@/components/known-bugs-panel";

export const metadata = { title: "Bugs" };

const SEV_BG: Record<Severity, string> = { SHOWSTOPPER: "#b91c1c", CRITICAL: "#ea580c", PROBLEMATIC: "#ca8a04", MINOR: "#475569", ENHANCEMENT: "#94a3b8" };

/** Every bug filed from any project under the umbrella, once each: a Jira issue filed from two platforms shows once with both. */
export default async function UmbrellaBugsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; all?: string; rc?: string; platform?: string; sev?: string; jira?: string; version?: string }> }) {
  const spelling = await mySpelling();
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const u = await loadUmbrella(id, user);
  if (!u) notFound();
  const projects = [u.hub, ...u.projects];
  const byId = new Map(projects.map((p) => [p.id, p]));
  const showAll = sp.all === "1";
  // Same actions as a test cycle's Bugs page: Refresh from Jira, status menu, Send to Jira.
  const [jira, scale] = await Promise.all([jiraConfigFor(u.hub.id), severityScaleFor(u.hub.id)]);
  if (jira) await Promise.all(projects.map((p) => refreshDefectStatuses(p.id).catch(() => null)));
  const canRun = can(u.who, "run:execute");
  const canEdit = can(u.who, "defect:edit");
  const defects = await db.defect.findMany({
    where: { projectId: { in: projects.map((p) => p.id) }, ...(showAll ? {} : OPEN_BUG), ...(sp.jira === "local" ? { externalKey: null } : {}) },
    orderBy: { createdAt: "asc" },
    take: 2000,
    include: { links: { select: { result: { select: { caseId: true, run: { select: { release: true } } } } } }, checks: { orderBy: { createdAt: "desc" }, take: 1, select: { outcome: true, byName: true, createdAt: true, run: { select: { number: true } } } } },
  });
  const cases = await db.testCase.findMany({
    where: { id: { in: [...new Set(defects.flatMap((d) => d.links.map((l) => l.result.caseId)))] } },
    select: { id: true, number: true, project: { select: { key: true } } },
  });
  const caseById = new Map(cases.map((c) => [c.id, caseKey(c.project.key, c.number)]));

  // RCs in the order they were made, so "open since" can compare them.
  const rcOrder = [...new Set(u.projects.slice().reverse().map((p) => p.rcName).filter(Boolean))];
  const latestRc = rcOrder.at(-1) ?? null;
  const rcOf = (d: (typeof defects)[number]) => byId.get(d.projectId)?.rcName || d.links.map((l) => l.result.run.release).find(Boolean) || "";
  // Found-in version: the Jira version each bug was filed against.
  const versions = [...new Set(defects.slice().reverse().map((d) => d.foundIn).filter(Boolean))].slice(0, 30);

  // One row per Jira issue (or per bug when it isn't in Jira), oldest filing first.
  type Row = { key: string; first: (typeof defects)[number]; platforms: string[]; rcs: string[]; cases: string[]; check: LastCheck | null };
  const rows = new Map<string, Row>();
  for (const d of defects) {
    const k = d.externalKey ?? d.id;
    const row = rows.get(k) ?? { key: k, first: d, platforms: [], rcs: [], cases: [], check: null };
    const p = byId.get(d.projectId);
    if (p?.platform && !row.platforms.includes(p.platform)) row.platforms.push(p.platform);
    const rc = rcOf(d);
    if (rc && !row.rcs.includes(rc)) row.rcs.push(rc);
    for (const l of d.links) {
      const ck = caseById.get(l.result.caseId);
      if (ck && !row.cases.includes(ck)) row.cases.push(ck);
    }
    const c = d.checks[0];
    if (c && (!row.check || c.createdAt > row.check.createdAt)) row.check = c;
    rows.set(k, row);
  }
  // Forgiving search: exact matches, then close ones under their own label.
  const bySeverity = (a: Row, b: Row) => severityRank(a.first.severity) - severityRank(b.first.severity) || b.first.createdAt.getTime() - a.first.createdAt.getTime();
  const found = forgivingFilter(
    [...rows.values()]
      .filter((r) => !sp.platform || r.platforms.some((p) => p.toLowerCase() === sp.platform!.toLowerCase()))
      .filter((r) => !sp.rc || r.rcs.includes(sp.rc))
      .filter((r) => !sp.version || r.first.foundIn === sp.version)
      .filter((r) => sp.sev !== "critical" || isSevere(r.first.severity, scale)),
    sp.q ?? "",
    (r) => `${r.first.title} ${r.first.externalKey ?? ""} ${r.cases.join(" ")}`,
  );
  const list = [...found.exact.sort(bySeverity), ...found.close.sort(bySeverity)];
  const closeStart = found.close.length ? found.exact.length : -1;
  const openRows = [...rows.values()].filter((r) => r.first.status === "OPEN");
  const critical = openRows.filter((r) => isSevere(r.first.severity, scale)).length;
  const projectCount = new Set(defects.map((d) => d.projectId)).size;
  const local = jira && canRun ? defects.filter((d) => !d.externalKey && d.status === "OPEN") : [];
  const sendable = await sendToJiraData(local.map((d) => ({ id: d.id, projectId: d.projectId, number: d.number, title: d.title, severity: d.severity, label: `${byId.get(d.projectId)?.key}-D${d.number}` })));

  const link = (patch: Record<string, string | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, all: sp.all, rc: sp.rc, platform: sp.platform, sev: sp.sev, jira: sp.jira, version: sp.version, ...patch })) if (v) s.set(k, v);
    return `?${s}`;
  };
  const chip = (label: string, on: boolean, href: string, dot?: string) => (
    <Link
      key={label}
      href={href}
      aria-current={on ? "page" : undefined}
      className={cx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm", on ? "border-accent-500 bg-accent-50 font-medium text-accent-700" : "border-slate-200 text-slate-700 hover:border-accent-500")}
    >
      {dot && <span aria-hidden className="size-1.5 rounded-full" style={{ background: dot }} />}
      {label}
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Bugs"
        subtitle={`${openRows.length} open across ${projectCount} ${projectCount === 1 ? "test cycle" : "test cycles"}${critical ? ` · ${critical} critical` : ""}. A bug filed from more than one platform shows once.`}
        actions={jira && canRun ? <RefreshJiraButton projectId={u.hub.id} projectIds={projects.map((p) => p.id)} /> : null}
      />
      {sendable.size > 0 && sp.jira !== "local" && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="not-in-jira">
          {sendable.size === 1 ? "1 bug isn't" : `${sendable.size} bugs aren't`} in Jira yet.{" "}
          <Link href={link({ jira: "local", all: undefined })} className="font-medium underline">
            Send {sendable.size === 1 ? "it" : "them"} to Jira
          </Link>
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AutoFilterForm className="min-w-60 flex-1">
          {Object.entries({ all: sp.all, rc: sp.rc, platform: sp.platform, sev: sp.sev, jira: sp.jira, version: sp.version }).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
          <Input name="q" type="search" defaultValue={sp.q} placeholder="Search bugs, Jira keys or case IDs" aria-label="Search bugs" className="w-full" />
        </AutoFilterForm>
        {chip(showAll ? "Open and closed" : "Open", !showAll, link({ all: showAll ? undefined : "1" }))}
        {sp.jira === "local" && chip("Not in Jira", true, link({ jira: undefined }))}
        {sp.sev === "critical" ? chip("Critical only", true, link({ sev: undefined })) : chip("Critical", false, link({ sev: "critical" }))}
        {latestRc && chip(latestRc, sp.rc === latestRc, link({ rc: sp.rc === latestRc ? undefined : latestRc }))}
        {(versions.length > 0 || sp.version) && (
          <AutoFilterForm>
            {Object.entries({ q: sp.q, all: sp.all, rc: sp.rc, platform: sp.platform, sev: sp.sev, jira: sp.jira }).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
            <Select name="version" defaultValue={sp.version ?? ""} className="w-auto" aria-label="Found in version">
              <option value="">Any version</option>
              {[...new Set([...versions, ...(sp.version ? [sp.version] : [])])].map((v) => (
                <option key={v} value={v}>
                  Found in {v}
                </option>
              ))}
            </Select>
          </AutoFilterForm>
        )}
        {u.platforms.map((p) => chip(p.name, sp.platform?.toLowerCase() === p.name.toLowerCase(), link({ platform: sp.platform?.toLowerCase() === p.name.toLowerCase() ? undefined : p.name }), platformColor(u.platforms, p.name)))}
      </div>
      {list.length === 0 ? (
        <EmptyState title={defects.length ? "No bugs match" : "No bugs yet"}>{defects.length ? "Try fewer filters." : `Bugs filed from any ${u.group.name} run show up here.`}</EmptyState>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-2 font-semibold">Sev</th>
                <th className="px-4 py-2 font-semibold">Bug</th>
                <th className="px-4 py-2 font-semibold">Seen on</th>
                <th className="px-4 py-2 font-semibold">First found</th>
                <th className="px-4 py-2 font-semibold">Jira priority</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((r, i) => {
                const d = r.first;
                const firstRc = r.rcs[0] ?? "";
                const old = d.status === "OPEN" && latestRc && firstRc && firstRc !== latestRc && rcOrder.indexOf(firstRc) < rcOrder.indexOf(latestRc);
                const home = byId.get(d.projectId);
                return (
                  <Fragment key={r.key}>
                  {i === closeStart && (
                    <tr>
                      <td colSpan={6} className="px-0 py-1">
                        {closeStart === 0 && <p className="px-4 pb-1 text-xs text-slate-500">No exact matches.</p>}
                        <CloseMatchesLabel className="px-4" />
                      </td>
                    </tr>
                  )}
                  <tr className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <span title={scale.labels[d.severity]} className="grid size-6 place-items-center rounded text-xs font-bold text-white" style={{ background: SEV_BG[d.severity] }}>
                        {scale.labels[d.severity][0]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {d.externalUrl ? (
                        <a href={d.externalUrl} target="_blank" rel="noreferrer" className="font-medium text-slate-900 hover:underline">
                          {d.title}
                        </a>
                      ) : (
                        <Link href={home?.id === u.group.hubProjectId ? `/g/${id}/bugs` : `/p/${home?.key}/bugs`} className="font-medium text-slate-900 hover:underline">
                          {d.title}
                        </Link>
                      )}
                      <span className="block text-xs text-slate-500">{[d.externalKey ?? `${home?.key}-D${d.number}`, r.cases.length ? `from ${r.cases.join(", ")}` : "", d.foundIn && `found in ${d.foundIn}`].filter(Boolean).join(" · ")}</span>
                      {jira && canRun && !d.externalKey && <span className="block text-xs text-slate-500">Saved before Jira was connected</span>}
                      <LastCheckLine check={r.check} spelling={spelling} />
                      {d.answers == null && !d.externalKey && <BugDescription text={d.description} />}
                      {d.answers != null && <BugAnswers projectId={d.projectId} defectId={d.id} templateName={d.templateName} answers={parseAnswers(d.answers)} canAdd={canRun && d.status === "OPEN"} inJira={!!d.externalKey} />}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                        {r.platforms.map((p) => (
                          <span key={p} className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-slate-700">
                            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: platformColor(u.platforms, p) }} />
                            {p}
                          </span>
                        ))}
                        {r.platforms.length === 0 && <span className="text-xs text-slate-400">{home?.name}</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{old ? <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">Open since {firstRc}</span> : firstRc || "–"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{d.externalPriority ?? "–"}</td>
                    <td className="px-4 py-2.5 text-slate-800">
                      {d.externalKey || !canEdit ? (
                        (d.externalStatus ?? STATUS[d.status])
                      ) : (
                        <span className="flex flex-wrap items-center gap-2">
                          <LocalDefectStatus projectId={d.projectId} defect={d} />
                          {sendable.has(d.id) && <SendToJiraButton data={sendable.get(d.id)!} />}
                        </span>
                      )}
                    </td>
                  </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

const STATUS = { OPEN: "Open", FIXED: "Fixed", CLOSED: "Closed", WONT_FIX: "Won't fix" } as const;
const severityRank = (s: Severity) => ["SHOWSTOPPER", "CRITICAL", "PROBLEMATIC", "MINOR", "ENHANCEMENT"].indexOf(s);

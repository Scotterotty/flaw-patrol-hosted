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
import { isWritten, parseAnswers } from "@/lib/bug-layout";
import { SendWrittenBugButton, WriteBugButton } from "@/components/write-bug";
import { LastCheckLine, type LastCheck } from "@/components/known-bugs-panel";
import { BugViewSwitch, JiraOnlyList } from "@/components/bug-board";
import { BugBoardSection, bugsSetup, tableBoard } from "@/components/bug-board-section";
import { BugsFilterBar, ShowingLine } from "@/components/bugs-filter-bar";
import { SHARED_KEYS } from "@/lib/bugs-view";

export const metadata = { title: "Bugs" };

const SEV_BG: Record<Severity, string> = { SHOWSTOPPER: "#b91c1c", CRITICAL: "#ea580c", PROBLEMATIC: "#ca8a04", MINOR: "#475569", ENHANCEMENT: "#94a3b8" };

/** Every bug filed from any project under the umbrella, once each: a Jira issue filed from two platforms shows once with both. */
export default async function UmbrellaBugsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
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
  // Write a bug: kept on the umbrella itself, with no RC to pick; triage decides which RC gets the fix (Nov 13 2026).
  const canWrite = canRun && !u.group.archivedAt;
  // Board (ver_211): every bug on the Jira board, in its columns. Only with Jira connected.
  // ver_232: Table and Board share the Jira board and the filters, saved on the account too.
  const setup = await bugsSetup(sp, user.id, jira?.jiraProjectKey ?? null);
  const view = setup.view;
  const me = { name: user.name ?? "", email: user.email ?? "" };
  const scopeIds = projects.map((p) => p.id);
  const actions =
    (jira && canRun) || canWrite ? (
      <div className="flex flex-wrap gap-2">
        {jira && canRun && <RefreshJiraButton projectId={u.hub.id} projectIds={projects.map((p) => p.id)} />}
        {canWrite && <WriteBugButton projectId={u.hub.id} scale={scale} />}
      </div>
    ) : null;
  if (view === "board") {
    const local = await db.defect.findMany({ where: { projectId: { in: scopeIds }, externalKey: null, status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, number: true, title: true, createdBy: true, foundIn: true, projectId: true } });
    return (
      <div>
        <PageHeader title="Bugs" beside={<BugViewSwitch view="board" />} subtitle={`Bugs on your Jira board for ${jira!.jiraProjectKey}. Click one for its details.`} actions={actions} />
        <BugBoardSection
          where={{ groupId: id }}
          jiraProjectId={u.hub.id}
         
          scopeIds={scopeIds}
          board={setup.board}
          me={me}
          foundDefault={setup.picks.found ?? true}
          local={local.map((d) => ({ id: d.id, label: `${byId.get(d.projectId)?.key}-D${d.number}`, title: d.title, href: "?view=table&jira=local", createdBy: d.createdBy, foundIn: d.foundIn }))}
        />
      </div>
    );
  }
  const defects = await db.defect.findMany({
    where: { projectId: { in: projects.map((p) => p.id) }, ...(showAll ? {} : OPEN_BUG), ...(sp.jira === "local" ? { externalKey: null } : {}) },
    orderBy: { createdAt: "asc" },
    take: 2000,
    include: { links: { select: { result: { select: { caseId: true, run: { select: { release: true } } } } } }, checks: { orderBy: { createdAt: "desc" }, take: 1, select: { outcome: true, byName: true, createdAt: true, run: { select: { number: true, name: true, build: true, createdAt: true } } } } },
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
  // ver_232: with Jira, the same bugs as Board (the picked board and the shared filters). Search stays forgiving.
  const tb = jira ? await tableBoard(u.hub.id, scopeIds, setup.board, setup.filters, me, { search: false }) : null;
  const asTableBug = (r: Row) => ({ ...r.first, label: r.first.externalKey ?? `${byId.get(r.first.projectId)?.key}-D${r.first.number}` });
  const offBoard = tb ? tb.offBoard([...rows.values()].map(asTableBug)) : 0;
  const found = forgivingFilter(
    [...rows.values()]
      .filter((r) => !tb || tb.keep(asTableBug(r)))
      .filter((r) => !sp.platform || r.platforms.some((p) => p.toLowerCase() === sp.platform!.toLowerCase()))
      .filter((r) => !sp.rc || r.rcs.includes(sp.rc))
      .filter((r) => !!tb || !sp.version || r.first.foundIn === sp.version)
      .filter((r) => sp.from !== "own" || isWritten(r.first.layout))
      .filter((r) => sp.sev !== "critical" || isSevere(r.first.severity, scale)),
    sp.q ?? "",
    (r) => `${r.first.title} ${r.first.externalKey ?? ""} ${r.cases.join(" ")}`,
  );
  const list = [...found.exact.sort(bySeverity), ...found.close.sort(bySeverity)];
  const jiraOnly = tb ? forgivingFilter(tb.jiraOnly(new Set((await db.defect.findMany({ where: { projectId: { in: scopeIds }, externalKey: { not: null } }, select: { externalKey: true } })).map((d) => d.externalKey!))), sp.q ?? "", (i) => `${i.key} ${i.title} ${i.labels.join(" ")} ${i.assignee}`).exact : [];
  const closeStart = found.close.length ? found.exact.length : -1;
  const openRows = [...rows.values()].filter((r) => r.first.status === "OPEN");
  const critical = openRows.filter((r) => isSevere(r.first.severity, scale)).length;
  const projectCount = new Set(defects.map((d) => d.projectId)).size;
  const local = jira && canRun ? defects.filter((d) => !d.externalKey && d.status === "OPEN") : [];
  const sendable = await sendToJiraData(local.map((d) => ({ id: d.id, projectId: d.projectId, number: d.number, title: d.title, severity: d.severity, label: `${byId.get(d.projectId)?.key}-D${d.number}` })));

  const link = (patch: Record<string, string | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...Object.fromEntries(["view", ...SHARED_KEYS].map((k) => [k, sp[k]])), all: sp.all, rc: sp.rc, platform: sp.platform, sev: sp.sev, jira: sp.jira, from: sp.from, ...patch })) if (v) s.set(k, v);
    return `?${s}`;
  };
  const chip = (label: string, on: boolean, href: string, dot?: string) => (
    <Link
      key={label}
      href={href}
      aria-current={on ? "page" : undefined}
      data-howto={label === "Open" || label === "Open and closed" ? "bugs-open" : undefined}
      className={cx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm", on ? "border-accent-500 bg-accent-50 font-medium text-accent-700" : "border-slate-200 text-slate-700 hover:border-accent-500")}
    >
      {dot && <span aria-hidden className="size-1.5 rounded-full" style={{ background: dot }} />}
      {label}
    </Link>
  );

  return (
    <div className="page page-list">
      <PageHeader
        title="Bugs"
        beside={jira ? <BugViewSwitch view="table" /> : undefined}
        subtitle={`${openRows.length} open across ${projectCount} ${projectCount === 1 ? "test cycle" : "test cycles"}${critical ? ` · ${critical} critical` : ""}. A bug filed from more than one platform shows once.`}
        actions={actions}
      />
      {sendable.size > 0 && sp.jira !== "local" && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="not-in-jira">
          {sendable.size === 1 ? "1 bug isn't" : `${sendable.size} bugs aren't`} in Jira yet.{" "}
          <Link href={link({ jira: "local", all: undefined })} className="font-medium underline" data-howto="bugs-send-jira">
            Send {sendable.size === 1 ? "it" : "them"} to Jira
          </Link>
        </p>
      )}
      {tb ? (
        <div className="mb-4 flex flex-col gap-2">
          <BugsFilterBar mode="table" boards={tb.data?.boards ?? []} board={tb.data?.board ?? null} filters={setup.filters} versions={[...new Set([...versions, ...tb.options.versions])]} labels={tb.options.labels} priorities={tb.options.priorities}>
            {chip(showAll ? "Open and closed" : "Open", !showAll, link({ all: showAll ? undefined : "1" }))}
            {sp.jira === "local" && chip("Not in Jira", true, link({ jira: undefined }))}
            {sp.sev === "critical" ? chip("Critical only", true, link({ sev: undefined })) : chip("Critical", false, link({ sev: "critical" }))}
            {chip("Not from a run", sp.from === "own", link({ from: sp.from === "own" ? undefined : "own" }))}
            {latestRc && chip(latestRc, sp.rc === latestRc, link({ rc: sp.rc === latestRc ? undefined : latestRc }))}
            {u.platforms.map((p) => chip(p.name, sp.platform?.toLowerCase() === p.name.toLowerCase(), link({ platform: sp.platform?.toLowerCase() === p.name.toLowerCase() ? undefined : p.name }), platformColor(u.platforms, p.name)))}
          </BugsFilterBar>
          <ShowingLine shown={list.length + jiraOnly.length} found={setup.filters.found} board={tb.data?.board?.name ?? null} more={tb.data ? new Set([...tb.data.issues.map((i) => i.key), ...rows.keys()]).size : undefined} />
          {offBoard > 0 && (
            <p className="text-xs text-slate-600" data-testid="bugs-off-board">
              {offBoard === 1 ? "1 open bug isn't" : `${offBoard} open bugs aren't`} on this Jira board. Pick another board to see {offBoard === 1 ? "it" : "them"}.
            </p>
          )}
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <AutoFilterForm className="min-w-60 flex-1">
            {Object.entries({ all: sp.all, rc: sp.rc, platform: sp.platform, sev: sp.sev, jira: sp.jira, version: sp.version, from: sp.from }).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
            <Input name="q" type="search" defaultValue={sp.q} placeholder="Search bugs, Jira keys or case IDs" aria-label="Search bugs" data-howto="bugs-search" className="w-full" />
          </AutoFilterForm>
          {chip(showAll ? "Open and closed" : "Open", !showAll, link({ all: showAll ? undefined : "1" }))}
          {sp.jira === "local" && chip("Not in Jira", true, link({ jira: undefined }))}
          {sp.sev === "critical" ? chip("Critical only", true, link({ sev: undefined })) : chip("Critical", false, link({ sev: "critical" }))}
          {chip("Not from a run", sp.from === "own", link({ from: sp.from === "own" ? undefined : "own" }))}
          {latestRc && chip(latestRc, sp.rc === latestRc, link({ rc: sp.rc === latestRc ? undefined : latestRc }))}
          {(versions.length > 0 || sp.version) && (
            <AutoFilterForm>
              {Object.entries({ q: sp.q, all: sp.all, rc: sp.rc, platform: sp.platform, sev: sp.sev, jira: sp.jira, from: sp.from }).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
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
      )}
      {list.length === 0 && jiraOnly.length ? null : list.length === 0 ? (
        <EmptyState title={defects.length ? "No bugs match" : "No bugs yet"}>{defects.length ? "Try fewer filters." : `Bugs filed from any ${u.group.name} run show up here, and so do bugs written with + Write a bug.`}</EmptyState>
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
                      {isWritten(d.layout) && (
                        <span className="float-right ml-2 rounded-full bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-700" data-testid="written-chip">
                          Not from a run
                        </span>
                      )}
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
                      {jira && canRun && !d.externalKey && <span className="block text-xs text-slate-500">{isWritten(d.layout) ? "Saved here, not in Jira yet" : "Saved before Jira was connected"}</span>}
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
                          {jira && canRun && !sendable.has(d.id) && d.status === "OPEN" && isWritten(d.layout) && <SendWrittenBugButton projectId={d.projectId} defectId={d.id} />}
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
      {tb && <JiraOnlyList where={{ groupId: id }} issues={jiraOnly} me={me} board={tb.data?.board?.name ?? null} />}
    </div>
  );
}

const STATUS = { OPEN: "Open", FIXED: "Fixed", CLOSED: "Closed", WONT_FIX: "Won't fix" } as const;
const severityRank = (s: Severity) => ["SHOWSTOPPER", "CRITICAL", "PROBLEMATIC", "MINOR", "ENHANCEMENT"].indexOf(s);

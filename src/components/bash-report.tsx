"use client";

import { useState } from "react";
import type { Severity } from "@prisma/client";
import { postBashReport } from "@/server/bashes";
import { FileBashBug, SevChip, UnfiledTag } from "./bash";
import { copyRich, saveImage, tableClip } from "./export-menu";
import { MoreMenu } from "./more-menu";
import type { BashLink } from "@/lib/bash";
import { FIND_LABEL, KindTag, LinkChips, type FindKind } from "./bash-live";
import { Card, cx, InfoTip } from "./ui";

export type ReportBug = {
  id: string;
  text: string;
  details: string;
  severity: Severity;
  areaId: string;
  byName: string;
  seen: number;
  key: string;
  url: string | null;
  /** Not in Jira (ver_94): the filing failed, or someone left it out at wrap-up. */
  unfiled: "not-filed" | "left" | null;
  why: string;
  attachments: { id: string; fileName: string; contentType: string }[];
};
export type ReportFind = {
  id: string;
  kind: FindKind;
  text: string;
  areaId: string;
  byName: string;
  severity: Severity;
  plusOnes: string[];
  adds: { by: string; text: string }[];
  at: string;
  key: string;
  url: string | null;
  left: boolean;
};
export type ReportData = {
  id: string;
  name: string;
  homeKey: string;
  when: string;
  createdBy: string;
  people: number;
  areas: { id: string; name: string; links: BashLink[] }[];
  /** Links for the whole bash (ver_96). */
  links: BashLink[];
  wrapped: boolean;
  bugs: ReportBug[];
  notFiled: number;
  entryOf: Record<string, string>;
  sevNames: Record<Severity, string>;
  /** Set when the viewer may use File this bug…. */
  file: { projectId: string; jiraConnected: boolean } | null;
  high: number;
  questions: number;
  unanswered: number;
  notes: number;
  ideas: number;
  plusOnes: number;
  /** Everything found (ver_96): every bug, question, note and idea, with what people added. */
  finds: ReportFind[];
  vsLast: { name: string; diff: number } | null;
  byArea: { id: string; name: string; bugs: number }[];
  worst: ReportBug[];
  coverage: { id: string; name: string; prompts: number; covered: number; untouched: string[]; notes: number }[];
};

/** Share ▾ (ver_93): a link for anyone in Flaw Patrol, a Slack post, or a paste for Confluence. */
function ShareMenu({ r, onSay }: { r: ReportData; onSay: (s: string) => void }) {
  const exportUrl = `/p/${r.homeKey}/bashes/${r.id}/export`;
  const item = "flex w-full flex-col items-start gap-0 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-slate-50";
  const copyTables = async () => {
    const res = await fetch(`${exportUrl}?format=json`);
    const t = (await res.json()) as { title: string; sub: string[]; tables: { label: string; rows: (string | number | null)[][] }[] };
    const rows = t.tables.flatMap((x, i) => [...(i ? [[] as (string | number | null)[]] : []), [x.label], ...x.rows]);
    const { html, text } = tableClip(t.title, t.sub, rows);
    await copyRich(html, text);
  };
  return (
    <MoreMenu label="Share">
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={async () => {
          await navigator.clipboard?.writeText(window.location.href);
          onSay("Link copied. Anyone in this umbrella can open it.");
        }}
      >
        <span className="font-medium">Copy link</span>
        <span className="text-xs text-slate-500">Anyone in Flaw Patrol on this umbrella can open it</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={async () => {
          const res = await postBashReport(r.id);
          onSay(res.ok ? `Posted to ${res.channels} Slack ${res.channels === 1 ? "channel" : "channels"}.` : res.error);
        }}
      >
        <span className="font-medium">Post to Slack</span>
        <span className="text-xs text-slate-500">A summary card with a link to this report</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={async () => {
          try {
            await copyTables();
            onSay("Copied. Paste it into Confluence or an email.");
          } catch {
            onSay("Couldn't copy here. Try Export → CSV.");
          }
        }}
      >
        <span className="font-medium">Copy for Confluence or email</span>
        <span className="text-xs text-slate-500">Pastes as a formatted summary</span>
      </button>
    </MoreMenu>
  );
}

function ExportBash({ r, onSay }: { r: ReportData; onSay: (s: string) => void }) {
  const url = `/p/${r.homeKey}/bashes/${r.id}/export`;
  const item = "flex w-full flex-col items-start gap-0 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-slate-50";
  return (
    <MoreMenu label="Export">
      <a role="menuitem" className={item} href={`${url}?format=pdf`}>
        <span className="font-medium">PDF</span>
        <span className="text-xs text-slate-500">The whole report, to print or attach</span>
      </a>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={async () => {
          const el = document.getElementById("bash-report");
          if (!el) return;
          try {
            await saveImage(el, `bug-bash-${r.name.replace(/[^\w.-]+/g, "_")}.png`);
          } catch {
            onSay("Couldn't make the picture in this browser.");
          }
        }}
      >
        <span className="font-medium">Image (PNG)</span>
        <span className="text-xs text-slate-500">For Slack, email or a slide</span>
      </button>
      <a role="menuitem" className={item} href={`${url}?format=xlsx`}>
        <span className="font-medium">Excel workbook (.xlsx)</span>
        <span className="text-xs text-slate-500">Summary, bugs, areas and coverage, one sheet each</span>
      </a>
      <a role="menuitem" className={item} href={`${url}?format=csv`}>
        <span className="font-medium">CSV</span>
        <span className="text-xs text-slate-500">Every bug, for Excel or Google Sheets</span>
      </a>
    </MoreMenu>
  );
}

/** The one-page report (ver_93): numbers, bugs by area, worst bugs, and what got covered. */
export function BashReportView({ r }: { r: ReportData }) {
  const [note, setNote] = useState<string | null>(null);
  const say = (s: string) => {
    setNote(s);
    setTimeout(() => setNote(null), 5000);
  };
  const max = Math.max(1, ...r.byArea.map((a) => a.bugs));
  const area = (id: string) => r.areas.find((a) => a.id === id)?.name ?? "";
  const untouched = r.coverage.filter((c) => c.untouched.length);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Bug bash · {r.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {r.when} · started by {r.createdBy} · {r.people} {r.people === 1 ? "person" : "people"} · {r.areas.length} {r.areas.length === 1 ? "area" : "areas"}
          </p>
          {r.links.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              Whole bash: <LinkChips links={r.links} />
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {note && (
            <span role="status" className="text-xs text-emerald-700">
              {note}
            </span>
          )}
          <ShareMenu r={r} onSay={say} />
          <ExportBash r={r} onSay={say} />
        </div>
      </div>
      {r.notFiled > 0 && (
        <div role="status" className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="bash-unfiled-banner">
          <p className="font-semibold">
            {r.notFiled === 1 ? "1 bug isn't" : `${r.notFiled} bugs aren't`} in {r.file?.jiraConnected === false ? "the bug list" : "Jira"} yet
          </p>
          {r.notFiled === 1 ? "It's" : "They're"} still counted here.{r.file ? <> Press <b>File this bug…</b> to file {r.notFiled === 1 ? "it" : "them"}.</> : ` ${r.createdBy} or a lead can file ${r.notFiled === 1 ? "it" : "them"}.`}
        </div>
      )}
      <div id="bash-report" className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            [r.bugs.length, "Bugs found", r.notFiled ? `${r.notFiled} not filed yet` : ""],
            [r.high, "High or Blocker"],
            [r.questions, "Questions raised", r.unanswered ? `${r.unanswered} not answered` : ""],
            [r.notes, "Notes"],
            [r.ideas, "Ideas"],
            [r.vsLast ? `${r.vsLast.diff >= 0 ? "+" : ""}${r.vsLast.diff}` : "First bash", r.vsLast ? `Bugs vs ${r.vsLast.name}` : "Nothing to compare yet"],
          ].map(([n, label, sub]) => (
            <Card key={label as string} className="p-3">
              <p className="text-2xl font-semibold text-slate-900 tabular-nums">{n}</p>
              <p className="text-xs text-slate-500">{label}</p>
              {sub && <p className="text-xs text-amber-700">{sub}</p>}
            </Card>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Bugs by area</h2>
            <ul className="space-y-1.5 text-sm">
              {r.byArea.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <span className="w-36 truncate" title={r.areas.find((x) => x.id === a.id)?.links.map((l) => l.key).join(", ")}>
                    {a.name}
                  </span>
                  <span className="h-2.5 rounded-full bg-red-500" style={{ width: `${(a.bugs / max) * 60}%`, minWidth: a.bugs ? 6 : 0 }} aria-hidden />
                  <span className="text-xs text-slate-600 tabular-nums">{a.bugs}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Worst bugs</h2>
            {r.worst.length === 0 ? (
              <p className="text-sm text-slate-500">No bugs. 🎉</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {r.worst.map((b) => (
                  <li key={b.id} className="flex items-center gap-2">
                    <SevChip s={b.severity} name={r.sevNames[b.severity]} />
                    {b.key && (b.url ? <a href={b.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent-700 hover:underline">{b.key}</a> : <span className="font-mono text-xs">{b.key}</span>)}
                    <span className="min-w-0 flex-1 truncate">
                      {b.text}
                      {b.unfiled && <UnfiledTag left={b.unfiled === "left"} />}
                    </span>
                    {b.seen > 1 && <span className="text-xs text-slate-500">{b.seen} people</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card className="p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            What got covered <InfoTip text="Prompts ticked in each area, from its tour or checklist. Areas with a blank charter count notes instead." />
          </h2>
          <p className="text-sm text-slate-700">{r.coverage.map((c) => (c.prompts ? `${c.name} ${c.covered} of ${c.prompts} prompts` : `${c.name}: blank charter, ${c.notes} ${c.notes === 1 ? "note" : "notes"}`)).join(" · ")}</p>
          {untouched.length > 0 && (
            <p className="mt-1 text-sm text-slate-500">
              Not touched: {untouched.map((c) => `${c.name} ${c.untouched.map((u) => `“${u}”`).join(", ")}`).join("; ")}
            </p>
          )}
        </Card>
        <Card className="overflow-x-auto" data-export-skip>
          <h2 className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800">{r.bugs.length === 1 ? "The 1 bug" : `All ${r.bugs.length} bugs`}</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {r.bugs.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-1.5">
                    <SevChip s={b.severity} name={r.sevNames[b.severity]} />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs">{b.url ? <a href={b.url} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">{b.key}</a> : b.key}</td>
                  <td className="px-2 py-1.5">
                    {b.text}
                    {b.unfiled && <UnfiledTag left={b.unfiled === "left"} why={b.why} />}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-slate-600">{area(b.areaId)}</td>
                  <td className="px-4 py-1.5 text-xs text-slate-600">
                    {b.byName}
                    {b.seen > 1 && ` +${b.seen - 1}`}
                  </td>
                  <td className="px-4 py-1.5 text-right" data-export-skip>
                    {b.unfiled && r.file && <FileBashBug bug={b} projectId={r.file.projectId} entryId={r.entryOf[b.areaId] ?? null} jiraConnected={r.file.jiraConnected} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <EverythingFound r={r} />
      </div>
    </div>
  );
}

/** Everything found (ver_96): every kind of find, by area or by time, with +1s, additions and answers. */
function EverythingFound({ r }: { r: ReportData }) {
  const [kind, setKind] = useState<"all" | FindKind>("all");
  const [view, setView] = useState<"area" | "time">("area");
  const shown = r.finds.filter((f) => kind === "all" || f.kind === kind);
  const count = (k: FindKind) => r.finds.filter((f) => f.kind === k).length;
  const area = (id: string) => r.areas.find((a) => a.id === id);
  const row = (f: ReportFind) => (
    <li key={f.id} className="flex items-start gap-2 py-2 text-sm">
      <KindTag kind={f.kind} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-slate-900">
          {f.text}
          {f.kind === "question" && (
            <span className={cx("ml-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold", f.adds.length ? "bg-emerald-50 text-emerald-800" : "bg-violet-50 text-violet-800")}>{f.adds.length ? "Answered" : "Not answered"}</span>
          )}
        </p>
        <p className="text-xs text-slate-500">
          {f.byName}
          {f.plusOnes.length > 0 && ` · +${f.plusOnes.length} (${f.plusOnes.join(", ")})`}
          {view === "time" && ` · ${area(f.areaId)?.name ?? ""}`}
        </p>
        {f.adds.map((a, i) => (
          <p key={i} className="text-xs text-slate-600">
            {f.kind === "question" ? "Answer" : "Added"} by {a.by}: &ldquo;{a.text}&rdquo;
          </p>
        ))}
      </div>
      <span className="shrink-0 text-right text-xs">
        {f.kind === "bug" && <SevChip s={f.severity} name={r.sevNames[f.severity]} />}
        {f.kind === "bug" && (
          <span className="mt-0.5 block font-mono">
            {f.key ? f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">{f.key}</a> : f.key : f.left ? <span className="font-sans text-slate-500">Left out</span> : ""}
          </span>
        )}
      </span>
    </li>
  );
  return (
    <Card className="p-4" data-testid="everything-found">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="mr-1 text-sm font-semibold text-slate-800">Everything found · {r.finds.length}</h2>
        <div role="group" aria-label="Kind" className="flex flex-wrap gap-1">
          {(["all", "bug", "question", "note", "idea"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cx("rounded-full px-2 py-0.5 text-xs ring-1 ring-inset", kind === k ? "bg-slate-800 font-semibold text-slate-50 ring-slate-800" : "text-slate-600 ring-slate-200 hover:bg-slate-50")}>
              {k === "all" ? "All" : `${FIND_LABEL[k]}s ${count(k)}`}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Group by" className="ml-auto flex rounded-md bg-slate-100 p-0.5 text-xs">
          {(
            [
              ["area", "By area"],
              ["time", "By time"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)} className={cx("rounded px-2 py-0.5", view === id ? "bg-surface font-semibold shadow-sm" : "text-slate-600")}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {view === "area" ? (
        r.areas.map((a) => {
          const its = shown.filter((f) => f.areaId === a.id);
          return (
            <div key={a.id} className="border-t border-slate-100 pt-2">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                {a.name} <LinkChips links={a.links} />
                <span className="text-xs font-normal text-slate-500">
                  {its.length} {its.length === 1 ? "find" : "finds"}
                </span>
              </p>
              {its.length ? <ul className="divide-y divide-slate-100">{its.map(row)}</ul> : <p className="py-2 text-xs text-slate-500">Nothing of this kind.</p>}
            </div>
          );
        })
      ) : (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">{[...shown].sort((a, b) => a.at.localeCompare(b.at)).map(row)}</ul>
      )}
    </Card>
  );
}

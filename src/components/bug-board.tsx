"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { fileSize, isMe, priorityTone, shortNames, type BoardData, type BoardIssue, type FoundAt, type PriorityTone, type TicketDetail } from "@/lib/bug-board";
import { bugTicket } from "@/server/bug-board";
import { JiraAdf } from "./jira-adf";
import { keepBug, sharedFilters, switchHref } from "@/lib/bugs-view";
import { saveBugsPicks } from "@/server/bug-board";
import { BugsFilterBar, ShowingLine } from "./bugs-filter-bar";
import { Button, cx } from "./ui";

/**
 * Bug board (ver_211): the Bugs page's Board view. Every bug on the team's Jira board, in the
 * board's own columns. Click a card for the bug panel: Jira's description and repro steps, where a run found
 * the bug, then Comments, Attachments and Details. Read only: Jira stays the place to move bugs.
 */

type Where = { groupId?: string; projectId?: string };
type Me = { name: string; email: string };
const PAGE = 50;

const TONE: Record<PriorityTone, string> = {
  high: "bg-red-50 text-red-700 ring-red-200",
  medium: "bg-orange-50 text-orange-700 ring-orange-200",
  low: "bg-sky-50 text-sky-700 ring-sky-200",
  none: "bg-slate-100 text-slate-700 ring-slate-200",
};

function PriorityPill({ name }: { name: string }) {
  if (!name) return null;
  return <span className={cx("rounded px-1.5 py-px text-[11px] font-semibold ring-1 ring-inset", TONE[priorityTone(name)])}>{name}</span>;
}

function FoundTag() {
  return <span className="rounded bg-emerald-50 px-1.5 py-px text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 ring-inset">Found in testing</span>;
}

export type LocalBug = { id: string; label: string; title: string; href: string; createdBy: string; foundIn: string };

export function BugBoard({ where, data, me, jiraKey, foundDefault, local = [] }: { where: Where; data: BoardData; me: Me; jiraKey: string; foundDefault: boolean; local?: LocalBug[] }) {
  const params = useSearchParams();
  const f = sharedFilters(Object.fromEntries(params.entries()), { found: foundDefault });
  const [col, setCol] = useState(0);
  const [shown, setShown] = useState<Record<number, number>>({});
  const [open, setOpen] = useState<string | null>(null);

  const nameOf = useMemo(() => shortNames(data.issues.map((i) => ({ name: i.assignee, email: i.assigneeEmail })), me), [data.issues, me]);
  const sorted = (list: string[]) => [...new Set(list)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const versions = useMemo(() => sorted([...data.issues.flatMap((i) => [...i.versions, ...(i.foundIn ? [i.foundIn] : [])]), ...local.map((l) => l.foundIn).filter(Boolean)]), [data.issues, local]);
  const labels = useMemo(() => sorted(data.issues.flatMap((i) => i.labels)), [data.issues]);
  const priorities = useMemo(() => [...new Set(data.issues.map((i) => i.priority).filter(Boolean))], [data.issues]);

  // The same filters as Table (src/lib/bugs-view.ts), so both views show the same bugs.
  const keep = (i: BoardIssue) => keepBug({ ...i, versions: i.foundIn ? [...i.versions, i.foundIn] : i.versions, inFp: i.found }, f, me);
  // Bugs saved here and not in Jira yet get their own column at the left, like in Table.
  const localCards = local.filter((l) => keepBug({ key: l.label, title: l.title, assignee: l.createdBy, assigneeEmail: "", labels: [], priority: "", versions: l.foundIn ? [l.foundIn] : [], inFp: true }, f, me));
  const columns = data.columns.map((c) => ({ ...c, cards: data.issues.filter((i) => c.statusIds.includes(i.statusId) && keep(i)) }));
  const total = columns.reduce((n, c) => n + c.cards.length, 0) + localCards.length;
  const close = () => setOpen(null);

  return (
    <div data-testid="bug-board" className="flex flex-col gap-3">
      <BugsFilterBar mode="board" jiraKey={jiraKey} boards={data.boards} board={data.board} filters={f} versions={versions} labels={labels} priorities={priorities} />
      <ShowingLine shown={total} found={f.found} board={data.board?.name ?? null} more={data.issues.length + local.length} />
      {data.more && <p className="text-xs text-slate-500">Showing the first 1,000 bugs on the board. Search or filter to find others.</p>}

      {localCards.length > 0 && (
        <section aria-label="Not in Jira yet" data-testid="board-local" className="flex flex-col gap-2 rounded-lg bg-amber-50 p-2 ring-1 ring-amber-200 ring-inset">
          <h2 className="px-1 pt-0.5 text-[11px] font-semibold tracking-wide text-amber-900 uppercase">
            Not in Jira yet <span className="tabular-nums">{localCards.length}</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {localCards.map((l) => (
              <Link key={l.id} href={l.href} className="flex w-full flex-col gap-1 rounded-md border border-slate-200 bg-surface p-2.5 text-sm shadow-sm hover:border-accent-500 md:w-72">
                <span className="line-clamp-2 font-medium text-slate-900">{l.title}</span>
                <span className="font-mono text-xs text-slate-600">{l.label}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Phones: one column at a time, picked from these names. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 md:hidden" role="group" aria-label="Board columns">
        {columns.map((c, i) => (
          <button
            key={c.name}
            type="button"
            aria-pressed={i === col}
            onClick={() => setCol(i)}
            className={cx("shrink-0 rounded-full border px-3 py-1 text-sm whitespace-nowrap", i === col ? "border-accent-500 bg-accent-50 font-medium text-accent-700" : "border-slate-200 text-slate-700")}
          >
            {c.name} <span className="tabular-nums">{c.cards.length}</span>
          </button>
        ))}
      </div>

      <div className={cx("gap-4", open && "lg:grid lg:grid-cols-[minmax(0,1fr)_26rem]")}>
        <div className="overflow-x-auto pb-2" data-howto="board-columns">
          <div className="flex gap-3 md:w-max">
            {columns.map((c, i) => {
              const limit = shown[i] ?? PAGE;
              return (
                <section
                  key={c.name}
                  aria-label={c.name}
                  data-testid="board-column"
                  className={cx("w-full shrink-0 flex-col gap-2 rounded-lg bg-slate-100 p-2 md:flex md:w-72", i === col ? "flex" : "hidden", c.qa && "ring-2 ring-emerald-600 ring-inset")}
                >
                  <h2 className="flex items-baseline justify-between gap-2 px-1 pt-0.5 text-[11px] font-semibold tracking-wide text-slate-700 uppercase">
                    <span>
                      {c.name}
                      {c.qa && <span className="sr-only"> (for QA)</span>}
                    </span>
                    <span className="text-slate-600 tabular-nums">{c.cards.length}</span>
                  </h2>
                  {c.cards.length === 0 && <p className="py-3 text-center text-xs text-slate-600">Nothing here</p>}
                  {c.cards.slice(0, limit).map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      data-testid="board-card"
                      aria-pressed={open === b.key}
                      onClick={() => setOpen(open === b.key ? null : b.key)}
                      className={cx(
                        "flex flex-col gap-1.5 rounded-md border bg-surface p-2.5 text-left text-sm shadow-sm hover:border-accent-500 focus-visible:outline-2 focus-visible:outline-accent-500",
                        open === b.key ? "border-accent-500 ring-2 ring-accent-500/30" : "border-slate-200",
                      )}
                    >
                      <span className="line-clamp-3 font-medium text-slate-900">{b.title}</span>
                      {(b.found || b.labels.length > 0) && (
                        <span className="flex flex-wrap gap-1">
                          {b.found && <FoundTag />}
                          {b.labels.slice(0, 2).map((l) => (
                            <span key={l} className="rounded border border-slate-200 px-1.5 text-[11px] text-slate-700">
                              {l}
                            </span>
                          ))}
                          {b.labels.length > 2 && <span className="text-[11px] text-slate-600">+{b.labels.length - 2}</span>}
                        </span>
                      )}
                      <span className="flex items-center gap-1.5 text-xs">
                        <span className="font-mono text-accent-700">{b.key}</span>
                        <PriorityPill name={b.priority} />
                        <span className="ml-auto truncate text-slate-600">{nameOf({ name: b.assignee, email: b.assigneeEmail })}</span>
                      </span>
                    </button>
                  ))}
                  {c.cards.length > limit && (
                    <Button size="sm" variant="ghost" onClick={() => setShown({ ...shown, [i]: limit + PAGE })}>
                      Show {Math.min(PAGE, c.cards.length - limit)} more
                    </Button>
                  )}
                </section>
              );
            })}
          </div>
        </div>
        {open && <BugPanel key={open} where={where} issue={data.issues.find((i) => i.key === open) ?? null} issueKey={open} nameOf={nameOf} onClose={close} />}
      </div>
    </div>
  );
}

const when = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "");

function BugPanel({ where, issue, issueKey, nameOf, onClose }: { where: Where; issue: BoardIssue | null; issueKey: string; nameOf: (p: { name: string; email: string }) => string; onClose: () => void }) {
  const [state, setState] = useState<{ ticket: TicketDetail; found: FoundAt | null } | { error: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let live = true;
    bugTicket(where, issueKey).then((res) => live && setState(res.ok ? { ticket: res.ticket, found: res.found } : { error: res.error }));
    return () => {
      live = false;
    };
  }, [where, issueKey]);
  useEffect(() => {
    heading.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const t = state && "ticket" in state ? state.ticket : null;
  const title = t?.title ?? issue?.title ?? issueKey;
  const file = (id: string, name: string) => `/api/bug-board/file?${where.groupId ? `g=${encodeURIComponent(where.groupId)}` : `p=${encodeURIComponent(where.projectId ?? "")}`}&id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`;

  return (
    <aside
      aria-label={`Bug ${issueKey}`}
      data-testid="bug-panel"
      className="fixed inset-0 z-40 flex flex-col gap-3 overflow-y-auto bg-surface p-4 lg:sticky lg:top-4 lg:z-auto lg:max-h-[calc(100vh-2rem)] lg:rounded-lg lg:border lg:border-slate-200 lg:shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono font-medium text-accent-700">{issueKey}</span>
        <PriorityPill name={t?.priority ?? issue?.priority ?? ""} />
        {(t?.status || issue?.status) && <span className="rounded border border-slate-200 px-1.5 py-px text-[11px] text-slate-700">{t?.status ?? issue?.status}</span>}
        {issue && <span className="text-slate-600">{nameOf({ name: issue.assignee, email: issue.assigneeEmail })}</span>}
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto grid size-8 place-items-center rounded-md text-lg text-slate-600 hover:bg-slate-100">
          ✕
        </button>
      </div>
      <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold text-slate-900 outline-none">
        {title}
      </h2>
      <div>
        <a href={t?.url ?? issue?.url} target="_blank" rel="noreferrer" data-howto="board-open-jira" className="inline-flex h-9 items-center rounded-md bg-accent-600 px-3 text-sm font-medium text-white hover:bg-accent-700">
          Open in Jira ↗
        </a>
      </div>
      {!state && <p className="text-sm text-slate-600">Loading from Jira…</p>}
      {state && "error" in state && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}
      {t && (
        <>
          <section className="rounded-lg border border-slate-200 p-3" data-testid="bug-panel-description">
            <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-600 uppercase">Description (from Jira)</h3>
            <JiraAdf doc={t.description} empty="No description in Jira." />
          </section>
          {!!t.repro && (
            <section className="rounded-lg border border-slate-200 p-3" data-testid="bug-panel-repro" data-howto="board-repro">
              <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-600 uppercase">Repro steps (from Jira)</h3>
              <JiraAdf doc={t.repro} empty="No repro steps in Jira." />
            </section>
          )}
          {state && "ticket" in state && state.found && <FoundAtBox f={state.found} />}
          <More title="Comments" count={t.comments.length} testid="bug-panel-comments">
            <Comments list={t.comments} />
          </More>
          <More title="Attachments" count={t.attachments.length} testid="bug-panel-attachments">
            {t.attachments.length === 0 ? (
              <p className="text-sm text-slate-600">No attachments.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {t.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-sm">
                    {/^image\/(png|jpeg|gif|webp)$/.test(a.type) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={file(a.id, a.name)} alt="" loading="lazy" className="size-12 rounded border border-slate-200 object-cover" />
                    )}
                    <a href={file(a.id, a.name)} target="_blank" rel="noreferrer" className="min-w-0 truncate text-accent-700 underline">
                      {a.name}
                    </a>
                    <span className="shrink-0 text-xs text-slate-600">{fileSize(a.size)}</span>
                  </li>
                ))}
              </ul>
            )}
          </More>
          <More title="Details" testid="bug-panel-details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {(
                [
                  ["Reporter", t.reporter],
                  ["Assignee", t.assignee || "Unassigned"],
                  ["Labels", t.labels.join(", ")],
                  ["Found in", t.versions.join(", ")],
                  ["Fix version", t.fixVersions.join(", ")],
                  ["Components", t.components.join(", ")],
                  ["Created", when(t.created)],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-slate-600">{k}</dt>
                    <dd className="min-w-0 break-words text-slate-800">{v}</dd>
                  </div>
                ))}
              {t.extras.map((x) => (
                <div key={`x-${x.name}`} className="contents">
                  <dt className="text-slate-600">{x.name}</dt>
                  <dd className="min-w-0 break-words text-slate-800">{x.doc ? <JiraAdf doc={x.doc} /> : <span className="whitespace-pre-wrap">{x.text}</span>}</dd>
                </div>
              ))}
            </dl>
          </More>
        </>
      )}
    </aside>
  );
}

function More({ title, count, testid, children }: { title: string; count?: number; testid: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-slate-200 px-3 py-2" data-testid={testid}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="w-3 font-bold text-accent-700 group-open:hidden">
          +
        </span>
        <span aria-hidden className="hidden w-3 font-bold text-accent-700 group-open:inline">
          −
        </span>
        {title}
        {count !== undefined && <span className="rounded-full bg-slate-100 px-2 text-xs text-slate-700 tabular-nums">{count}</span>}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function Comments({ list }: { list: TicketDetail["comments"] }) {
  const [all, setAll] = useState(false);
  if (!list.length) return <p className="text-sm text-slate-600">No comments.</p>;
  const shown = all ? list : list.slice(0, 3);
  return (
    <div className="flex flex-col gap-3">
      {shown.map((c) => (
        <div key={c.id} className="border-t border-slate-100 pt-2 first:border-0 first:pt-0">
          <p className="text-xs text-slate-600">
            <span className="font-semibold text-slate-800">{c.author}</span> · {when(c.created)}
          </p>
          <JiraAdf doc={c.body} empty="" />
        </div>
      ))}
      {!all && list.length > 3 && (
        <Button size="sm" variant="ghost" className="self-start" onClick={() => setAll(true)}>
          Show {list.length - 3} older
        </Button>
      )}
    </div>
  );
}

function FoundAtBox({ f }: { f: FoundAt }) {
  return (
    <section className="rounded-lg border border-emerald-600 p-3" data-testid="bug-panel-found">
      <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-600 uppercase">Where the bug was found</h3>
      <p className="text-sm">
        <span className="font-mono text-xs text-slate-600">{f.caseKey}</span> <span className="font-medium text-slate-900">{f.caseTitle}</span>
      </p>
      <p className="mb-2 text-xs text-slate-600">{[f.run, f.by && `Found by ${f.by.trim().split(/\s+/)[0]}`].filter(Boolean).join(" · ")}</p>
      {f.steps.length > 0 && (
        <ol className="flex flex-col gap-1 text-sm">
          {f.steps.map((s, i) => (
            <li key={i} className={cx("grid grid-cols-[1.75rem_1fr] gap-1 rounded-md px-1.5 py-1", i === f.step && "bg-red-50 ring-1 ring-red-600")} data-testid={i === f.step ? "found-step" : undefined}>
              <span className="text-slate-600 tabular-nums">{s.number}</span>
              <span className="min-w-0 break-words text-slate-800">
                {s.action}
                {i === f.step && (
                  <span className="mt-0.5 block text-xs">
                    <b className="text-red-700">Bug found here.</b>
                    {s.expected && <span className="text-slate-700"> Expected: {s.expected}</span>}
                    {f.actual && <span className="block text-slate-700">Actual: {f.actual}</span>}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      {f.step === null && <p className="text-xs text-slate-600">Raised on the whole case, not one step.</p>}
      <Link href={f.href} className="mt-2 inline-flex h-8 items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-800 hover:border-accent-500">
        Open this case
      </Link>
    </section>
  );
}

/** Table | Board on the Bugs page. Your pick is remembered, so Bugs opens the way you left it. */
/** Table | Board (ver_211). It keeps every filter and the Jira board, and saves the pick on the account (ver_232). */
export function BugViewSwitch({ view }: { view: "table" | "board" }) {
  const params = useSearchParams();
  const remember = (v: "table" | "board") => {
    document.cookie = `fp-bugs-view=${v}; path=/; max-age=31536000; samesite=lax`;
    void saveBugsPicks({ view: v });
  };
  const item = (v: "table" | "board", label: string) => (
    <Link
      href={switchHref(params.toString(), v)}
      onClick={() => remember(v)}
      aria-current={view === v ? "page" : undefined}
      className={cx("px-3 py-1 text-sm font-medium", view === v ? "bg-accent-600 text-white" : "text-slate-700 hover:bg-slate-100")}
    >
      {label}
    </Link>
  );
  return (
    <span className="inline-flex overflow-hidden rounded-md border border-slate-300" role="group" aria-label="View" data-howto="bugs-board-switch">
      {item("table", "Table")}
      {item("board", "Board")}
    </span>
  );
}

/**
 * Table with Found in testing off (ver_232): the bugs on the Jira board that Flaw Patrol doesn't
 * have, under Flaw Patrol's own. Click one for the same bug panel as on Board.
 */
export function JiraOnlyList({ where, issues, me, board }: { where: Where; issues: BoardIssue[]; me: Me; board: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const nameOf = useMemo(() => shortNames(issues.map((i) => ({ name: i.assignee, email: i.assigneeEmail })), me), [issues, me]);
  if (!issues.length) return null;
  return (
    <section aria-labelledby="jira-only-title" data-testid="jira-only" className="mt-6 flex flex-col gap-2">
      <h2 id="jira-only-title" className="text-sm font-semibold text-slate-900">
        Also on {board ?? "the Jira board"}, not found in testing <span className="font-normal text-slate-600 tabular-nums">({issues.length})</span>
      </h2>
      <div className={cx("gap-4", open && "lg:grid lg:grid-cols-[minmax(0,1fr)_26rem]")}>
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-surface text-sm">
          {issues.slice(0, limit).map((i) => (
            <li key={i.key}>
              <button type="button" aria-pressed={open === i.key} onClick={() => setOpen(open === i.key ? null : i.key)} data-testid="jira-only-row" className={cx("flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-left hover:bg-slate-50", open === i.key && "bg-accent-50")}>
                <span className="font-mono text-xs text-accent-700">{i.key}</span>
                <span className="min-w-0 flex-1 text-slate-900">{i.title}</span>
                <span className="rounded border border-slate-200 px-1.5 py-px text-[11px] text-slate-700">{i.status}</span>
                <PriorityPill name={i.priority} />
                <span className="w-20 truncate text-xs text-slate-600">{nameOf({ name: i.assignee, email: i.assigneeEmail })}</span>
              </button>
            </li>
          ))}
        </ul>
        {open && <BugPanel key={open} where={where} issue={issues.find((i) => i.key === open) ?? null} issueKey={open} nameOf={nameOf} onClose={() => setOpen(null)} />}
      </div>
      {issues.length > limit && (
        <Button size="sm" variant="ghost" className="self-start" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, issues.length - limit)} more
        </Button>
      )}
    </section>
  );
}

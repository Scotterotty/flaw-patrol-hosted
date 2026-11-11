"use client";

import type { ResultStatus } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { entryClientResults } from "@/lib/clients";
import { useLiveRows } from "@/lib/live-rows";
import { STATUS_STYLE } from "@/lib/status";
import { markClient } from "@/server/clients";
import { Modal } from "./modal";
import { StatusIcon } from "./status";
import { Button, buttonClass, cx, ErrorText, LinkButton } from "./ui";

// Clients (ver_214): the run page of a test cycle with clients, like a demo dry run. One row per
// case and one column per client, so anyone sees at a glance which clients passed and which failed.
// Phones get a card per case with a 2×2 block of clients. Tapping a client opens a small box to mark it.

export type GridBug = { key: string; url: string | null };
export type GridEntry = {
  id: string;
  caseKey: string;
  title: string;
  /** The top folder, shown as a heading over its cases (like "Frida Demo Space"). */
  group: string;
  /** The test step in full, the way the case reads. */
  stepText: string;
  /** The clients this case runs on. Others show "Doesn't apply". */
  clients: string[];
  /** Each result step's test data row, headings left out, and each row's client. */
  rowOf: number[];
  rowClient: string[];
  /** Step results without headings, from the draft or the last saved result. */
  progress: ResultStatus[] | null;
  bugs: Record<string, GridBug[]>;
};

const WORDS: Partial<Record<ResultStatus, string>> = { UNTESTED: "Not run", IN_PROGRESS: "In progress" };
const word = (s: ResultStatus) => WORDS[s] ?? s.charAt(0) + s.slice(1).toLowerCase();
const MARKS = [
  { status: "PASSED", label: "Passed", key: "P" },
  { status: "FAILED", label: "Failed", key: "F" },
  { status: "BLOCKED", label: "Blocked", key: "B" },
] as const;

export function ClientGrid({
  projectId,
  projectKey,
  runId,
  runNumber,
  clients,
  entries,
  canRun,
  renderedAt,
  startLabel,
  viewSwitch,
}: {
  /** By client / Case list, shown at the end of the client row. */
  viewSwitch?: React.ReactNode;
  projectId: string;
  projectKey: string;
  runId: string;
  runNumber: number;
  clients: string[];
  entries: GridEntry[];
  canRun: boolean;
  renderedAt: number;
  /** "Start testing" or "Continue testing", the same words as the button at the top. */
  startLabel: string;
}) {
  const router = useRouter();
  const live = useLiveRows(renderedAt);
  // Marks made here show straight away, before the page catches up.
  const [mine, setMine] = useState<Record<string, Record<string, ResultStatus>>>({});
  useEffect(() => setMine({}), [renderedAt]);
  const [filter, setFilter] = useState<string>("");
  const filterKey = `fp-client-filter:${runId}`;
  useEffect(() => {
    try {
      const f = localStorage.getItem(filterKey);
      if (f && clients.includes(f)) setFilter(f);
    } catch {}
  }, [filterKey, clients]);
  const pickFilter = (f: string) => {
    setFilter(f);
    try {
      if (f) localStorage.setItem(filterKey, f);
      else localStorage.removeItem(filterKey);
    } catch {}
  };
  const [open, setOpen] = useState<{ entry: GridEntry; client: string } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const cells = useMemo(() => {
    const out = new Map<string, Record<string, ResultStatus>>();
    for (const e of entries) {
      const row = live?.get(e.id);
      out.set(e.id, { ...entryClientResults(e, row ? row.progress : e.progress), ...mine[e.id] });
    }
    return out;
  }, [entries, live, mine]);

  const shownClients = filter ? clients.filter((c) => c === filter) : clients;
  const shownEntries = filter ? entries.filter((e) => e.clients.includes(filter)) : entries;
  const runPath = `/p/${projectKey}/runs/${runNumber}`;
  const runnerHref = (e: GridEntry | null, client: string | null, bug = false) =>
    e ? `${runPath}/execute?entry=${e.id}${client ? `&client=${encodeURIComponent(client)}` : ""}${bug ? "&bug=1" : ""}` : `${runPath}/execute?just=${encodeURIComponent(client ?? "")}`;

  const mark = (e: GridEntry, client: string, status: ResultStatus) => {
    setError(null);
    start(async () => {
      const r = await markClient(projectId, e.id, { client, status: status as "PASSED" | "FAILED" | "BLOCKED" | "UNTESTED" });
      if (!r.ok) return setError(r.error);
      setMine((m) => ({ ...m, [e.id]: { ...m[e.id], [client]: status } }));
      setOpen(null);
      setNote(`${client}: ${word(status)}. ${e.caseKey} ${e.title}`);
      router.refresh();
    });
  };

  const cell = (e: GridEntry, client: string, phone: boolean) => {
    if (!e.clients.includes(client))
      return (
        <div role="img" aria-label={`${client}: doesn't apply`} title="This case isn't tested on this client" className="flex h-full min-h-11 items-center justify-center rounded-md bg-slate-50 px-2 text-xs text-slate-500">
          {phone && <span className="sr-only">{client}: </span>}Doesn&apos;t apply
        </div>
      );
    const s = cells.get(e.id)?.[client] ?? "UNTESTED";
    const bugs = e.bugs[client] ?? [];
    return (
      <button
        type="button"
        disabled={!canRun}
        onClick={() => {
          setError(null);
          setOpen({ entry: e, client });
        }}
        data-testid="client-cell"
        data-client={client}
        data-status={s}
        className={cx(
          "flex h-full min-h-11 w-full flex-col justify-center gap-0.5 rounded-md px-2.5 py-1.5 text-xs font-medium ring-1 ring-inset transition-shadow",
          phone ? "items-start text-left" : "items-center text-center",
          s === "UNTESTED" ? "bg-surface text-slate-600 ring-slate-300 hover:ring-slate-400" : cx(STATUS_STYLE[s].soft),
          canRun ? "cursor-pointer hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600" : "cursor-default",
        )}
      >
        {/* Read as "Unreal: Failed, bug OB-61. Log in". The client's name shows on phones; the grid's column says it on wider screens. */}
        <span className={phone ? "text-[11px] font-normal text-slate-600" : "sr-only"}>
          {client}
          <span className="sr-only">:</span>
        </span>{" "}
        <span className="inline-flex items-center gap-1">
          {s !== "UNTESTED" && <StatusIcon status={s} always />}
          {word(s)}
        </span>
        {bugs.length > 0 && (
          <span className="font-mono text-[11px] font-normal">
            <span className="sr-only">, bug </span>
            {bugs.map((b) => b.key).join(", ")}
          </span>
        )}
        <span className="sr-only">. {e.title}</span>
      </button>
    );
  };

  let lastGroup = "";
  let lastGroupPhone = "";
  const current = open ? (cells.get(open.entry.id)?.[open.client] ?? "UNTESTED") : "UNTESTED";
  return (
    <section aria-label="Results by client" data-testid="client-grid" data-howto="run-clients">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show clients" className="flex flex-wrap gap-1.5">
          {["", ...clients].map((c) => (
            <button
              key={c || "all"}
              type="button"
              aria-pressed={filter === c}
              onClick={() => pickFilter(c)}
              className={cx(
                "rounded-full border px-3 py-1 text-sm",
                filter === c ? "border-accent-600 bg-accent-50 font-medium text-accent-800" : "border-slate-300 bg-surface text-slate-700 hover:border-slate-400",
              )}
            >
              {c || "All clients"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canRun && filter && (
            <LinkButton size="sm" href={runnerHref(null, filter)}>
              Test {filter} only
            </LinkButton>
          )}
          {viewSwitch}
        </div>
      </div>
      <p className="mb-3 text-sm text-slate-600">{canRun ? "Click a client to mark it, or use " : "Each client's result for every case. "}{canRun && <b className="font-medium">{startLabel}</b>}{canRun && " to go case by case."}</p>
      <p role="status" className="sr-only">
        {note}
      </p>

      {/* Phones: a card per case, its clients in a 2×2 block. */}
      <div className="space-y-3 md:hidden">
        {shownEntries.map((e) => {
          const head = e.group !== lastGroupPhone ? e.group : null;
          lastGroupPhone = e.group;
          const list = filter ? [filter] : e.clients;
          return (
            <Fragment key={e.id}>
              {head && <h2 className="pt-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{head}</h2>}
              <article className="rounded-lg border border-slate-200 bg-surface p-3 shadow-sm">
                <h3 className="fp-name text-sm text-slate-900">
                  <span className="mr-1.5 font-mono text-xs font-normal text-slate-500">{e.caseKey}</span>
                  {e.title}
                </h3>
                {e.stepText && <p className="mt-1 text-[13px] whitespace-pre-line text-slate-600 wrap-anywhere">{e.stepText}</p>}
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  {list.map((c) => (
                    <div key={c}>{cell(e, c, true)}</div>
                  ))}
                </div>
              </article>
            </Fragment>
          );
        })}
      </div>

      {/* Wider screens: the grid. */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-surface md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-600">
              <th scope="col" className="px-3 py-2">
                Case
              </th>
              {shownClients.map((c) => (
                <th key={c} scope="col" className="w-36 px-2 py-2 text-center">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shownEntries.map((e) => {
              const head = e.group !== lastGroup ? e.group : null;
              lastGroup = e.group;
              return (
                <Fragment key={e.id}>
                  {head && (
                    <tr className="border-b border-slate-200 bg-slate-50/60">
                      <th scope="colgroup" colSpan={shownClients.length + 1} className="px-3 pt-3 pb-1.5 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                        {head}
                      </th>
                    </tr>
                  )}
                  <tr className="border-b border-slate-100 align-top last:border-b-0">
                    <th scope="row" className="min-w-64 px-3 py-2.5 text-left font-normal">
                      <span className="font-medium text-slate-900">
                        <span className="mr-1.5 font-mono text-xs font-normal text-slate-500">{e.caseKey}</span>
                        {e.title}
                      </span>
                      {e.stepText && <span className="mt-1 block max-w-prose text-[13px] whitespace-pre-line text-slate-600 wrap-anywhere">{e.stepText}</span>}
                    </th>
                    {shownClients.map((c) => (
                      <td key={c} className="w-36 px-2 py-2.5">
                        {cell(e, c, false)}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {shownEntries.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No cases in this run are tested on {filter}.</p>}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.client} · ${open.entry.title}` : "Client result"} locked={pending}>
        {open && (
          <div className="space-y-4" data-testid="client-sheet">
            <p className="text-xs text-slate-500">
              <span className="font-mono">{open.entry.caseKey}</span> · now {word(current)}
            </p>
            {open.entry.stepText && <p className="max-h-60 overflow-y-auto rounded-md bg-slate-50 p-3 text-sm whitespace-pre-line text-slate-700 wrap-anywhere">{open.entry.stepText}</p>}
            <div role="group" aria-label={`Mark ${open.client}`} className="grid grid-cols-3 gap-2">
              {MARKS.map((m) => (
                <button
                  key={m.status}
                  type="button"
                  disabled={pending}
                  onClick={() => mark(open.entry, open.client, m.status)}
                  aria-pressed={current === m.status}
                  className={cx("inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-semibold ring-1 ring-inset", STATUS_STYLE[m.status].soft, current === m.status && "ring-2")}
                >
                  <StatusIcon status={m.status} always className="size-3.5" />
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <Link href={runnerHref(open.entry, open.client, true)} className={buttonClass("secondary", "sm")}>
                Write a bug for {open.client}
              </Link>
              <Link href={runnerHref(open.entry, open.client)} className={buttonClass("ghost", "sm")}>
                Open in runner
              </Link>
            </div>
            {current !== "UNTESTED" && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => mark(open.entry, open.client, "UNTESTED")}>
                Clear result
              </Button>
            )}
            <ErrorText>{error}</ErrorText>
          </div>
        )}
      </Modal>
    </section>
  );
}

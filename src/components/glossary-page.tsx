"use client";

import { useZone } from "./spelling";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { forgivingFilter, matchCount } from "@/lib/fuzzy";
import { letterOf, type GlossaryRights } from "@/lib/glossary";
import type { GlossaryRow } from "@/lib/glossary-data";
import { deleteGlossaryTerm, editGlossaryTerm, glossaryHistory, glossaryUses, restoreGlossaryVersion } from "@/server/glossary";
import { PersonLabel } from "./avatar";
import { CloseMatchesLabel } from "./close-matches";
import { useGlossary } from "./glossary";
import { Modal } from "./modal";
import { Button, cx, Field, Input, PageHeader, Select, Textarea } from "./ui";

type Filter = "all" | "ask" | "mine" | "week";
type Crown = { holder: string | null; holderCount: number; mine: number; toTake: number; youHold: boolean };

const day = (iso: string, zone?: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: zone });
const WEEK = 7 * 24 * 60 * 60 * 1000;

/** The Glossary page: search, filters, A to Z, and every term with who added it. */
export function GlossaryPage({
  rows,
  groups,
  answeredForMe,
  me,
  rights,
  underline,
  focus,
  edit,
  crown,
  crownDays,
}: {
  rows: GlossaryRow[];
  groups: { id: string; name: string }[];
  answeredForMe: string[];
  me: string;
  rights: GlossaryRights;
  underline: boolean;
  focus: string | null;
  edit: string | null;
  crown: Crown | null;
  crownDays: number;
}) {
  const g = useGlossary();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(() => rows.find((r) => r.slug === edit)?.id ?? null);
  const [history, setHistory] = useState<GlossaryRow | null>(null);
  const [uses, setUses] = useState<GlossaryRow | null>(null);
  const [now] = useState(() => Date.now());
  const groupName = useMemo(() => new Map(groups.map((x) => [x.id, x.name])), [groups]);
  const on = g?.underline ?? underline;

  // A shared link (?term=) or Edit from a meaning card (?edit=) scrolls to that term.
  useEffect(() => {
    const slug = edit ?? focus;
    if (slug) document.getElementById(`term-${slug}`)?.scrollIntoView({ block: "center" });
  }, [focus, edit]);
  useEffect(() => {
    const id = rows.find((r) => r.slug === edit)?.id;
    if (id) setEditing(id);
  }, [edit, rows]);

  const counts = {
    all: rows.length,
    ask: rows.filter((r) => !r.meaning).length,
    mine: rows.filter((r) => r.createdBy?.id === me || r.answeredBy?.id === me).length,
    week: rows.filter((r) => now - new Date(r.createdAt).getTime() < WEEK).length,
  };
  const filtered = rows.filter((r) =>
    filter === "ask" ? !r.meaning : filter === "mine" ? r.createdBy?.id === me || r.answeredBy?.id === me : filter === "week" ? now - new Date(r.createdAt).getTime() < WEEK : true,
  );
  const { exact, close } = forgivingFilter(
    filtered,
    q,
    (r) => [r.term, ...r.aliases, r.meaning, r.question].join(" "),
    (r) => [r.term, ...r.aliases].join(" "),
  );
  // Questions nobody has answered stay at the top until someone does.
  const sort = (list: GlossaryRow[]) => [...list.filter((r) => !r.meaning), ...list.filter((r) => r.meaning)];
  const letters = new Set(rows.filter((r) => r.meaning).map((r) => letterOf(r.term)));
  const firstOf = new Map<string, string>();
  for (const r of sort(exact)) if (r.meaning && !firstOf.has(letterOf(r.term))) firstOf.set(letterOf(r.term), r.id);

  const chip = (id: Filter, label: string, n: number, tone?: "ask") => (
    <button
      type="button"
      aria-pressed={filter === id}
      onClick={() => setFilter(id)}
      className={cx(
        "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset",
        filter === id ? "bg-accent-100 font-semibold text-accent-800 ring-accent-300" : tone === "ask" && n ? "bg-amber-50 text-amber-900 ring-amber-200" : "bg-surface text-slate-600 ring-slate-200 hover:bg-slate-50",
      )}
    >
      {label} {n}
    </button>
  );

  const item = (r: GlossaryRow) =>
    editing === r.id ? (
      <EditTerm key={r.id} row={r} groups={groups} onDone={() => setEditing(null)} />
    ) : (
      <TermRow
        key={r.id}
        row={r}
        anchor={firstOf.get(letterOf(r.term)) === r.id ? letterOf(r.term) : undefined}
        me={me}
        rights={rights}
        group={r.groupId ? (groupName.get(r.groupId) ?? null) : null}
        focused={r.slug === focus}
        newAnswer={answeredForMe.includes(r.id)}
        onEdit={() => setEditing(r.id)}
        onHistory={() => setHistory(r)}
        onUses={() => setUses(r)}
      />
    );

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader
        title="Glossary"
        subtitle="The team's words, explained in plain words. One list for everyone."
        actions={
          <>
            <Button onClick={() => g?.openAdd("ask")}>Ask the team</Button>
            {rights.edit && (
              <Button variant="primary" onClick={() => g?.openAdd("add")}>
                + Add a term
              </Button>
            )}
          </>
        }
      />
      {crown && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600" data-testid="glossary-crown">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">👑 Keeper of Words</span>
          <span>
            {crown.holder ? (crown.youHold ? `You · ${crown.holderCount} terms in the last ${crownDays} days` : `${crown.holder} · ${crown.holderCount} terms in the last ${crownDays} days`) : "Nobody holds it yet"}
          </span>
          {!crown.youHold && <span className="ml-auto text-xs">Add or answer {crown.toTake} more to take it</span>}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search terms and meanings" aria-label="Search the Glossary" className="h-9 min-w-0 flex-1 basis-60" />
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show">
        {chip("all", "All", counts.all)}
        {chip("ask", "Needs an answer", counts.ask, "ask")}
        {chip("mine", "Added by me", counts.mine)}
        {chip("week", "New this week", counts.week)}
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" role="switch" className="peer sr-only" checked={on} onChange={(e) => g?.setUnderline(e.target.checked)} data-testid="underline-switch" />
          <span aria-hidden className="relative h-5 w-9 flex-none rounded-full bg-slate-300 transition-colors peer-checked:bg-accent-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-500 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
          Underline terms everywhere
        </label>
      </div>
      {rows.some((r) => r.meaning) && (
        <nav aria-label="Jump to letter" className="flex flex-wrap gap-0.5 text-xs">
          {"ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("").map((l) =>
            letters.has(l) && firstOf.has(l) ? (
              <a key={l} href={`#letter-${l}`} className="rounded px-1.5 py-0.5 font-bold text-accent-700 hover:bg-accent-50">
                {l}
              </a>
            ) : (
              <span key={l} className="px-1.5 py-0.5 text-slate-300">
                {l}
              </span>
            ),
          )}
        </nav>
      )}
      {q && (
        <p className="text-xs text-slate-500" aria-live="polite">
          {matchCount(exact.length, close.length)}
        </p>
      )}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600">
          <p className="font-medium text-slate-800">No terms yet.</p>
          <p className="mt-1">
            When you see a word you don&apos;t know, select it anywhere in Flaw Patrol and pick <span className="font-semibold">Look it up</span>. Or add one here with{" "}
            <span className="font-semibold">{rights.edit ? "+ Add a term" : "Ask the team"}</span>.
          </p>
        </div>
      ) : exact.length + close.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing matches. Try another word, or add it.</p>
      ) : (
        <ul className="divide-y divide-slate-200 border-y border-slate-200" data-testid="glossary-list">
          {sort(exact).map(item)}
          {close.length > 0 && (
            <>
              <CloseMatchesLabel as="li" className="py-2" />
              {sort(close).map(item)}
            </>
          )}
        </ul>
      )}
      <Modal open={!!history} onClose={() => setHistory(null)} title={history ? `History of "${history.term}"` : ""} wide>
        {history && <History row={history} canRestore={rights.edit} onDone={() => setHistory(null)} />}
      </Modal>
      <Modal open={!!uses} onClose={() => setUses(null)} title={uses ? `Where "${uses.term}" is used` : ""} wide>
        {uses && <Uses row={uses} />}
      </Modal>
    </div>
  );
}

function TermRow({
  row: r,
  anchor,
  me,
  rights,
  group,
  focused,
  newAnswer,
  onEdit,
  onHistory,
  onUses,
}: {
  row: GlossaryRow;
  anchor?: string;
  me: string;
  rights: GlossaryRights;
  group: string | null;
  focused: boolean;
  newAnswer: boolean;
  onEdit: () => void;
  onHistory: () => void;
  onUses: () => void;
}) {
  const zone = useZone();
  const router = useRouter();
  const g = useGlossary();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asked = !r.meaning;
  const canDelete = rights.deleteAny || r.createdBy?.id === me;
  const writer = r.answeredBy && r.answeredBy.id !== r.createdBy?.id ? r.answeredBy : null;
  return (
    <li
      id={`term-${r.slug}`}
      data-testid="glossary-row"
      className={cx("scroll-mt-24 space-y-1.5 py-3", asked && "my-1 rounded-md bg-amber-50/70 px-3", focused && "rounded-md bg-accent-50 px-3 ring-1 ring-accent-200")}
    >
      {anchor && <span id={`letter-${anchor}`} className="block scroll-mt-24" aria-hidden />}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-base font-semibold text-slate-900">{r.term}</h3>
        {r.aliases.length > 0 && <span className="text-xs text-slate-500">also called: {r.aliases.join(", ")}</span>}
        {asked && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Needs an answer</span>}
        {group && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">Only {group}</span>}
        {newAnswer && <span className="rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-semibold text-accent-800">New answer to your question</span>}
      </div>
      {asked ? (
        <p className="text-sm text-slate-700">{r.question ? `"${r.question}"` : "What does this mean?"}</p>
      ) : (
        <p className="max-w-[70ch] text-sm whitespace-pre-line text-slate-800">{r.meaning}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        {r.createdBy ? (
          <>
            <span>{asked || writer ? "Asked by" : "Added by"}</span>
            <PersonLabel person={r.createdBy} size={18} />
          </>
        ) : (
          <span>{asked ? "Asked" : "Added"}</span>
        )}
        <span>· {day(r.createdAt, zone)}</span>
        {writer && (
          <>
            <span>· answered by</span>
            <PersonLabel person={writer} size={18} />
          </>
        )}
        {r.edits > (writer ? 1 : 0) && r.updatedBy && <span>· edited by {r.updatedBy.name || r.updatedBy.email}</span>}
        {r.foundLabel && (
          <span>
            · from{" "}
            {r.foundUrl ? (
              <Link href={r.foundUrl} className="text-accent-700 hover:underline">
                {r.foundLabel}
              </Link>
            ) : (
              r.foundLabel
            )}
          </span>
        )}
        {!asked && (
          <span>
            ·{" "}
            {r.used ? (
              <button type="button" className="text-accent-700 hover:underline" onClick={onUses}>
                used in {r.used} {r.used === 1 ? "place" : "places"}
              </button>
            ) : (
              "not used in any cases or bugs yet"
            )}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {g?.canEdit && (
          <Button size="sm" variant={asked ? "primary" : "secondary"} onClick={onEdit}>
            {asked ? "Answer it" : "Edit"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onHistory}>
          History
        </Button>
        <CopyTermLink slug={r.slug} />
        {canDelete &&
          (confirm ? (
            <span className="inline-flex items-center gap-2 text-xs">
              Delete &quot;{r.term}&quot;?
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  const res = await deleteGlossaryTerm(r.id);
                  if (!res.ok) return setError(res.error);
                  g?.refresh();
                  router.refresh();
                }}
              >
                Yes, delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                Keep it
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setConfirm(true)}>
              Delete
            </Button>
          ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}

/** The term's own link, to paste in chat. */
function CopyTermLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard?.writeText(`${location.origin}/glossary/${slug}`).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Link copied" : "Copy link"}
    </Button>
  );
}

function EditTerm({ row: r, groups, onDone }: { row: GlossaryRow; groups: { id: string; name: string }[]; onDone: () => void }) {
  const router = useRouter();
  const g = useGlossary();
  const [term, setTerm] = useState(r.term);
  const [aliases, setAliases] = useState(r.aliases.join(", "));
  const [meaning, setMeaning] = useState(r.meaning);
  const [groupId, setGroupId] = useState(r.groupId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = !r.meaning;
  return (
    <li id={`term-${r.slug}`} className="scroll-mt-24 py-3">
      <form
        data-glossary-ignore
        className="space-y-3 rounded-lg border border-accent-200 bg-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const res = await editGlossaryTerm(r.id, { term, aliases, meaning, groupId: groupId || null });
          setBusy(false);
          if (!res.ok) return setError(res.error);
          g?.refresh();
          router.replace(location.pathname, { scroll: false });
          router.refresh();
          onDone();
        }}
      >
        <h3 className="text-sm font-semibold text-slate-900">{asked ? `Answer "${r.term}"` : `Edit "${r.term}"`}</h3>
        {asked && r.question && <p className="text-sm text-slate-600">&quot;{r.question}&quot;</p>}
        <Field label="Term" htmlFor={`gt-${r.id}`}>
          <Input id={`gt-${r.id}`} value={term} onChange={(e) => setTerm(e.target.value)} maxLength={80} required />
        </Field>
        <Field label="Other names" htmlFor={`ga-${r.id}`} hint="Optional. Separated by commas.">
          <Input id={`ga-${r.id}`} value={aliases} onChange={(e) => setAliases(e.target.value)} />
        </Field>
        <Field label="What it means" htmlFor={`gm-${r.id}`} hint="Plain words, the way you'd explain it to someone on their first day.">
          <Textarea id={`gm-${r.id}`} rows={4} value={meaning} onChange={(e) => setMeaning(e.target.value)} required autoFocus />
        </Field>
        {groups.length > 0 && (
          <Field label="Who it's for" htmlFor={`gg-${r.id}`}>
            <Select id={`gg-${r.id}`} value={groupId} onChange={(e) => setGroupId(e.target.value)} className="h-9">
              <option value="">Everyone</option>
              {groups.map((x) => (
                <option key={x.id} value={x.id}>
                  Only {x.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {asked ? "Save answer" : "Save"}
          </Button>
          <Button
            onClick={() => {
              router.replace(location.pathname, { scroll: false });
              onDone();
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </li>
  );
}

type Version = { id: string; term: string; aliases: string[]; meaning: string; note: string; by: string; at: string };

function History({ row, canRestore, onDone }: { row: GlossaryRow; canRestore: boolean; onDone: () => void }) {
  const router = useRouter();
  const g = useGlossary();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void glossaryHistory(row.id).then((res) => (res.ok ? setVersions(res.versions) : setError(res.error)));
  }, [row.id]);
  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!versions) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <ol className="max-h-[60vh] space-y-3 overflow-y-auto text-sm" data-testid="glossary-history">
      {versions.map((v, i) => (
        <li key={v.id} className="rounded-md border border-slate-200 p-3">
          <p className="text-xs text-slate-500">
            {v.note} by {v.by} · {new Date(v.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {i === 0 && " · current"}
          </p>
          <p className="mt-1 font-semibold text-slate-900">
            {v.term}
            {v.aliases.length > 0 && <span className="font-normal text-slate-500"> · also called {v.aliases.join(", ")}</span>}
          </p>
          <p className="mt-1 whitespace-pre-line text-slate-700">{v.meaning || <span className="text-slate-400">No meaning yet</span>}</p>
          {canRestore && i > 0 && v.meaning && (v.meaning !== versions[0].meaning || v.term !== versions[0].term) && (
            <Button
              size="sm"
              className="mt-2"
              onClick={async () => {
                const res = await restoreGlossaryVersion(v.id);
                if (!res.ok) return setError(res.error);
                g?.refresh();
                router.refresh();
                onDone();
              }}
            >
              Put this version back
            </Button>
          )}
        </li>
      ))}
    </ol>
  );
}

function Uses({ row }: { row: GlossaryRow }) {
  const [uses, setUses] = useState<{ kind: "Case" | "Bug"; label: string; href: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void glossaryUses(row.id).then((res) => (res.ok ? setUses(res.uses) : setError(res.error)));
  }, [row.id]);
  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!uses) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!uses.length) return <p className="text-sm text-slate-500">Not used in any cases or bugs you can see.</p>;
  return (
    <ul className="max-h-[60vh] space-y-1 overflow-y-auto text-sm">
      {uses.map((u) => (
        <li key={u.href + u.label} className="flex gap-2">
          <span className="w-10 flex-none text-xs text-slate-500">{u.kind}</span>
          <Link href={u.href} className="min-w-0 truncate text-accent-700 hover:underline">
            {u.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { copyRich } from "./export-menu";
import { MoreMenu } from "./more-menu";
import { useMenuPlace } from "./menu-place";
import { copyCustomReport, createCustomReport, deleteCustomReport, saveCustomReport } from "@/server/custom-reports";
import { layoutRows, newItemId, type OwnFilters, type PartId, type ReportItem, type ReportNote, type ReportPart } from "@/lib/report-parts";
import { Button, buttonClass, cx, ErrorText, Input, Select } from "./ui";

// Custom reports: the editor, the toolbar above a report, and the New report card.

export type EditorItem = ReportNote | (ReportPart & { title: string; from: string });
type Catalog = { tab: string; parts: { id: string; title: string }[] }[];

const strip = (items: EditorItem[]): ReportItem[] => items.map((it) => (it.k === "note" ? it : { k: "part", id: it.id, part: it.part, heading: it.heading, side: it.side, pb: it.pb, own: it.own }));

/** "+ New report" on the list: name it, then go straight to editing. */
export function NewReportButton({ projectId, base }: { projectId: string; base: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 p-4 text-center text-accent-700 hover:border-accent-400">
        <span className="text-2xl leading-none">+</span>
        <span className="font-semibold">New report</span>
        <span className="text-xs text-slate-500">Start blank and tick the parts you want</span>
      </button>
    );
  return (
    <form
      className="flex min-h-28 flex-col justify-center gap-2 rounded-lg border border-accent-300 bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await createCustomReport(projectId, { name });
          if (!r.ok) return setError(r.error);
          router.push(`${base}/${r.id}?edit=1`);
        });
      }}
    >
      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name the report, like RC 23 weekly summary" aria-label="Report name" maxLength={80} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending || !name.trim()}>
          Make report
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
    </form>
  );
}

/** The whole report for Confluence or email: tables as tables, charts and numbers as pictures, notes as text. */
async function copyReport(title: string, lines: string[]) {
  const body = document.getElementById("custom-report-body");
  if (!body) throw new Error("no report");
  const { toPng } = await import("html-to-image");
  const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html: string[] = [`<h2>${esc(title)}</h2>`, ...lines.map((l) => `<p><em>${esc(l)}</em></p>`)];
  const text: string[] = [title, ...lines, ""];
  for (const sec of Array.from(body.querySelectorAll<HTMLElement>("section[data-part]"))) {
    if (sec.dataset.part === "note") {
      const t = sec.innerText.trim();
      html.push(`<p>${esc(t).replace(/\n/g, "<br/>")}</p>`);
      text.push(t, "");
      continue;
    }
    const heading = sec.querySelector<HTMLElement>("[data-part-heading]")?.innerText.trim() ?? "";
    html.push(`<h3>${esc(heading)}</h3>`);
    text.push(heading);
    const tables = Array.from(sec.querySelectorAll("table"));
    if (tables.length) {
      for (const t of tables) {
        const rows = Array.from(t.rows).map((r) => Array.from(r.cells).map((c) => c.innerText.replace(/\s+/g, " ").trim()));
        html.push(`<table><tbody>${rows.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table>`);
        text.push(...rows.map((r) => r.join("\t")));
      }
    } else {
      const url = await toPng(sec, { backgroundColor: bg, pixelRatio: 2, filter: (n) => !(n instanceof HTMLElement && n.dataset.exportSkip !== undefined) });
      html.push(`<p><img src="${url}" alt="${esc(heading)}" style="max-width:100%"/></p>`);
      text.push(sec.innerText.replace(/\n{2,}/g, "\n").trim());
    }
    text.push("");
  }
  await copyRich(html.join("\n"), text.join("\n"));
}

/** Above a report: Copy link, Export, Edit report, and ⋯ for copy, sharing and delete. */
export function CustomReportToolbar({
  projectId,
  report,
  listHref,
  editHref,
  exportUrl,
  preparedBy,
  scopeLine,
}: {
  projectId: string;
  report: { id: string; name: string; shared: boolean; canEdit: boolean; canDelete: boolean; mine: boolean };
  listHref: string;
  editHref: string;
  exportUrl: string;
  preparedBy: string;
  scopeLine: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  const say = (s: string) => {
    setNote(s);
    setTimeout(() => setNote(null), 5000);
  };
  const run = (fn: () => Promise<{ ok: boolean; error?: string; id?: string }>, after?: (id?: string) => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      after?.(r.id);
      router.refresh();
    });
  const item = "flex w-full flex-col items-start gap-0 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-slate-50";
  return (
    <div>
      <Link href={listHref} className="text-sm text-accent-700 hover:underline">
        ← All custom reports
      </Link>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold text-slate-900" data-testid="report-name">
          {report.name}
        </h2>
        <span className="rounded border border-slate-200 px-1.5 text-xs text-slate-500">{report.shared ? "Shared" : "Only you"}</span>
        <span className="flex-1" />
        {note && (
          <span role="status" className="text-xs text-emerald-700">
            {note}
          </span>
        )}
        <Button
          variant="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              say("Link copied.");
            } catch {
              setError("Couldn't copy. Copy the address from the browser instead.");
            }
          }}
        >
          Copy link
        </Button>
        <MoreMenu label={busy ? "Exporting…" : "Export"}>
          <a role="menuitem" className={item} href={`${exportUrl}&format=pdf&by=1&logo=1`}>
            <span className="font-medium">PDF report</span>
            <span className="text-xs text-slate-500">Name, filters, date and who made it on page 1, then the parts in order</span>
          </a>
          <a role="menuitem" className={item} href={`${exportUrl}&format=xlsx`}>
            <span className="font-medium">Excel workbook</span>
            <span className="text-xs text-slate-500">One sheet per part, plus one with the filters and notes</span>
          </a>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={async () => {
              setBusy(true);
              try {
                await copyReport(report.name, [scopeLine, `Prepared by ${preparedBy}`]);
                say("Copied. Paste it into Confluence or an email.");
              } catch {
                setError("Couldn't copy in this browser. Try the PDF instead.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <span className="font-medium">Copy for Confluence or email</span>
            <span className="text-xs text-slate-500">Tables paste as tables, charts as pictures</span>
          </button>
        </MoreMenu>
        {report.canEdit ? (
          <Link href={editHref} className={buttonClass("primary")} data-testid="edit-report">
            Edit report
          </Link>
        ) : (
          <Button variant="primary" disabled={pending} onClick={() => run(() => copyCustomReport(projectId, report.id), (id) => id && router.push(`${listHref}/${id}?edit=1`))}>
            Make a copy
          </Button>
        )}
        <MoreMenu label="⋯" title="More">
          <button type="button" role="menuitem" className={item} onClick={() => run(() => copyCustomReport(projectId, report.id), (id) => id && router.push(`${listHref}/${id}`))}>
            Make a copy
          </button>
          {report.mine && (
            <button type="button" role="menuitem" className={item} onClick={() => run(() => saveCustomReport(projectId, report.id, { shared: !report.shared }))}>
              {report.shared ? "Make it only mine" : "Share with everyone"}
            </button>
          )}
          {report.canDelete && (
            <button type="button" role="menuitem" className={cx(item, "text-red-700")} onClick={() => setConfirm(true)}>
              Delete report…
            </button>
          )}
        </MoreMenu>
      </div>
      {confirm && (
        <div role="alertdialog" aria-label="Delete report" className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          Delete &ldquo;{report.name}&rdquo;{report.shared ? " for everyone" : ""}? This can&apos;t be undone.
          <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => deleteCustomReport(projectId, report.id), () => router.push(listHref))}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Keep it
          </Button>
        </div>
      )}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
    </div>
  );
}

/** A part's ⋯ menu in the editor. */
function PartMenu({ it, releases, update, remove }: { it: Extract<EditorItem, { k: "part" }>; releases: string[]; update: (p: Partial<ReportPart>) => void; remove: () => void }) {
  const [open, setOpen] = useState(false);
  const [heading, setHeading] = useState(it.heading ?? it.title);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const place = useMenuPlace(open, box, list);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const own = it.own ?? {};
  const setOwn = (p: Partial<OwnFilters>) => {
    const next = { ...own, ...p };
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as OwnFilters;
    update({ own: Object.keys(clean).length ? clean : undefined });
  };
  const row = "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-slate-50";
  return (
    <div ref={box} className="relative">
      <button type="button" aria-label={`Options for ${it.heading ?? it.title}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="rounded px-1.5 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-900" data-testid="part-menu">
        ⋯
      </button>
      {open && (
      <div ref={list} role="menu" style={place} className={cx("absolute right-0 z-30 w-72 rounded-lg border border-slate-200 bg-surface p-1 shadow-lg")}>
        <form
          className="flex gap-1.5 p-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            update({ heading: heading.trim() && heading.trim() !== it.title ? heading.trim() : undefined });
            setOpen(false);
          }}
        >
          <Input value={heading} onChange={(e) => setHeading(e.target.value)} aria-label="Heading" className="h-7 text-xs" maxLength={120} />
          <Button size="sm" type="submit">
            Rename
          </Button>
        </form>
        <button type="button" role="menuitem" className={row} onClick={() => (update({ side: !it.side }), setOpen(false))}>
          {it.side ? "Stop showing side by side" : "Side by side with the next part"}
        </button>
        <button type="button" role="menuitem" className={row} onClick={() => (update({ pb: !it.pb }), setOpen(false))}>
          {it.pb ? "Don't force a new page" : "Start on a new page in the PDF"}
        </button>
        <div className="border-t border-slate-100 px-2.5 pt-2 pb-1.5">
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Use its own filters</p>
          <Select value={own.release ?? ""} onChange={(e) => setOwn({ release: e.target.value || undefined, allTime: undefined })} aria-label="Release for this part" className="h-8 text-xs">
            <option value="">Same release as the report</option>
            {releases.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          {!own.release && (
            <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={!!own.allTime} onChange={(e) => setOwn({ allTime: e.target.checked || undefined })} className="accent-accent-600" /> All time, not the report&apos;s dates
            </label>
          )}
          {it.part.startsWith("defects.") && (
            <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={!!own.critical} onChange={(e) => setOwn({ critical: e.target.checked || undefined })} className="accent-accent-600" /> Critical bugs only
            </label>
          )}
        </div>
        <button type="button" role="menuitem" className={cx(row, "border-t border-slate-100 text-red-700")} onClick={() => (remove(), setOpen(false))}>
          Remove from report
        </button>
      </div>
      )}
    </div>
  );
}

/** Edit report: tick parts on the left, drag them into order on the right, add notes. Saves as you go. */
export function CustomReportEditor({
  projectId,
  report,
  query,
  items: serverItems,
  previews,
  catalog,
  releases,
  viewHref,
  filters,
}: {
  projectId: string;
  report: { id: string; name: string; shared: boolean; mine: boolean; query: string };
  /** The filters on screen now, saved with every change. */
  query: string;
  items: EditorItem[];
  previews: Record<string, ReactNode>;
  catalog: Catalog;
  releases: string[];
  viewHref: string;
  filters: ReactNode;
}) {
  const router = useRouter();
  const [items, setItems] = useState(serverItems);
  const [name, setName] = useState(report.name);
  const [shared, setShared] = useState(report.shared);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // What the report was when editing began, for Cancel.
  const [original] = useState(() => ({ name: report.name, shared: report.shared, items: strip(serverItems), query: report.query }));
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const busy = useRef(0);

  // After a save the page reloads its parts; take the server's list once nothing is waiting.
  const serverKey = JSON.stringify(strip(serverItems));
  useEffect(() => {
    if (busy.current === 0) setItems(serverItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  const save = (patch: Parameters<typeof saveCustomReport>[2]) => {
    busy.current++;
    setSaving((n) => n + 1);
    chain.current = chain.current.then(async () => {
      const r = await saveCustomReport(projectId, report.id, { query, ...patch });
      busy.current--;
      setSaving((n) => n - 1);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
    return chain.current;
  };
  const change = (next: EditorItem[]) => {
    setItems(next);
    save({ items: strip(next) });
  };
  const update = (id: string, p: Partial<ReportPart>) => change(items.map((x) => (x.id === id && x.k === "part" ? { ...x, ...p } : x)));
  const remove = (id: string) => change(items.filter((x) => x.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const i = items.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
  };
  const dropOn = (target: string) => {
    if (!drag || drag === target) return;
    const next = [...items];
    const from = next.findIndex((x) => x.id === drag);
    const [it] = next.splice(from, 1);
    next.splice(
      next.findIndex((x) => x.id === target) + (from <= items.findIndex((x) => x.id === target) ? 1 : 0),
      0,
      it,
    );
    change(next);
  };
  const ticked = useMemo(() => new Set(items.flatMap((x) => (x.k === "part" ? [x.part] : []))), [items]);
  const tick = (part: { id: string; title: string }, on: boolean, from: string) =>
    change(on ? [...items, { k: "part", id: newItemId(), part: part.id as PartId, title: part.title, from }] : items.filter((x) => x.k !== "part" || x.part !== part.id));
  const s = search.trim().toLowerCase();

  const slot = (it: EditorItem) => (
    <div
      key={it.id}
      className={cx("flex min-w-0 gap-1.5 rounded-lg", drag === it.id && "opacity-40", over === it.id && drag !== it.id && "outline-2 outline-offset-2 outline-accent-500 outline-dashed")}
      draggable
      onDragStart={(e) => {
        if ((e.target as HTMLElement).closest("textarea,input,select,[role=menu]")) return e.preventDefault();
        setDrag(it.id);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", it.id);
      }}
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        setOver(it.id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dropOn(it.id);
        setDrag(null);
        setOver(null);
      }}
      onDragEnd={() => (setDrag(null), setOver(null))}
      data-testid="editor-slot"
    >
      <div className="flex w-6 flex-none flex-col items-center justify-center gap-1 text-slate-400">
        <button type="button" aria-label="Move up" onClick={() => move(it.id, -1)} className="text-[11px] hover:text-slate-900">
          ▲
        </button>
        <span className="cursor-grab text-sm tracking-tighter select-none" title="Drag to move" aria-hidden>
          ⋮⋮
        </span>
        <button type="button" aria-label="Move down" onClick={() => move(it.id, 1)} className="text-[11px] hover:text-slate-900">
          ▼
        </button>
      </div>
      <div className="min-w-0 flex-1">
        {it.k === "note" ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-3">
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Note
              <button type="button" onClick={() => remove(it.id)} className="font-normal tracking-normal text-red-700 normal-case hover:underline">
                Remove
              </button>
            </div>
            <textarea
              defaultValue={it.text}
              onBlur={(e) => e.target.value !== it.text && change(items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)))}
              placeholder="Write a summary, a risk, or your call on the release."
              aria-label="Note"
              rows={3}
              maxLength={4000}
              className="block w-full rounded-md border border-slate-300 bg-surface px-2.5 py-2 text-sm"
            />
          </div>
        ) : (
          <div className="relative">
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
              {it.pb && <span className="rounded border border-slate-200 bg-surface px-1.5 text-[11px] text-slate-500">PDF: new page</span>}
              <PartMenu it={it} releases={releases} update={(p) => update(it.id, p)} remove={() => remove(it.id)} />
            </div>
            {previews[it.id] ?? (
              <div className="rounded-lg border border-slate-200 bg-surface p-4">
                <p className="text-sm font-semibold text-slate-800">{it.heading ?? it.title}</p>
                <p className="mt-1 text-sm text-slate-500">Loading this part…</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[17rem_1fr]">
      <aside className="space-y-3 rounded-lg border border-slate-200 bg-surface p-3 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto" aria-label="Parts you can add">
        <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Parts you can add</p>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search parts…" aria-label="Search parts" className="h-8" />
        {catalog.map((g) => {
          const parts = g.parts.filter((p) => !s || p.title.toLowerCase().includes(s) || g.tab.toLowerCase().includes(s));
          if (!parts.length) return null;
          return (
            <div key={g.tab}>
              <p className="mb-0.5 text-xs font-semibold text-slate-800">{g.tab}</p>
              {parts.map((p) => (
                <label key={p.id} className={cx("flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50", ticked.has(p.id as PartId) ? "text-slate-900" : "text-slate-600")}>
                  <input type="checkbox" checked={ticked.has(p.id as PartId)} onChange={(e) => tick(p, e.target.checked, g.tab)} className="accent-accent-600" />
                  {p.title}
                </label>
              ))}
            </div>
          );
        })}
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== report.name && save({ name: name.trim() })}
            aria-label="Report name"
            className="h-10 max-w-sm text-lg font-semibold"
            maxLength={80}
          />
          {report.mine && (
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => {
                  setShared(e.target.checked);
                  save({ shared: e.target.checked });
                }}
                className="accent-accent-600"
              />
              Share with everyone
            </label>
          )}
          <span className="flex-1" />
          <span className="text-xs text-slate-500" role="status">
            {saving ? "Saving…" : "All changes saved"}
          </span>
          <Button
            variant="ghost"
            onClick={async () => {
              await save({ ...original });
              router.push(viewHref);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              await save({ name: name.trim() || report.name, items: strip(items) });
              router.push(viewHref);
            }}
            data-testid="done-editing"
          >
            Done
          </Button>
        </div>
        {filters}
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm leading-relaxed text-slate-500">
            Tick parts on the left to add them here.
            <br />
            They come in the order you tick them; drag the ⋮⋮ handle to change it.
          </p>
        ) : (
          <div className="space-y-5">
            {layoutRows(items as ReportItem[]).map((row) =>
              row.length === 2 ? (
                <div key={row[0].id} className="grid gap-5 lg:grid-cols-2">
                  {row.map((x) => slot(items.find((i) => i.id === x.id)!))}
                </div>
              ) : (
                slot(items.find((i) => i.id === row[0].id)!)
              ),
            )}
          </div>
        )}
        <div className="flex justify-center">
          <Button size="sm" variant="ghost" onClick={() => change([...items, { k: "note", id: newItemId(), text: "" }])}>
            + Add a note
          </Button>
        </div>
      </div>
    </div>
  );
}



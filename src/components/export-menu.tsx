"use client";

import { useState } from "react";
import { dayIn } from "@/lib/zone";
import { Modal } from "./modal";
import { useZone } from "./spelling";
import { MoreMenu } from "./more-menu";
import { buttonClass, Button, cx } from "./ui";

export type ExportTabChoice = { id: string; label: string; on?: boolean; note?: string };

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** Rows as an HTML table that Confluence and email keep when pasted, and as tab-separated text. */
export function tableClip(title: string, sub: string[], rows: (string | number | null)[][]) {
  const blocks: (string | number | null)[][][] = [[]];
  for (const r of rows) {
    if (!r.length) blocks.push([]);
    else blocks.at(-1)!.push(r);
  }
  const html = [
    `<h3>${esc(title)}</h3>`,
    ...sub.map((s) => `<p><em>${esc(s)}</em></p>`),
    ...blocks
      .filter((b) => b.length)
      .map((b) => `<table><tbody>${b.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table>`),
  ].join("\n");
  const text = [title, ...sub, "", ...rows.map((r) => r.map((c) => String(c ?? "")).join("\t"))].join("\n");
  return { html, text };
}

export async function copyRich(html: string, text: string) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

/** A picture of the tab's charts and numbers (tables are left out), for Slack, email or a slide. */
export async function saveImage(el: HTMLElement, fileName: string) {
  const { toPng } = await import("html-to-image");
  const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";
  const url = await toPng(el, {
    backgroundColor: bg,
    pixelRatio: 2,
    filter: (n) => !(n instanceof HTMLElement && n.dataset.exportSkip !== undefined),
  });
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  a.click();
}

/**
 * Export ▾: the same menu on every Reports page. "This tab" exports what's on screen
 * with its filters; "Whole report" makes a PDF of the tabs you pick, or an Excel workbook.
 */
export function ExportMenu({
  exportUrl,
  view,
  viewLabel,
  image,
  imageTarget = "report-body",
  fileBase,
  tabs,
  scopeLine,
  preparedBy,
  csv,
  copy,
  pickImage,
}: {
  /** The export route with the page's filters, without view or format. */
  exportUrl: string;
  view: string;
  viewLabel: string;
  /** This tab has charts worth a picture. */
  image: boolean;
  imageTarget?: string;
  fileBase: string;
  /** Tabs the PDF can include; "on" ones start ticked. */
  tabs: ExportTabChoice[];
  scopeLine: string;
  preparedBy: string;
  /** Pages that build their own table (Release status, Requirements) hand it over instead. */
  csv?: () => void;
  copy?: () => Promise<void>;
  pickImage?: () => void;
}) {
  const zone = useZone();
  const [note, setNote] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [picked, setPicked] = useState(() => new Set(tabs.filter((t) => t.on).map((t) => t.id)));
  const [cover, setCover] = useState(true);
  const [busy, setBusy] = useState(false);
  const sep = exportUrl.endsWith("?") ? "" : exportUrl.includes("?") ? "&" : "?";
  const url = (q: string) => `${exportUrl}${sep}${q}`;
  const say = (s: string) => {
    setNote(s);
    setTimeout(() => setNote(null), 5000);
  };

  const doCopy = async () => {
    try {
      if (copy) await copy();
      else {
        const res = await fetch(url(`view=${view}&format=json`));
        if (!res.ok) throw new Error();
        const t = (await res.json()) as { label: string; title: string; filters: string[]; rows: (string | number | null)[][] };
        const { html, text } = tableClip(`${t.title} · ${t.label}`, t.filters, t.rows);
        await copyRich(html, text);
      }
      say("Copied. Paste it into Confluence or an email.");
    } catch {
      say("Couldn't copy. Try Download CSV instead.");
    }
  };
  const doImage = async () => {
    if (pickImage) return pickImage();
    const el = document.getElementById(imageTarget);
    if (!el) return;
    setBusy(true);
    try {
      await saveImage(el, `${fileBase}-${view}-${dayIn(new Date(), zone)}.png`);
    } catch {
      say("Couldn't make the picture in this browser.");
    } finally {
      setBusy(false);
    }
  };

  const item = "flex w-full flex-col items-start gap-0 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-slate-50";
  return (
    <div className="flex items-center gap-2" data-howto="reports-export">
      {note && (
        <span role="status" className="text-xs text-emerald-700">
          {note}
        </span>
      )}
      <MoreMenu label={busy ? "Exporting…" : "Export"}>
        <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">This tab: {viewLabel}</p>
        {csv ? (
          <button type="button" role="menuitem" className={item} onClick={csv}>
            <span className="font-medium">CSV</span>
            <span className="text-xs text-slate-500">The table on screen, for Excel or Google Sheets</span>
          </button>
        ) : (
          <a role="menuitem" className={item} href={url(`view=${view}&format=csv`)}>
            <span className="font-medium">CSV</span>
            <span className="text-xs text-slate-500">The table on screen, for Excel or Google Sheets</span>
          </a>
        )}
        {image && (
          <button type="button" role="menuitem" className={item} onClick={doImage}>
            <span className="font-medium">Image (PNG)</span>
            <span className="text-xs text-slate-500">The charts as a picture, for Slack, email or a slide</span>
          </button>
        )}
        <button type="button" role="menuitem" className={item} onClick={doCopy}>
          <span className="font-medium">Copy for Confluence or email</span>
          <span className="text-xs text-slate-500">Pastes as a formatted table</span>
        </button>
        <p className="mt-1 border-t border-slate-100 px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Whole report</p>
        <button type="button" role="menuitem" className={item} onClick={() => setPdfOpen(true)}>
          <span className="font-medium">PDF report…</span>
          <span className="text-xs text-slate-500">The tabs you choose, with filters and date on page 1</span>
        </button>
        <a role="menuitem" className={item} href={url(`format=xlsx&tabs=${tabs.map((t) => t.id).join(",")}`)}>
          <span className="font-medium">Excel workbook (.xlsx)</span>
          <span className="text-xs text-slate-500">One sheet per tab, plus a sheet listing the filters</span>
        </a>
      </MoreMenu>
      <Modal open={pdfOpen} onClose={() => setPdfOpen(false)} title="Export PDF report">
        <p className="text-sm text-slate-600">{scopeLine}</p>
        <p className="mt-3 mb-1.5 text-sm font-medium text-slate-700">Include</p>
        <div className="space-y-1">
          {tabs.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-accent-600"
                checked={picked.has(t.id)}
                onChange={() =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (n.has(t.id)) n.delete(t.id);
                    else n.add(t.id);
                    return n;
                  })
                }
              />
              {t.label}
              {t.note && <span className="text-xs text-slate-500">({t.note})</span>}
            </label>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 text-sm">
          <input type="checkbox" className="accent-accent-600" checked={cover} onChange={() => setCover(!cover)} />
          Put the logo and &quot;Prepared by {preparedBy}&quot; on page 1
        </label>
        <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-3">
          <Button onClick={() => setPdfOpen(false)}>Cancel</Button>
          <a
            className={cx(buttonClass("primary"), !picked.size && "pointer-events-none opacity-50")}
            aria-disabled={!picked.size}
            href={url(`format=pdf&tabs=${tabs.filter((t) => picked.has(t.id)).map((t) => t.id).join(",")}${cover ? "&logo=1&by=1" : ""}`)}
            onClick={() => setPdfOpen(false)}
          >
            Download PDF
          </a>
        </div>
      </Modal>
    </div>
  );
}

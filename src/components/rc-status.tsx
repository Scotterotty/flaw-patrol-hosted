"use client";

import type { WrapUp } from "@/lib/wrap-ups";
import { wrapUpsHtml, wrapUpsRows, wrapUpsText } from "@/lib/wrap-up-text";
import { WrapUpsSection } from "./wrap-ups";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  asOfText,
  BAR,
  barColor,
  automationLine,
  bugKeys,
  buildLine,
  hasAutomation,
  confluenceHtml,
  percent,
  plainText,
  ranToday,
  resultLine,
  severe,
  stateOf,
  type RcBug,
  type RcColumn,
  runsText,
  type RcPick,
  type RcRunChoice,
} from "@/lib/rc-status";
import { AE_SCALE, type SeverityScale } from "@/lib/severity";
import type { Spelling } from "@/lib/spelling";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/status";
import { saveRcReport } from "@/server/rc-report";
import { useMenuPlace } from "./menu-place";
import { MoreMenu } from "./more-menu";
import { ExportMenu } from "./export-menu";
import { exportTabs } from "@/lib/export-tabs";
import { useSpelling } from "./spelling";
import { buttonClass, Card, cx, Select } from "./ui";

type Props = {
  releases: string[];
  release: string;
  pick: RcPick;
  columns: RcColumn[];
  bugs: RcBug[];
  choices: RcRunChoice[];
  others: RcRunChoice[];
  /** The page this report lives on, for switching release. */
  base?: string;
  /** Says where the listed runs come from, in the Runs picker. */
  scopeNote?: string;
  /** The team's severity names and which count as critical. */
  scale?: SeverityScale;
  /** One Export menu, as on Run reports. Without it, Share stays. */
  exportTo?: { url: string; cycle: boolean; preparedBy: string };
  /** Bug bashes that ran during this release. */
  bashCount?: number;
  /** Attached wrap-ups, shown as their own section and copied with the report. */
  wrapUps?: WrapUp[];
  attach?: React.ReactNode;
};

/** A quick view of how each platform's run of a release is going. Sharing it is under Share. */
export function RcStatusView({ releases, release, pick, columns, bugs, choices, others, base = "/rc", scopeNote, scale = AE_SCALE, exportTo, wrapUps = [], attach }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerAnchor = useRef<HTMLDivElement>(null);
  const pickerBox = useRef<HTMLDivElement>(null);
  const pickerPlace = useMenuPlace(pickerOpen, pickerAnchor, pickerBox);
  const [note, setNote] = useState("");
  // "Today" and the time stamp follow the viewer's clock, so they're set after loading.
  const [now, setNow] = useState<Date | null>(null);
  const spelling = useSpelling();
  useEffect(() => setNow(new Date()), [columns]);

  const save = (next: { release: string; hide: string[]; add: string[]; bashes?: boolean }, url?: string) =>
    start(async () => {
      await saveRcReport(next);
      if (url) router.push(url);
      else router.refresh();
    });

  // Ticks change at once; the report follows when the server answers.
  const [ticked, setTicked] = useState(() => new Set(choices.filter((c) => c.on).map((c) => c.id)));
  useEffect(() => setTicked(new Set(choices.filter((c) => c.on).map((c) => c.id))), [choices]);
  const toggle = (c: RcRunChoice) => {
    const on = ticked.has(c.id);
    const next = new Set(ticked);
    if (on) next.delete(c.id);
    else next.add(c.id);
    setTicked(next);
    const added = pick.add.includes(c.id);
    let { hide, add } = pick;
    if (added) add = add.filter((id) => id !== c.id);
    else hide = on ? [...hide, c.id] : hide.filter((id) => id !== c.id);
    save({ release, hide, add, bashes: pick.bashes });
  };

  const copy = async () => {
    const at = new Date();
    const html = confluenceHtml(release, columns, bugs, at, spelling, scale) + wrapUpsHtml(wrapUps, location.origin);
    const text = [plainText(release, columns, bugs, at, spelling, scale), wrapUpsText(wrapUps)].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) }),
      ]);
    } catch {
      // Older browsers: copy a hidden copy of the block the old way.
      const box = document.createElement("div");
      box.innerHTML = html;
      box.style.position = "fixed";
      box.style.left = "-9999px";
      document.body.appendChild(box);
      const range = document.createRange();
      range.selectNodeContents(box);
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.execCommand("copy");
      sel?.removeAllRanges();
      box.remove();
    }
    setNote("Copied. In Confluence, click where it should go and paste (Ctrl+V).");
  };

  const download = () => {
    const canvas = drawImage(release, columns, bugs, new Date(), spelling, scale);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${release.replace(/[^\w-]+/g, "_")}_status.png`;
    a.click();
    setNote("Image downloaded. In Confluence, drag it onto the page or paste it.");
  };

  const shown = choices.filter((c) => c.on);

  return (
    <div className={cx(pending && "opacity-70")}>
      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          Release
          <Select aria-label="Release" value={release} onChange={(e) => save({ release: e.target.value, hide: [], add: [] }, `${base}?release=${encodeURIComponent(e.target.value)}`)} className="w-auto min-w-36 max-w-full">
            {releases.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </label>
        <div ref={pickerAnchor} className="relative">
          <button type="button" className={buttonClass("secondary")} aria-expanded={pickerOpen} onClick={() => setPickerOpen(!pickerOpen)}>
            Runs: {shown.length ? columns.map((c) => c.label).join(", ") : "none"} ▾
          </button>
          {pickerOpen && (
            <div ref={pickerBox} style={pickerPlace} role="group" aria-label="Runs in the report" className="absolute top-full left-0 z-20 w-96 max-w-[90vw] rounded-lg border border-slate-200 bg-surface p-3 shadow-xl">
              <p className="mb-2 text-xs text-slate-500">{scopeNote ?? `Runs marked ${release} in your test cycles.`} Untick any to leave them out.</p>
              <ul className="max-h-72 space-y-1 overflow-auto">
                {choices.map((c) => (
                  <li key={c.id}>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" checked={ticked.has(c.id)} onChange={() => toggle(c)} className="mt-1" />
                      <span>
                        {c.name} <span className="text-slate-500">· {c.project} · R{c.number}</span>
                        {pick.add.includes(c.id) && <span className="text-slate-500"> · added</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {others.length > 0 && (
                <label className="mt-3 block text-xs text-slate-600">
                  Add a run
                  <Select
                    aria-label="Add a run"
                    value=""
                    onChange={(e) => e.target.value && save({ release, hide: pick.hide, add: [...pick.add, e.target.value] })}
                    className="mt-0.5 w-full"
                  >
                    <option value="">Pick another run…</option>
                    {others.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.project} · R{c.number}
                        {c.release ? ` · ${c.release}` : ""}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
            </div>
          )}
        </div>
        {attach}
        <span className="flex-1" />
        {columns.length > 0 && exportTo && (
          <ExportMenu
            exportUrl={exportTo.url}
            view="rc"
            viewLabel="Release status"
            image
            fileBase={release.replace(/[^\w-]+/g, "_")}
            tabs={exportTabs(exportTo.cycle)}
            scopeLine={`${release} · ${scopeNote ?? ""}`}
            preparedBy={exportTo.preparedBy}
            pickImage={download}
            copy={async () => copy()}
            csv={() => {
              const rows = [
                ["Platform", "Build", "State", "Done", "Cases run", "Cases", "Results", "Bugs", "Regressions"],
                ...columns.map((c) => [c.label, buildLine(release, c), stateOf(c).label, `${percent(c)}%`, c.done, c.total, resultLine(c), bugKeys(c), c.regressions ? `${c.regressions.count} (${c.regressions.keys.join(", ")})` : ""]),
                [],
                ["Critical and blocking bugs", "Title", "Severity", "Priority", "Jira status", "Platforms", "Cases"],
                ...bugs.map((b) => [b.key, b.title, scale.labels[b.severity], b.priority, b.status, b.clients.join(", "), b.cases.length]),
                ...(wrapUps.length ? [[], ...wrapUpsRows(wrapUps)] : []),
              ];
              const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
              const url = URL.createObjectURL(new Blob(["\ufeff" + rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" }));
              const a = Object.assign(document.createElement("a"), { href: url, download: `${release.replace(/[^\w-]+/g, "_")}_status.csv` });
              a.click();
              URL.revokeObjectURL(url);
            }}
          />
        )}
        {columns.length > 0 && !exportTo && (
          <MoreMenu label="Share">
            <button type="button" role="menuitem" className={buttonClass("ghost")} onClick={copy}>
              Copy
            </button>
            <button type="button" role="menuitem" className={buttonClass("ghost")} onClick={download}>
              Download image
            </button>
          </MoreMenu>
        )}
        {note && (
          <p role="status" className="w-full text-sm text-slate-600">
            {note}
          </p>
        )}
      </Card>

      {columns.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">No runs are picked. Open Runs and tick at least one.</Card>
      ) : (
        <Card className="p-5">
          <h2 className="text-center text-lg font-semibold tracking-wide text-slate-900">{release.toUpperCase()} TESTING STATUS</h2>
          <p className="mb-4 text-center text-xs text-slate-500">{now ? asOfText(now, spelling) : " "}</p>
          <div className="grid border border-slate-200" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(200px, 1fr))` }}>
            {columns.map((c) => (
              <Column key={c.id} c={c} release={release} now={now} auto={hasAutomation(columns)} />
            ))}
          </div>

          <h3 className="mt-6 mb-2 text-sm font-semibold text-slate-900">{bugs.some((b) => b.fromBash && !severe(b, scale)) ? "Critical and blocking bugs, plus bug bash bugs" : "Critical and blocking bugs"}</h3>
          {bugs.length === 0 ? (
            <p className="text-sm text-slate-500">None so far.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-1.5 pr-3 font-medium">Platform</th>
                    <th className="py-1.5 pr-3 font-medium">Bug</th>
                    <th className="py-1.5 pr-3 font-medium">Severity</th>
                    <th className="py-1.5 pr-3 font-medium">Priority</th>
                    <th className="py-1.5 pr-3 font-medium">Jira status</th>
                    <th className="py-1.5 font-medium">Cases</th>
                  </tr>
                </thead>
                <tbody>
                  {bugs.map((b) => (
                    <tr key={b.id} className="border-b border-slate-100">
                      <td className="py-1.5 pr-3">{b.clients.join(", ")}</td>
                      <td className="py-1.5 pr-3">
                        {b.url ? (
                          <a href={b.url} target="_blank" rel="noreferrer" className="font-medium text-accent-700 hover:underline">
                            {b.key}
                          </a>
                        ) : (
                          <span className="font-medium">{b.key}</span>
                        )}{" "}
                        {b.title}
                        {b.fromBash && <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">from bug bash</span>}
                      </td>
                      <td className={cx("py-1.5 pr-3 whitespace-nowrap", severe(b, scale) && "font-semibold text-red-700")}>{scale.labels[b.severity]}</td>
                      <td className="py-1.5 pr-3">{b.priority || "—"}</td>
                      <td className="py-1.5 pr-3">{b.status}</td>
                      <td className="py-1.5">{b.cases.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <WrapUpsSection items={wrapUps} />
    </div>
  );
}

function Column({ c, release, now, auto }: { c: RcColumn; release: string; now: Date | null; auto: boolean }) {
  const st = stateOf(c);
  return (
    <section aria-label={c.label} className="border border-slate-200 p-4 text-center">
      {c.href ? (
        <a href={c.href} className="font-semibold text-slate-900 hover:underline" title={c.runName}>
          {c.label}
        </a>
      ) : (
        <span className="font-semibold text-slate-900" title={c.runName}>
          {c.label}
        </span>
      )}
      {/* The release and build sit above the status. The release, never a run number like R1 (Scott, ver_182). */}
      <div className="mt-0.5 text-xs text-slate-500" data-testid="rc-column-build">
        {c.bash ? " " : buildLine(release, c)}
      </div>
      {c.kinds && !c.bash && (
        <div className="text-[11px] font-medium text-slate-600" data-testid="rc-column-kind">
          {c.kinds}
        </div>
      )}
      <div className="mt-1 mb-2">
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide" style={{ background: st.chip.fill, color: st.chip.text }}>
          {st.label}
        </span>
      </div>
      <div className="text-3xl font-semibold text-slate-900">{percent(c)}%</div>
      <div className="text-xs text-slate-500">
        {c.platform ? "No manual run yet" : c.done === 0 && c.total > 0 ? `0 of ${c.total} tested by hand` : `${c.done} of ${c.total} cases run${now ? ` · +${ranToday(c, now)} today` : ""}`}
        {!c.platform && !!c.counts.IN_PROGRESS && <span data-testid="rc-in-progress"> · {c.counts.IN_PROGRESS} in progress</span>}
      </div>
      {c.runs.length > 1 && (
        <div className="mt-0.5 text-[11px] text-slate-500" data-testid="rc-column-runs">
          {c.runs.map((r, i) => (
            <span key={r.href}>
              {i > 0 && ", "}
              <a href={r.href} className="hover:underline">
                {r.name}
              </a>
            </span>
          ))}
        </div>
      )}
      <div className="my-2 flex h-2 gap-0.5 overflow-hidden rounded bg-slate-200" role="img" aria-label={resultLine(c)}>
        {BAR.map((s) =>
          c.counts[s] ? <div key={s} title={`${STATUS_LABEL[s]}: ${c.counts[s]}`} style={{ width: `${(c.counts[s]! / Math.max(1, c.total)) * 100}%`, background: STATUS_STYLE[s].fill }} /> : null,
        )}
      </div>
      {/* Just the bugs, each with its Jira link (Scott, ver_182): no passed/failed counts or severity line. */}
      {c.bugList.length === 0 ? (
        <div className="mt-1 text-xs text-slate-500" data-howto="rc-bugs">
          No bugs filed
        </div>
      ) : (
        <ul className="mt-1 grid gap-0.5 text-left text-xs" aria-label={`Bugs on ${c.label}`} data-testid="rc-column-bugs" data-howto="rc-bugs">
          {c.bugList.map((b) => (
            <li key={b.key} className="truncate" title={`${b.key} ${b.title}`}>
              {b.url ? (
                <a href={b.url} target="_blank" rel="noreferrer" className="font-medium text-accent-700 hover:underline">
                  {b.key}
                </a>
              ) : (
                <span className="font-medium text-slate-900">{b.key}</span>
              )}{" "}
              <span className="text-slate-700">{b.title}</span>
            </li>
          ))}
        </ul>
      )}
      {c.regressions && (
        <div className="mt-1 text-xs font-medium text-pink-700" title="Passed in the last release on this platform and still fails here">
          Regression: {c.regressions.count} ({c.regressions.keys.slice(0, 4).join(", ")}
          {c.regressions.keys.length > 4 ? ", …" : ""})
        </div>
      )}
      {auto && (
        <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-700">
          {c.automation ? (
            <a href={c.automation.href} className="hover:underline">
              {automationLine(c)}
            </a>
          ) : (
            <span className="text-slate-500">{automationLine(c)}</span>
          )}
        </div>
      )}
    </section>
  );
}

/** The block drawn as a picture, light on white whatever the app's theme, at twice size so it stays sharp. */
function drawImage(release: string, columns: RcColumn[], bugs: RcBug[], now: Date, spelling: Spelling, scale: SeverityScale) {
  const W = 960;
  const pad = 24;
  // Each card lists its bugs under the bar, one line each.
  const most = Math.max(1, ...columns.map((c) => c.bugList.length));
  const colH = 168 + most * 18 + (hasAutomation(columns) ? 18 : 0) + 14;
  const rowH = 28;
  const H = pad + 60 + colH + (bugs.length ? 40 + rowH * (bugs.length + 1) : 40) + 30;
  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;
  const g = canvas.getContext("2d")!;
  g.scale(2, 2);
  const font = (size: number, weight = 400) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const INK = "#0f172a";
  const MUTED = "#64748b";
  const LINE = "#e2e8f0";
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, H);
  const text = (s: string, x: number, y: number, size: number, opts: { weight?: number; color?: string; align?: CanvasTextAlign; max?: number } = {}) => {
    g.font = font(size, opts.weight);
    g.fillStyle = opts.color ?? INK;
    g.textAlign = opts.align ?? "left";
    let t = s;
    if (opts.max) while (t.length > 1 && g.measureText(t).width > opts.max) t = t.slice(0, -2) + "…";
    g.fillText(t, x, y);
  };
  const round = (x: number, y: number, w: number, h: number, r: number, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  };

  text(`${release.toUpperCase()} TESTING STATUS`, W / 2, pad + 20, 20, { weight: 600, align: "center" });
  text(asOfText(now, spelling), W / 2, pad + 42, 12, { color: MUTED, align: "center" });

  const top = pad + 60;
  const colW = (W - pad * 2) / columns.length;
  g.strokeStyle = LINE;
  g.lineWidth = 1;
  columns.forEach((c, i) => {
    const x = pad + i * colW;
    const mid = x + colW / 2;
    const inner = colW - 32;
    g.strokeRect(x + 0.5, top + 0.5, colW, colH);
    text(c.label, mid, top + 28, 16, { weight: 600, align: "center", max: inner });
    // The status sits on its own line right under the client name.
    // The release and build first, then the status (ver_182).
    text(buildLine(release, c), mid, top + 48, 12, { color: MUTED, align: "center", max: inner });
    const st = stateOf(c);
    g.font = font(10, 600);
    const cw = g.measureText(st.label).width + 12;
    round(mid - cw / 2, top + 58, cw, 17, 3, st.chip.fill);
    text(st.label, mid, top + 70, 10, { weight: 600, color: st.chip.text, align: "center" });
    text(`${percent(c)}%`, mid, top + 112, 32, { weight: 600, align: "center" });
    text(`${c.done} of ${c.total} cases run · +${ranToday(c, now)} today${runsText(c)}`, mid, top + 132, 12, { color: MUTED, align: "center", max: inner });
    const barX = x + 16;
    round(barX, top + 142, inner, 8, 4, LINE);
    let at = barX;
    for (const s of BAR) {
      const n = c.counts[s] ?? 0;
      if (!n) continue;
      const w = (n / Math.max(1, c.total)) * inner;
      g.fillStyle = barColor(s);
      g.fillRect(at, top + 142, Math.max(w - 2, 1), 8);
      at += w;
    }
    if (!c.bugList.length) text("No bugs filed", mid, top + 168, 12, { align: "center", color: MUTED, max: inner });
    c.bugList.forEach((b, k) => text(`${b.key}  ${b.title}`, x + 16, top + 168 + k * 18, 12, { max: inner }));
    if (hasAutomation(columns)) text(automationLine(c).replace("🤖 ", ""), mid, top + 168 + Math.max(1, c.bugList.length) * 18, 12, { align: "center", color: MUTED, max: inner });
  });

  let y = top + colH + 34;
  text("Critical and blocking bugs", pad, y, 14, { weight: 600 });
  if (!bugs.length) text("None so far.", pad + 190, y, 13, { color: MUTED });
  else {
    const cols = [
      { h: "Platform", x: pad, w: 110 },
      { h: "Bug", x: pad + 120, w: W - pad * 2 - 120 - 430 },
      { h: "Severity", x: W - pad - 420, w: 120 },
      { h: "Priority", x: W - pad - 290, w: 90 },
      { h: "Jira status", x: W - pad - 190, w: 120 },
      { h: "Cases", x: W - pad - 50, w: 50 },
    ];
    y += 24;
    cols.forEach((c) => text(c.h, c.x, y, 11, { color: MUTED, weight: 500 }));
    for (const b of bugs) {
      g.fillStyle = LINE;
      g.fillRect(pad, y + 8, W - pad * 2, 1);
      y += rowH;
      text(b.clients.join(", "), cols[0].x, y, 12, { max: cols[0].w });
      text(`${b.key}  ${b.title}`, cols[1].x, y, 12, { max: cols[1].w });
      const crit = severe(b, scale);
      text(scale.labels[b.severity], cols[2].x, y, 12, { weight: crit ? 600 : 400, color: crit ? "#B10202" : INK, max: cols[2].w });
      text(b.priority || "—", cols[3].x, y, 12, { max: cols[3].w });
      text(b.status, cols[4].x, y, 12, { max: cols[4].w });
      text(String(b.cases.length), cols[5].x, y, 12);
    }
  }
  text("Made with Flaw Patrol", W - pad, H - 12, 10, { color: MUTED, align: "right" });
  return canvas;
}

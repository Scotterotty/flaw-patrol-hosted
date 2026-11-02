"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cycleHash } from "@/lib/cycle-hash";
import { ARCHIVE_CYCLE_EVENT } from "./archive-project";
import { Button } from "./ui";
import { UmbrellaIcon } from "./umbrella-nav";

/** One cell in the Test cycles table: the umbrella's setting, its own, or nothing yet. */
export type CycleChip = { tone: "same" | "own" | "off"; text: string; tip: string };

export type CycleRow = {
  key: string;
  id: string;
  /** Archived test cycles can't be archived again; their panel has Restore instead. */
  archived: boolean;
  /** Without the umbrella's name in front ("OKO Web RC23" under OKO reads "Web RC23"). */
  name: string;
  fullName: string;
  color: string;
  older: boolean;
  team: CycleChip;
  jira: CycleChip;
  slack: CycleChip;
  /** What opens below the row: name, team, Jira and Slack for this test cycle. */
  panel: ReactNode;
};


function Chip({ chip }: { chip: CycleChip }) {
  const look = chip.tone === "same" ? "bg-accent-50 text-accent-700" : chip.tone === "own" ? "bg-orange-50 text-orange-700" : "bg-slate-100 text-slate-600";
  return (
    <span tabIndex={0} title={chip.tip} className={`inline-flex cursor-help items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${look}`}>
      {chip.tone === "same" && <UmbrellaIcon className="size-3" />}
      {chip.text}
    </span>
  );
}

/**
 * Umbrella Settings → Test cycles: one row per test cycle with its Team, Jira and Slack,
 * each marked Same as the umbrella or Its own. Change opens that test cycle's choices right below
 * the row, one row at a time. Test cycles under an umbrella have no settings page of their own.
 */
export function CycleSettingsTable({
  rows,
  umbrella,
  canArchive,
  addButton,
  canChange = true,
}: {
  rows: CycleRow[];
  umbrella: string;
  canArchive: boolean;
  addButton?: ReactNode;
  /** Viewers read View, not Change, like the rest of the page. */
  canChange?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const older = rows.filter((r) => r.older).length;

  // Open the row named in the address (#cycle-key), also when it changes.
  useEffect(() => {
    const check = () => {
      const h = window.location.hash.slice(1);
      const row = rows.find((r) => cycleHash(r.key) === h);
      if (!row) return;
      if (row.older) setShowOlder(true);
      setOpen(row.key);
      requestAnimationFrame(() => document.getElementById(`row-${cycleHash(row.key)}`)?.scrollIntoView({ block: "start" }));
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => r.key).join(" ")]);

  // Close the ⋯ menu on a click elsewhere or Escape.
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const toggle = (key: string, next = open !== key) => {
    const url = window.location.pathname + window.location.search;
    window.history.replaceState(window.history.state, "", next ? `${url}#${cycleHash(key)}` : url);
    setOpen(next ? key : null);
    setMenu(null);
    if (next) requestAnimationFrame(() => document.getElementById(`row-${cycleHash(key)}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  const shown = rows.filter((r) => !r.older || showOlder || open === r.key);
  return (
    <section id="test-cycles" className="scroll-mt-20 rounded-xl border border-slate-200 bg-surface" data-testid="cycle-settings">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold text-slate-900">Test cycles</h2>
        {addButton}
      </div>
      <p className="px-4 pt-3 text-sm text-slate-500">Every test cycle uses the settings above. Change one only if it needs to be different.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-[11px] tracking-wide text-slate-500 uppercase">
              <th className="px-4 py-2 font-semibold">Test cycle</th>
              <th className="px-4 py-2 font-semibold">Team</th>
              <th className="px-4 py-2 font-semibold">Jira</th>
              <th className="px-4 py-2 font-semibold">Slack</th>
              <th className="px-4 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          {shown.map((r) => {
            const isOpen = open === r.key;
            return (
              <tbody key={r.key} id={`row-${cycleHash(r.key)}`} className="scroll-mt-20 border-t border-slate-100">
                <tr className={isOpen ? "bg-accent-50" : ""}>
                  <td className="px-4 py-2">
                    <button type="button" onClick={() => toggle(r.key)} aria-expanded={isOpen} title={r.fullName} className={`inline-flex items-center gap-1.5 text-left font-medium hover:underline ${isOpen ? "text-accent-700" : "text-slate-900"}`}>
                      <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: r.color }} />
                      {r.name}
                    </button>
                    {r.archived && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Archived</span>}
                  </td>
                  <td className="px-4 py-2">
                    <Chip chip={r.team} />
                  </td>
                  <td className="px-4 py-2">
                    <Chip chip={r.jira} />
                  </td>
                  <td className="px-4 py-2">
                    <Chip chip={r.slack} />
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Button size="sm" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : canChange ? "Change" : "View"} ${r.name}`} onClick={() => toggle(r.key)}>
                      {isOpen ? "Hide" : canChange ? "Change" : "View"}
                    </Button>
                    <span className="relative ml-1 inline-block" ref={menu === r.key ? menuRef : undefined}>
                      <Button size="sm" aria-haspopup="menu" aria-expanded={menu === r.key} aria-label={`More for ${r.name}`} onClick={() => setMenu(menu === r.key ? null : r.key)}>
                        ⋯
                      </Button>
                      {menu === r.key && (
                        <div role="menu" className="absolute top-full right-0 z-30 mt-1 w-44 rounded-lg border border-slate-200 bg-surface p-1 text-left shadow-lg">
                          <button
                            type="button"
                            role="menuitem"
                            className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
                            onClick={() => {
                              toggle(r.key, true);
                              requestAnimationFrame(() => document.getElementById(`details-${cycleHash(r.key)}`)?.focus());
                            }}
                          >
                            Rename…
                          </button>
                          {canArchive && !r.archived && (
                            <button
                              type="button"
                              role="menuitem"
                              className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
                              onClick={() => {
                                setMenu(null);
                                window.dispatchEvent(new CustomEvent(ARCHIVE_CYCLE_EVENT, { detail: r.id }));
                              }}
                            >
                              Archive…
                            </button>
                          )}
                          {r.archived && (
                            <button type="button" role="menuitem" className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100" onClick={() => toggle(r.key, true)}>
                              Restore…
                            </button>
                          )}
                        </div>
                      )}
                    </span>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-accent-50">
                    <td colSpan={5} className="px-4 pt-1 pb-4">
                      <div className="space-y-4 rounded-lg border border-slate-200 bg-surface p-4">
                        <h3 className="text-sm font-semibold text-slate-900">
                          {r.name}: what&apos;s different from {umbrella}
                        </h3>
                        {r.panel}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
          {rows.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={5} className="px-4 py-3 text-slate-500">
                  No test cycles yet. Each one you add shows here with its team, Jira and Slack.
                </td>
              </tr>
            </tbody>
          )}
          {older > 0 && !showOlder && (
            <tbody>
              <tr className="border-t border-slate-100">
                <td colSpan={5} className="px-4 py-2">
                  <button type="button" onClick={() => setShowOlder(true)} className="text-sm font-medium text-accent-700 hover:underline">
                    Show {older} older
                  </button>
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
    </section>
  );
}

/** Sends an old test cycle settings address to its row in the umbrella's Settings (#roles still goes to Roles). */
export function CycleSettingsRedirect({ groupId, cycleKey }: { groupId: string; cycleKey: string }) {
  useEffect(() => {
    const h = window.location.hash.slice(1);
    window.location.replace(`/g/${groupId}/settings#${h === "roles" ? "roles" : cycleHash(cycleKey)}`);
  }, [groupId, cycleKey]);
  return null;
}

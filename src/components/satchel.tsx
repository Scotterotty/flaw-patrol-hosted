"use client";

import Link from "next/link";
import { useState } from "react";
import { FOE_OUTCOME_LABEL, RARITY_LABEL, type FoeOutcome, type Rarity } from "@/lib/quest";
import { RARITY_STYLE, RarityBadge } from "./rarity";
import { cx } from "./ui";

/** One item in the satchel; the same item found more than once stacks, linking the newest run. */
export type SatchelItem = { id: string; name: string; emoji: string; rarity: Rarity; count: number; runNumber: number; where: string };
/** One encounter in the log, newest first. */
export type LoggedEncounter = { key: string; name: string; emoji: string; rarity: Rarity; outcome: FoeOutcome; line: string; runNumber: number; where: string };

const LOG_LIMIT = 10;

const OUTCOME_STYLE: Record<FoeOutcome, string> = {
  defeated: "text-emerald-700",
  bug: "text-red-700",
  past: "text-slate-500",
};

const ITEM_LIMIT = 20;

/** "the Regression Wolf" reads as "Regression Wolf" in a list. */
const bare = (name: string) => {
  const s = name.replace(/^(a|an|the) /, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Your finds: items in one tab, encounters in the other, so only one list shows at a time. */
export function SatchelCard({ projectKey, items, encounters }: { projectKey: string; items: SatchelItem[]; encounters: LoggedEncounter[] }) {
  const [tab, setTab] = useState<"items" | "encounters">(items.length || !encounters.length ? "items" : "encounters");
  const [picked, setPicked] = useState(0);
  const [all, setAll] = useState(false);
  const [allItems, setAllItems] = useState(false);
  const item = items[Math.min(picked, items.length - 1)];
  const tally = (o: FoeOutcome) => encounters.filter((e) => e.outcome === o).length;
  const shown = all ? encounters : encounters.slice(0, LOG_LIMIT);

  return (
    <div className="mt-2">
      <div role="tablist" aria-label="Satchel" className="mb-3 flex gap-0.5 rounded-full p-0.5 ring-1 ring-slate-200 ring-inset">
        {(
          [
            ["items", `Items · ${items.reduce((n, i) => n + i.count, 0)}`],
            ["encounters", `Encounters · ${encounters.length}`],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`satchel-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`satchel-panel-${t}`}
            onClick={() => setTab(t)}
            className={cx("flex-1 rounded-full px-1.5 py-1 text-xs whitespace-nowrap", tab === t ? "bg-slate-200 font-semibold text-slate-900" : "text-slate-500 hover:text-slate-800")}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="-mt-1.5 mb-2 text-right text-xs">
        <a href="/account#game-titles" className="text-accent-700 hover:underline">
          🎖 Change title
        </a>
      </p>

      {tab === "items" ? (
        <div role="tabpanel" id="satchel-panel-items" aria-labelledby="satchel-tab-items">
          {items.length === 0 ? (
            <p className="text-xs text-slate-500">No items yet. Land the pawn on one by saving a case, or rescue a teammate.</p>
          ) : (
            <>
              <ul className="grid grid-cols-5 gap-2">
                {(allItems ? items : items.slice(0, ITEM_LIMIT)).map((it, i) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(i)}
                      aria-pressed={item === it}
                      aria-label={`${it.name}${it.count > 1 ? ` ×${it.count}` : ""}`}
                      title={it.name}
                      className={cx(
                        "relative flex aspect-square w-full items-center justify-center rounded-lg bg-slate-100 text-xl ring-2 ring-inset hover:bg-accent-100",
                        RARITY_STYLE[it.rarity].ring,
                        item === it && "outline-2 outline-offset-1 outline-accent-500",
                      )}
                    >
                      <span aria-hidden>{it.emoji}</span>
                      {it.count > 1 && (
                        <span className="absolute -right-1.5 -bottom-1.5 rounded-full bg-slate-700 px-1 text-[11px] leading-4 font-semibold text-slate-50 tabular-nums" aria-hidden>
                          {it.count}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {items.length > ITEM_LIMIT && (
                <button type="button" onClick={() => setAllItems(!allItems)} className="mt-2 text-xs text-accent-700 hover:underline">
                  {allItems ? "Show fewer" : `Show all ${items.length}`}
                </button>
              )}
              {item && (
                <div className="mt-3 border-t border-slate-100 pt-2.5 text-sm" aria-live="polite">
                  <p className="text-slate-800">
                    {item.name}
                    {item.count > 1 && <span className="text-slate-500 tabular-nums"> ×{item.count}</span>}
                  </p>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <RarityBadge rarity={item.rarity} />
                    <Link href={`/p/${projectKey}/quests/${item.runNumber}`} className="text-xs text-slate-500 hover:underline">
                      {item.count > 1 && "Latest: "}
                      {item.where}
                    </Link>
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div role="tabpanel" id="satchel-panel-encounters" aria-labelledby="satchel-tab-encounters">
          {encounters.length === 0 ? (
            <p className="text-xs text-slate-500">No encounters yet. Creatures wait along each road too.</p>
          ) : (
            <>
              <p className="mb-1 text-xs text-slate-600">
                <span className={OUTCOME_STYLE.defeated}>{tally("defeated")} defeated</span> · <span className={OUTCOME_STYLE.bug}>{tally("bug")} found a bug</span> ·{" "}
                {tally("past")} slipped past
              </p>
              <ul aria-label="Encounter log" className="divide-y divide-slate-100">
                {shown.map((e) => (
                  <li key={e.key}>
                    <Link href={`/p/${projectKey}/quests/${e.runNumber}`} className="-mx-1 flex items-center gap-2.5 rounded px-1 py-1.5 hover:bg-slate-50">
                      <span className="w-6 text-center text-xl leading-none" aria-hidden>
                        {e.emoji}
                      </span>
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block text-slate-800">{e.line || bare(e.name)}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {RARITY_LABEL[e.rarity]} · {e.where}
                        </span>
                      </span>
                      <span className={cx("shrink-0 text-xs font-semibold", OUTCOME_STYLE[e.outcome])}>{FOE_OUTCOME_LABEL[e.outcome]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {encounters.length > LOG_LIMIT && (
                <button type="button" onClick={() => setAll(!all)} className="mt-1 text-xs text-accent-700 hover:underline">
                  {all ? "Show fewer" : `Show all ${encounters.length}`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

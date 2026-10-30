"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { setQuestMap, setSeasonalMaps, updateMyGame } from "@/server/account";
import { Avatar, type AvatarPerson } from "./avatar";
import type { UnlockDetail } from "@/lib/game";
import { Button, cx, ErrorText } from "./ui";
import { FoldHeader } from "./fold-card";
import { OpenAllButton, useOpenCard } from "./open-cards";
import { wearCrown } from "@/server/account";

export type GameOption = UnlockDetail & { id: string; label: string };

type Progress = {
  xp: number;
  level: number;
  from: number;
  to: number;
  currentStreak: number;
  breakdown: {
    key: string;
    label: string;
    hint: string;
    each: number;
    count: number;
  }[];
  titles: GameOption[];
  frames: GameOption[];
  crowns?: CrownOption[];
};

/** A crown in one of your umbrellas (ver_96), with the number to beat. */
export type CrownOption = {
  id: string;
  label: string;
  umbrella: string;
  mine: boolean;
  holder: string | null;
  since: string;
  you: number;
  top: number;
  nextBest: number;
  unit: [string, string];
  need: number;
  toTake: number;
  verb: string;
};

const SECTIONS = ["game:xp", "game:titles", "game:frames"];

const option = (selected: boolean, unlocked: boolean) =>
  cx(
    "grid min-w-0 content-start gap-1 rounded-lg border px-3 py-2.5 text-xs",
    selected ? "border-accent-600 bg-accent-50 ring-1 ring-accent-600" : "border-slate-200",
    unlocked ? "cursor-pointer hover:border-slate-300" : "cursor-default",
  );

/** Earned / Locked tag on a title or frame. */
function UnlockChip({ unlocked }: { unlocked: boolean }) {
  return (
    <span
      className={cx(
        "shrink-0 self-start rounded-full px-1.5 py-px text-[11px] font-semibold whitespace-nowrap",
        unlocked ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
      )}
    >
      {unlocked ? "✓ Earned" : "🔒 Locked"}
    </span>
  );
}

/** The rule an unlock met (or needs), plus a progress bar while it's locked. */
function UnlockHow({ o }: { o: GameOption }) {
  const unit = o.kind === "xp" ? " XP" : "";
  const n = (v: number) => v.toLocaleString("en-US");
  return (
    <>
      <span className={o.unlocked ? "text-slate-700" : "text-slate-500"}>{o.how}</span>
      {!o.unlocked && (
        <span className="flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
            <span className="block h-full rounded-full bg-slate-400" style={{ width: `${Math.min(100, (o.have / Math.max(1, o.need)) * 100)}%` }} />
          </span>
          <span className="text-[11px] text-slate-500 tabular-nums">
            {n(Math.min(o.have, o.need))} / {n(o.need)}
            {unit}
          </span>
        </span>
      )}
    </>
  );
}

/** Under the list: what you're wearing, how you earned it and exactly what counts. */
function UnlockDetailBox({ o, what }: { o: GameOption; what: string }) {
  const how = o.kind === "xp" ? (o.need === 0 ? "Every player starts with this title." : `You ${o.how.replace(/^Reached/, "reached")}.`) : `${o.how}.`;
  return (
    <div aria-live="polite" className="mt-2 space-y-1 rounded-lg border border-dashed border-accent-500 bg-slate-50 px-3.5 py-3 text-xs">
      <p className="text-sm font-semibold text-slate-900">
        {o.label} · wearing this {what}
      </p>
      <p className="text-slate-700">
        <span className="font-semibold">How you earned it:</span> {how}
      </p>
      {o.counts.length > 0 && (
        <>
          <p className="text-slate-700">What counts:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-slate-500">
            {o.counts.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const NO_TITLE: GameOption = { id: "", label: "No title", unlocked: true, how: "Just your name", kind: "xp", have: 0, need: 0, counts: [] };
const NO_FRAME: GameOption = { id: "", label: "No frame", unlocked: true, how: "", kind: "xp", have: 0, need: 0, counts: [] };
const worn = (list: GameOption[], id: string | null) => list.find((o) => o.id === id && o.unlocked);

/** Shh. Five quick clicks on "leaderboard" opens the leaderboard that doesn't exist. */
function SecretWord() {
  const router = useRouter();
  const clicks = useRef<number[]>([]);
  return (
    <span
      onClick={() => {
        const now = Date.now();
        clicks.current = [...clicks.current.filter((t) => now - t < 3000), now];
        if (clicks.current.length >= 5) router.push("/leaderboard");
      }}
    >
      leaderboard
    </span>
  );
}

export function GamePanel({
  enabled,
  person,
  title,
  frame,
  progress,
  questMap = false,
  seasonalMaps = true,
  pawnHref,
}: {
  questMap?: boolean;
  /** Seasonal scenery on quest maps (ver_98). */
  seasonalMaps?: boolean;
  /** Where the pawn's gear is picked: the Quest map of your latest project. */
  pawnHref?: string | null;
  enabled: boolean;
  person: AvatarPerson;
  title: string | null;
  frame: string | null;
  progress?: Progress;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [pick, setPick] = useState({ title, frame });
  const [on, setOn] = useState(enabled);
  const [quests, setQuests] = useState(questMap);
  const [seasonal, setSeasonal] = useState(seasonalMaps);
  // The title worn for you when you join, so you can undo it or pick another.
  const [autoTitle, setAutoTitle] = useState<string | null>(null);
  // "Pick another" opens the Titles section.
  const [openTitles, setOpenTitles] = useState(false);
  // Titles unlocked since you last looked, so you can wear one in a click. Remembered in this browser.
  const [fresh, setFresh] = useState<GameOption[]>([]);
  useEffect(() => {
    if (!progress) return;
    const unlocked = progress.titles.filter((t) => t.unlocked && t.id);
    try {
      const raw = localStorage.getItem("fp-seen-titles");
      const seen = new Set<string>(raw ? JSON.parse(raw) : unlocked.map((t) => t.id));
      setFresh(unlocked.filter((t) => !seen.has(t.id) && t.id !== title));
      localStorage.setItem("fp-seen-titles", JSON.stringify([...new Set([...seen, ...unlocked.map((t) => t.id)])]));
    } catch {}
  }, [progress, title]);

  const save = (next: { enabled: boolean; title: string | null; frame: string | null }) => {
    setPick({ title: next.title, frame: next.frame });
    setOn(next.enabled);
    start(async () => {
      const res = await updateMyGame(next);
      setError(res.ok ? null : res.error);
      if (res.ok && res.autoTitle) {
        setAutoTitle(res.autoTitle);
        setPick({ title: "rookie", frame: next.frame });
      }
      router.refresh();
    });
  };

  const best = progress && [...progress.breakdown].sort((a, b) => b.count * b.each - a.count * a.each)[0];
  const earnedTitles = progress ? progress.titles.filter((t) => t.unlocked).length : 0;
  const held = progress?.crowns?.filter((c) => c.mine) ?? [];
  return (
    <div className="space-y-5 text-sm">
      {on && progress && (
        <div className="-mt-2 flex justify-end">
          <OpenAllButton ids={SECTIONS} className="text-xs text-accent-700 hover:underline" />
        </div>
      )}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={on}
            disabled={pending}
            onChange={(e) =>
              save({
                enabled: e.target.checked,
                title: pick.title,
                frame: pick.frame,
              })
            }
            aria-describedby="game-about"
            className="mt-1 size-4 accent-accent-600"
          />
          <span className="text-slate-800">Play the mini game</span>
        </label>
        <p id="game-about" className="mt-0.5 ml-7 text-xs text-slate-500">
          Earn XP for useful testing work, level up, and unlock titles and picture frames that show next to your name. Your past work counts. There&apos;s no{" "}
          <SecretWord />.
        </p>
      </div>

      {autoTitle && on && (
        <p role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-accent-100 bg-accent-50 px-3 py-2 text-sm text-slate-800">
          <span className="flex-1">
            🎖 You earned <strong>{autoTitle}</strong>. It now shows next to your name.
          </span>
          <button type="button" className="text-accent-700 hover:underline" onClick={() => (setAutoTitle(null), save({ enabled: true, title: null, frame: pick.frame }))}>
            Undo
          </button>
          <a href="#game-titles" className="text-accent-700 hover:underline" onClick={() => (setAutoTitle(null), setOpenTitles(true))}>
            Pick another
          </a>
        </p>
      )}
      {on &&
        fresh.map((t) => (
          <p key={t.id} role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-accent-100 bg-accent-50 px-3 py-2 text-sm text-slate-800">
            <span className="flex-1">
              🎖 New title unlocked: <strong>{t.label}</strong>
            </span>
            <Button size="sm" variant="primary" onClick={() => (setFresh((f) => f.filter((x) => x.id !== t.id)), save({ enabled: true, title: t.id, frame: pick.frame }))}>
              Wear it
            </Button>
            <button type="button" aria-label="Dismiss" className="px-1 text-slate-400 hover:text-slate-700" onClick={() => setFresh((f) => f.filter((x) => x.id !== t.id))}>
              ×
            </button>
          </p>
        ))}

      {on && progress && (
        <>
          <div className="flex items-center gap-4">
            <Avatar person={{ ...person, frame: pick.frame }} size={56} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-heading text-lg text-slate-900">Level {progress.level}</span>
                {pawnHref && (
                  <a href={pawnHref} className="text-sm text-accent-700 hover:underline">
                    ♟ Dress your pawn
                  </a>
                )}
              </p>
              <div
                className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200"
                role="progressbar"
                aria-label="Progress to next level"
                aria-valuemin={progress.from}
                aria-valuemax={progress.to}
                aria-valuenow={progress.xp}
              >
                <div
                  className="h-full rounded-full bg-accent-600"
                  style={{
                    width: `${((progress.xp - progress.from) / (progress.to - progress.from)) * 100}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {progress.xp} XP · {progress.to - progress.xp} XP to level {progress.level + 1}
                {progress.currentStreak > 1 && ` · ${progress.currentStreak}-day streak`}
              </p>
            </div>
          </div>

          <div>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={quests}
                disabled={pending}
                onChange={(e) => {
                  const next = e.target.checked;
                  setQuests(next);
                  start(async () => {
                    const r = await setQuestMap(next);
                    if (!r.ok) {
                      setQuests(!next);
                      setError(r.error);
                    } else router.refresh();
                  });
                }}
                aria-describedby="quest-about"
                className="mt-1 size-4 accent-accent-600"
              />
              <span className="text-slate-800">Show quest maps</span>
            </label>
            <p id="quest-about" className="mt-0.5 ml-7 text-xs text-slate-500">
              Every test run becomes a quest with its own map. Each case that gets a result moves the team&apos;s pawn a step, and whoever lands it on an
              encounter or item gets it. Adds Quest map to each test cycle&apos;s menu.
            </p>
            {quests && (
              <div className="mt-3 ml-7">
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={seasonal}
                    disabled={pending}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setSeasonal(next);
                      start(async () => {
                        const r = await setSeasonalMaps(next);
                        if (!r.ok) {
                          setSeasonal(!next);
                          setError(r.error);
                        } else router.refresh();
                      });
                    }}
                    aria-describedby="seasonal-about"
                    className="mt-1 size-4 accent-accent-600"
                  />
                  <span className="text-slate-800">Seasonal maps</span>
                </label>
                <p id="seasonal-about" className="mt-0.5 ml-7 text-xs text-slate-500">
                  Dress quest maps up for Halloween, winter and other seasons. Each map keeps the look of the day its run started. Off shows the plain green
                  map all year.
                </p>
              </div>
            )}
          </div>

          <div className="divide-y divide-slate-100 border-y border-slate-100">
          <Section
            id="game:xp"
            title="How you earned XP"
            summary={`${progress.xp} XP in all${best ? ` · most from ${best.label.toLowerCase()}` : ""}`}
            pill={`${progress.breakdown.length} kinds`}
          >
            <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-1 font-medium">How you earned it</th>
                <th className="pb-1 pl-4 text-right font-medium">Count</th>
                <th className="pb-1 pl-4 text-right font-medium">XP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {progress.breakdown.map((b) => (
                <tr key={b.key}>
                  <td className="py-1.5">
                    <span className="text-slate-800">{b.label}</span>
                    <span className="block text-slate-500">
                      {b.each} XP for {b.hint}
                    </span>
                  </td>
                  <td className="py-1.5 pl-4 text-right text-slate-700 tabular-nums">{b.count}</td>
                  <td className="py-1.5 pl-4 text-right text-slate-900 tabular-nums">{b.count * b.each}</td>
                </tr>
              ))}
            </tbody>
          </table>

          </Section>

          <Section
            id="game:titles"
            title="Title next to your name"
            summary={`Wearing ${pick.title?.startsWith("crown|") ? pick.title.split("|")[3] : (worn(progress.titles, pick.title)?.label ?? "no title")} · ${earnedTitles} of ${progress.titles.length} earned${held.length ? ` · ${held.length} ${held.length === 1 ? "crown" : "crowns"} held` : ""}`}
            pill={fresh.length ? <span className="rounded-full bg-accent-600 px-1.5 text-[11px] font-semibold text-white">New</span> : `${earnedTitles} / ${progress.titles.length}`}
            forceOpen={fresh.length > 0 || openTitles}
          >
          {progress.crowns && progress.crowns.length > 0 && <Crowns crowns={progress.crowns} worn={pick.title} onWear={(id) => setPick((p) => ({ ...p, title: id }))} />}
          <fieldset id="game-titles" className="scroll-mt-28">
            <legend className="mb-2 text-xs font-semibold text-slate-800">{progress.crowns?.length ? "Earned titles · yours for good" : "Titles"}</legend>
            {(
              [
                ["xp", "Earned with XP", "Level up by earning XP from any testing work"],
                ["work", "Earned by doing the work", "Unlock by reaching a count, whatever your level"],
              ] as const
            ).map(([kind, heading, sub]) => (
              <div key={kind} className="mb-3">
                <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="font-semibold text-slate-800">{heading}</span>
                  <span className="text-slate-500">{sub}</span>
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[...(kind === "xp" ? [NO_TITLE] : []), ...progress.titles.filter((t) => t.kind === kind)].map((t) => (
                    <label key={t.id} className={option((pick.title ?? "") === t.id, t.unlocked)}>
                      <input
                        type="radio"
                        name="game-title"
                        value={t.id}
                        disabled={!t.unlocked || pending}
                        checked={(pick.title ?? "") === t.id}
                        onChange={() =>
                          save({
                            enabled: true,
                            title: t.id || null,
                            frame: pick.frame,
                          })
                        }
                        className="sr-only"
                      />
                      <span className="flex justify-between gap-1.5">
                        <span className={cx("text-sm font-semibold", t.unlocked ? "text-slate-900" : "text-slate-500")}>{t.label}</span>
                        {t.id && <UnlockChip unlocked={t.unlocked} />}
                      </span>
                      <UnlockHow o={t} />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {worn(progress.titles, pick.title) && <UnlockDetailBox o={worn(progress.titles, pick.title)!} what="title" />}
          </fieldset>
          </Section>

          <Section
            id="game:frames"
            title="Picture frame"
            summary={
              <span className="inline-flex items-center gap-1.5">
                <Avatar person={{ ...person, frame: pick.frame }} size={18} />
                Wearing {worn(progress.frames, pick.frame)?.label ?? "no frame"} · {progress.frames.filter((f) => f.unlocked).length} of {progress.frames.length} earned
              </span>
            }
            pill={`${progress.frames.filter((f) => f.unlocked).length} / ${progress.frames.length}`}
          >
          <fieldset>
            <legend className="sr-only">Picture frame</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[NO_FRAME, ...progress.frames].map((f) => (
                <label key={f.id} className={cx(option((pick.frame ?? "") === f.id, f.unlocked), "grid-cols-[auto_1fr] items-start gap-x-2.5")}>
                  <input
                    type="radio"
                    name="game-frame"
                    value={f.id}
                    disabled={!f.unlocked || pending}
                    checked={(pick.frame ?? "") === f.id}
                    onChange={() =>
                      save({
                        enabled: true,
                        title: pick.title,
                        frame: f.id || null,
                      })
                    }
                    className="sr-only"
                  />
                  <span className={f.unlocked ? undefined : "opacity-60"}>
                    <Avatar person={{ ...person, frame: f.id || null }} size={32} />
                  </span>
                  <span className="grid min-w-0 gap-1">
                    <span className="flex justify-between gap-1.5">
                      <span className={cx("text-sm font-semibold", f.unlocked ? "text-slate-900" : "text-slate-500")}>{f.label}</span>
                      {f.id && <UnlockChip unlocked={f.unlocked} />}
                    </span>
                    {f.id && <UnlockHow o={f} />}
                  </span>
                </label>
              ))}
            </div>
            {worn(progress.frames, pick.frame) && <UnlockDetailBox o={worn(progress.frames, pick.frame)!} what="frame" />}
          </fieldset>
          </Section>
          </div>
        </>
      )}
    </div>
  );
}

/** One folding section of the Mini game card (ver_96); open state saved on your account. */
function Section({ id, title, summary, pill, forceOpen = false, children }: { id: string; title: string; summary: ReactNode; pill: ReactNode; forceOpen?: boolean; children: ReactNode }) {
  const { open, toggle, set } = useOpenCard(id);
  // A new unlock opens its section by itself.
  useEffect(() => {
    if (forceOpen) set(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceOpen]);
  return (
    <section>
      <FoldHeader
        title={title}
        summary={summary}
        open={open}
        onToggle={toggle}
        pill={typeof pill === "string" ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 tabular-nums">{pill}</span> : pill}
      />
      {open && <div className="pt-1 pb-4">{children}</div>}
    </section>
  );
}

const plural = (n: number, unit: [string, string]) => `${n} ${n === 1 ? unit[0] : unit[1]}`;

/**
 * Crowns (ver_96): the ones you hold, the three you're closest to (only you vs the holder,
 * never a ranking), and a small list of every crown and who holds it.
 */
function Crowns({ crowns, worn: wearing, onWear }: { crowns: CrownOption[]; worn: string | null; onWear: (id: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const mine = crowns.filter((c) => c.mine);
  const close = crowns
    .filter((c) => !c.mine)
    .sort((a, b) => a.toTake - b.toTake || a.label.localeCompare(b.label))
    .slice(0, 3);
  const umbrellas = [...new Set(crowns.map((c) => c.umbrella))];
  const day = (iso: string) => {
    const d = new Date(iso);
    return d.toDateString() === new Date().toDateString() ? "today" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  return (
    <div className="mb-4 space-y-3" data-testid="crowns">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div>
        <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-semibold text-slate-800">👑 Crowns you hold</span>
          <span className="text-slate-500">Kept while you&apos;re still doing the most in the last 30 days.</span>
        </p>
        {mine.length ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {mine.map((c) => (
              <div key={c.id} className={option(wearing === c.id, true)}>
                <span className="flex justify-between gap-1.5">
                  <span className="text-sm font-semibold text-slate-900">👑 {c.label}</span>
                  <span className="rounded-full bg-amber-100 px-1.5 py-px text-[11px] font-semibold text-amber-800">{c.umbrella}</span>
                </span>
                <span className="text-slate-700">
                  You: {plural(c.you, c.unit)} · next best: {c.nextBest}
                </span>
                <span className="flex items-center justify-between gap-2 text-slate-500">
                  Held since {day(c.since)}
                  {wearing === c.id ? (
                    <span className="font-semibold text-accent-700">Wearing it</span>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      className="font-semibold text-accent-700 hover:underline"
                      onClick={() =>
                        start(async () => {
                          const r = await wearCrown(c.id);
                          if (!r.ok) return setError(r.error);
                          onWear(c.id);
                          router.refresh();
                        })
                      }
                    >
                      Wear it
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">None yet. Do the most of something in an umbrella to take its crown.</p>
        )}
      </div>
      {close.length > 0 && (
        <div>
          <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="font-semibold text-slate-800">Crowns you could take</span>
            <span className="text-slate-500">The {close.length} you&apos;re closest to. You see the number to beat, never a ranking.</span>
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {close.map((c) => (
              <div key={c.id} className={option(false, false)}>
                <span className="flex justify-between gap-1.5">
                  <span className="text-sm font-semibold text-slate-900">{c.label}</span>
                  <span className="text-[11px] text-slate-500">{c.umbrella}</span>
                </span>
                <span className="flex items-center gap-2 text-slate-700 tabular-nums">
                  You {c.you} <span className="text-slate-400">·</span> {c.holder ? `${c.holder.split(/[ @]/)[0]} ${c.top}` : "Nobody yet"}
                </span>
                <span className="text-slate-500">
                  {c.holder ? `${c.toTake} more ${c.verb} to take it` : `${c.toTake} more ${c.verb} to claim it`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <button type="button" aria-expanded={all} className="text-xs text-accent-700 hover:underline" onClick={() => setAll((a) => !a)}>
        {all ? "Hide the crown list" : `See every crown in ${umbrellas.length === 1 ? umbrellas[0] : "your umbrellas"}`}
      </button>
      {all && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs" data-testid="crown-list">
          {crowns.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-slate-800">
                👑 {c.label}
                {umbrellas.length > 1 && <span className="text-slate-500"> · {c.umbrella}</span>}
              </span>
              <span className="text-slate-600">{c.holder ?? "Nobody yet"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

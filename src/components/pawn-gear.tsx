"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { GearSnapshot, Rarity } from "@/lib/quest";
import { PAWN_COLORS, pawnFill, PAWNS, pawnOf, SLOT_LABEL, SLOTS, type Slot } from "@/lib/quest-gear";
import { setQuestGear, setQuestPawn } from "@/server/account";
import { AvatarUpload } from "./avatar-upload";
import { Modal } from "./modal";
import { PawnFace } from "./pawn-face";
import { useSpell } from "./spelling";
import { RARITY_STYLE, RarityBadge } from "./rarity";
import { Button, cx, ErrorText } from "./ui";

export type OwnedItem = { id: string; name: string; emoji: string; rarity: Rarity; count: number; fits: Slot[] };
export type GearProps = {
  worn: GearSnapshot;
  /** Slots the game filled itself with a first find. */
  auto: Slot[];
  /** Only while the satchel is empty: the closest item still on a road. */
  nearest: { line: string | null; href: string | null; anyRuns: boolean } | null;
  owned: OwnedItem[];
  pawn: string;
  color: string;
  /** Your profile picture, for the "My picture" pawn. */
  photo: string | null;
  /** Pawn ids you may pick. */
  unlocked: string[];
  teamwork: number;
  me: { name: string; userId: string };
};

// Slot buttons sit on one ring 60px from the pawn's center (85,85), at the same angles as the map badges.
const SLOT_POS: Record<Slot, { left: number; top: number }> = {
  head: { left: 65, top: 5 },
  hand: { left: 125, top: 65 },
  offhand: { left: 5, top: 65 },
  charm: { left: 95, top: 117 },
  companion: { left: 35, top: 117 },
};

// What goes in each slot, for a tap on an empty one.
const SLOT_HINT: Record<Slot, string> = {
  head: "Hats, crowns, feathers and glowing mushrooms go here.",
  hand: "Pencils, lenses, daggers and lanterns go here.",
  offhand: "Shields, maps, scrolls and bookmarks go here.",
  charm: "Small things like keys, bells, clovers and coffee go here.",
  companion: "Rubber ducks, unicorns, satellites and comets go here.",
};

/** The Change gear panel of the Your pawn card (ver_94; was the satchel's Gear tab): wear your finds on your quest pawn, and choose the pawn. Looks only. */
export function PawnGear({ worn, auto, nearest, owned, pawn, color, photo, unlocked, teamwork, me }: GearProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gear, setGear] = useState(worn);
  const [autoSlots, setAutoSlots] = useState(auto);
  const [filter, setFilter] = useState<Slot | null>(null);
  const [picked, setPicked] = useState<string | null>(worn.hand ?? owned[0]?.id ?? null);
  const [picking, setPicking] = useState(false);
  const byId = (id: string | undefined) => owned.find((i) => i.id === id);
  const item = byId(picked ?? undefined);
  const wornIn = item && (Object.keys(gear) as Slot[]).find((s) => gear[s] === item.id);
  const target = item && (filter && item.fits.includes(filter) ? filter : item.fits[0]);

  const wear = (slot: Slot, id: string | null) => {
    const before = gear;
    const next = { ...gear };
    for (const s of Object.keys(next) as Slot[]) if (id && next[s] === id) delete next[s];
    if (id) next[slot] = id;
    else delete next[slot];
    setGear(next);
    setAutoSlots((a) => a.filter((s) => s !== slot && next[s] === gear[s]));
    start(async () => {
      const r = await setQuestGear(slot, id);
      if (!r.ok) {
        setGear(before);
        setError(r.error);
      } else {
        setError(null);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-3">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div className="space-y-2">
        <div className="relative mx-auto h-40 w-[170px]">
          <button
            type="button"
            onClick={() => setPicking(true)}
            title="Change pawn"
            aria-label={`Your pawn: ${pawnOf(pawn).label}. Change pawn`}
            className="absolute top-[45px] left-[45px] grid size-20 place-items-center overflow-hidden rounded-full border-4 border-surface text-[44px] ring-1 ring-slate-200 hover:ring-2 hover:ring-accent-500"
            style={{ background: pawnFill(color) }}
          >
            <PawnFace pawn={pawn} photo={photo} />
          </button>
          {SLOTS.map((s) => {
            const it = byId(gear[s.id]);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setFilter(filter === s.id ? null : s.id)}
                aria-pressed={filter === s.id}
                aria-label={`${s.label}: ${it ? it.name : "empty"}`}
                title={s.label}
                className={cx(
                  "absolute grid size-10 place-items-center rounded-full text-xl",
                  it ? cx("bg-surface ring-2", RARITY_STYLE[it.rarity].ring) : "border-2 border-dashed border-slate-300 bg-slate-50 text-slate-400",
                  filter === s.id && "outline-2 outline-offset-2 outline-accent-500",
                )}
                style={SLOT_POS[s.id]}
              >
                {it ? it.emoji : "＋"}
              </button>
            );
          })}
        </div>
        {filter && !gear[filter] && !owned.some((i) => i.fits.includes(filter)) && (
          <p className="rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600" aria-live="polite">
            {owned.length ? `None of your items fit ${SLOT_LABEL[filter]} yet.` : `Nothing for ${SLOT_LABEL[filter]} yet.`} {SLOT_HINT[filter]}
          </p>
        )}
        {owned.length > 0 && (
          <div className="space-y-1 text-xs">
            {SLOTS.map((s) => (
              <div key={s.id} className="flex justify-between gap-2 border-b border-slate-100 pb-0.5">
                <span className="text-slate-500">{s.label}</span>
                <span className="min-w-0 text-right text-slate-800">
                  {byId(gear[s.id])?.name ?? "Empty"}
                  {gear[s.id] && autoSlots.includes(s.id) && (
                    <span className="ml-1.5 rounded bg-accent-50 px-1 text-[11px] font-semibold text-accent-700" title="Went on by itself because the slot was empty">
                      Auto
                    </span>
                  )}
                </span>
              </div>
            ))}
            {autoSlots.some((s) => gear[s]) && <p className="pt-0.5 text-slate-500">Auto items went on because the slot was empty. Take one off and that slot stays the way you leave it.</p>}
          </div>
        )}
        <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
          Change pawn
        </Button>
      </div>

      {owned.length === 0 ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <p className="text-sm font-semibold text-slate-900">🎒 Nothing to wear yet</p>
          <p className="text-slate-500">Gear comes from quest maps. Here is how to get some:</p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>Test cases in any run. Each result you save moves the pawn one step.</li>
            <li>Land the pawn on an item and it&apos;s yours. About one step in eight has one.</li>
            <li>See a teammate marked 🤢 Needs help? Save the next case in that run to rescue them and get a thank-you item.</li>
          </ol>
          <p className="text-slate-500">Your first item of each kind goes straight onto an empty slot, so you see it right away.</p>
          {nearest &&
            (nearest.line ? (
              <p className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
                <span>
                  Nearest item: <strong className="font-medium text-slate-900">{nearest.line}</strong>
                </span>
                {nearest.href && (
                  <Link href={nearest.href} className="font-medium text-accent-700 hover:underline">
                    Go to that quest
                  </Link>
                )}
              </p>
            ) : (
              <p className="border-t border-slate-200 pt-2 text-slate-500">
                {nearest.anyRuns ? "No items left ahead on today's quests. New runs bring new ones." : "No quests on the road. Items show up once a test run starts."}
              </p>
            ))}
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-500">{filter ? `Showing what fits ${SLOT_LABEL[filter]}. Tap the slot again to show everything.` : "Tap an item to wear it. Tap a slot to see only what fits there."}</p>
          <ul className="grid grid-cols-6 gap-2">
            {owned.map((it) => {
              const on = Object.values(gear).includes(it.id);
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(it.id)}
                    aria-pressed={picked === it.id}
                    aria-label={`${it.name}${on ? ", worn" : ""}`}
                    title={it.name}
                    className={cx(
                      "relative flex aspect-square w-full items-center justify-center rounded-lg bg-slate-100 text-xl ring-2 ring-inset hover:bg-accent-100",
                      RARITY_STYLE[it.rarity].ring,
                      picked === it.id && "outline-2 outline-offset-1 outline-accent-500",
                      filter && !it.fits.includes(filter) && "opacity-35",
                    )}
                  >
                    <span aria-hidden>{it.emoji}</span>
                    {on && (
                      <span aria-hidden className="absolute -right-1.5 -bottom-1.5 grid size-[18px] place-items-center rounded-full bg-accent-600 text-[11px] font-bold text-white">
                        ✓
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {item && (
            <div className="space-y-1.5 border-t border-slate-100 pt-2.5 text-sm" aria-live="polite">
              <p className="flex flex-wrap items-center gap-2 text-slate-800">
                {item.name} <RarityBadge rarity={item.rarity} />
              </p>
              <p className="text-xs text-slate-500">
                Fits: {item.fits.map((s) => SLOT_LABEL[s]).join(", ")}
                {wornIn && ` · Wearing as ${SLOT_LABEL[wornIn]}`}
              </p>
              {wornIn ? (
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => wear(wornIn, null)}>
                  Take off
                </Button>
              ) : (
                <Button size="sm" variant="primary" disabled={pending} onClick={() => wear(target!, item.id)}>
                  Wear as {SLOT_LABEL[target!]}
                </Button>
              )}
            </div>
          )}
        </>
      )}
      <p className="text-xs text-slate-500">
        {owned.length
          ? "Gear is just for looks: it shows on every quest map and gets named in your encounter lines. It never changes your odds or XP."
          : "Gear is just for looks. It never changes your odds or XP. Bigger runs turn up rarer finds."}
        {teamwork > 0 && ` 🤝 Teamwork marks: ${teamwork}.`}
      </p>
      <PawnPicker open={picking} onClose={() => setPicking(false)} pawn={pawn} color={color} unlocked={unlocked} photo={photo} me={me} />
    </div>
  );
}

/** Choose your pawn and its color. Most are free; a few unlock from the quests themselves. */
export function PawnPicker({
  open,
  onClose,
  pawn,
  color,
  unlocked,
  photo,
  me,
}: {
  open: boolean;
  onClose: () => void;
  pawn: string;
  color: string;
  unlocked: string[];
  photo: string | null;
  me: { name: string; userId: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState({ pawn, color });
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sp = useSpell();
  const [adding, setAdding] = useState(false);
  // The picture just went up: pick it as the pawn.
  useEffect(() => {
    if (adding && photo) {
      setAdding(false);
      setPick((p) => ({ ...p, pawn: "photo" }));
    }
  }, [adding, photo]);
  return (
    <Modal open={open} onClose={onClose} title="Choose your pawn" wide>
      <p className="text-sm text-slate-500">Most pawns are free to pick. A few unlock from the quest itself, so they show what you&apos;ve done.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2.5">
        {PAWNS.map((p) => {
          // "My picture": with no profile picture yet, the tile offers to add one.
          if (p.id === "photo" && !photo)
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={adding}
                onClick={() => setAdding(true)}
                className={cx("grid justify-items-center gap-1 rounded-xl border border-dashed bg-surface px-1 pt-2.5 pb-2", adding ? "border-accent-600 ring-2 ring-accent-600" : "border-slate-300")}
              >
                <span aria-hidden className="grid size-[46px] place-items-center rounded-full border-[3px] border-surface text-sm font-semibold text-white ring-1 ring-slate-200" style={{ background: pawnFill(pick.color) }}>
                  {initialsOf(me.name)}
                </span>
                <span className="text-center text-xs leading-tight text-slate-800">
                  My picture
                  <span className="block text-[11px] text-accent-700">Add a picture</span>
                </span>
              </button>
            );
          const locked = !unlocked.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={!locked && pick.pawn === p.id}
              aria-label={locked && "unlock" in p ? `${p.label}, locked: ${p.unlock}` : p.label}
              onClick={() => {
                if (locked && "unlock" in p) return setNote(`🔒 ${p.label}: ${p.unlock}.`);
                setNote("");
                setPick({ ...pick, pawn: p.id });
              }}
              className={cx(
                "grid justify-items-center gap-1 rounded-xl border bg-surface px-1 pt-2.5 pb-2",
                !locked && pick.pawn === p.id ? "border-accent-600 ring-2 ring-accent-600" : "border-slate-200",
                locked && "cursor-help",
              )}
            >
              <span aria-hidden className={cx("grid size-[46px] place-items-center overflow-hidden rounded-full border-[3px] border-surface text-[26px] ring-1 ring-slate-200", locked && "opacity-45 grayscale")} style={{ background: pawnFill(pick.color) }}>
                <PawnFace pawn={p.id} photo={photo} />
              </span>
              <span className={cx("text-center text-xs leading-tight", locked ? "text-slate-500" : "text-slate-800")}>
                {locked && "🔒 "}
                {p.label}
              </span>
            </button>
          );
        })}
      </div>
      {adding && !photo && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="pawn-add-picture">
          <p className="mb-2 text-sm text-slate-700">Add a profile picture and it becomes your pawn. It also shows next to your name everywhere else.</p>
          <AvatarUpload person={{ id: me.userId, name: me.name }} />
        </div>
      )}
      <p className="mt-2 min-h-5 text-sm text-slate-500" aria-live="polite">
        {note}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">{sp("Pawn color")}</span>
        {PAWN_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={pick.color === c}
            aria-label={sp(c === "accent" ? "Pawn color: your theme color" : "Pawn color")}
            onClick={() => setPick({ ...pick, color: c })}
            className={cx("size-[26px] rounded-full border-[3px] border-surface", pick.color === c ? "ring-2 ring-accent-600" : "ring-1 ring-slate-200")}
            style={{ background: pawnFill(c) }}
          />
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setQuestPawn(pick.pawn, pick.color);
              if (!r.ok) return setError(r.error);
              onClose();
              router.refresh();
            })
          }
        >
          Save pawn
        </Button>
      </div>
    </Modal>
  );
}

const initialsOf = (name: string) => {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
};

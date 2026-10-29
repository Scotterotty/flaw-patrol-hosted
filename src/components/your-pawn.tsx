"use client";

import { useState } from "react";
import { itemById, pawnFill, pawnOf, SLOTS } from "@/lib/quest-gear";
import { Modal } from "./modal";
import { PawnFace } from "./pawn-face";
import { PawnGear, PawnPicker, type GearProps } from "./pawn-gear";
import { RARITY_STYLE } from "./rarity";
import { Button, Card, cx } from "./ui";

/**
 * The Quest map page's "Your pawn" card (ver_94): your pawn as it walks on every
 * map, with Change gear (the equip screen in a panel) and Change pawn. The
 * Account "Dress your pawn" link and the find pop-up land here with ?gear=1.
 */
export function YourPawnCard({ gear, openGear = false }: { gear: GearProps; openGear?: boolean }) {
  const [dressing, setDressing] = useState(openGear);
  const [picking, setPicking] = useState(false);
  const worn = SLOTS.map((s) => ({ slot: s, item: itemById(gear.worn[s.id]) })).filter((w) => w.item);
  const pawn = pawnOf(gear.pawn);
  return (
    <Card id="your-pawn" className="scroll-mt-20 p-4" role="region" aria-labelledby="your-pawn-heading">
      <h2 id="your-pawn-heading" className="text-sm font-semibold text-slate-800">
        Your pawn
      </h2>
      <div className="mt-2 flex items-center gap-3">
        <span aria-hidden className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full border-4 border-surface text-3xl ring-1 ring-slate-200" style={{ background: pawnFill(gear.color) }}>
          <PawnFace pawn={gear.pawn} photo={gear.photo} />
        </span>
        <div className="min-w-0 text-xs">
          <p className="font-medium text-slate-900">{gear.pawn === "photo" && !gear.photo ? pawnOf("classic").label : pawn.label}</p>
          {worn.length ? (
            <ul aria-label="Wearing" className="mt-1 flex flex-wrap gap-1.5">
              {worn.map(({ slot, item }) => (
                <li
                  key={slot.id}
                  title={`${slot.label}: ${item!.name}`}
                  className={cx("grid size-7 place-items-center rounded-full bg-surface text-sm ring-2", RARITY_STYLE[item!.rarity].ring)}
                >
                  <span aria-hidden>{item!.emoji}</span>
                  <span className="sr-only">{`${slot.label}: ${item!.name}`}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-0.5 text-slate-500">No gear on yet.</p>
          )}
        </div>
      </div>
      {worn.length > 0 && <p className="mt-2 text-xs text-slate-500">{worn.map(({ slot, item }) => `${slot.label}: ${item!.name}`).join(" · ")}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => setDressing(true)}>
          Change gear
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
          Change pawn
        </Button>
      </div>
      <Modal open={dressing} onClose={() => setDressing(false)} title="Change gear">
        <PawnGear {...gear} />
      </Modal>
      <PawnPicker open={picking} onClose={() => setPicking(false)} pawn={gear.pawn} color={gear.color} unlocked={gear.unlocked} photo={gear.photo} me={gear.me} />
    </Card>
  );
}

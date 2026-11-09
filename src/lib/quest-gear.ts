// Quest pawns and gear (opt-in, looks only). Each player picks a pawn and a
// color, and wears items from their satchel in five slots. Gear never changes
// odds or XP: it shows on the map and gets named in encounter and rescue lines.
// Teamwork events: trouble on a step holds whoever lands there until the next
// teammate to save a case in the run rescues them.

import { earner, FOES, ITEMS, sentence, type Completion, type GearSnapshot, type QuestMap, type QuestTrouble, type Rarity } from "./quest";

export const SLOTS = [
  { id: "head", label: "Head" },
  { id: "hand", label: "Hand" },
  { id: "offhand", label: "Off hand" },
  { id: "charm", label: "Charm" },
  { id: "companion", label: "Companion" },
] as const;
export type Slot = (typeof SLOTS)[number]["id"];
export const SLOT_LABEL = Object.fromEntries(SLOTS.map((s) => [s.id, s.label])) as Record<Slot, string>;
export const isSlot = (v: string): v is Slot => SLOTS.some((s) => s.id === v);

/** Where each badge sits on the ring around a pawn: 0° is right, 90° straight down. */
export const SLOT_ANGLE: Record<Slot, number> = { head: -90, hand: 0, charm: 60, companion: 120, offhand: 180 };

// Which slots each item fits. Anything not listed (or not obviously wearable) is a Charm.
const FITS: Record<string, Slot[]> = {
  hat: ["head"],
  crown: ["head"],
  mushroom: ["head", "charm"],
  feather: ["head", "charm"],
  star: ["head", "charm"],
  bouquet: ["head", "charm"],
  sword: ["hand"],
  wand: ["hand"],
  bow: ["hand"],
  dagger: ["hand"],
  pencil: ["hand"],
  lens: ["hand"],
  keyboard: ["hand"],
  storm: ["hand", "charm"],
  ember: ["hand", "charm"],
  key: ["hand", "charm"],
  magnet: ["hand", "charm"],
  orb: ["hand", "charm"],
  lantern: ["hand", "offhand"],
  telescope: ["hand", "offhand"],
  lute: ["hand", "offhand"],
  candle: ["hand", "offhand"],
  shield: ["offhand"],
  spellbook: ["offhand"],
  map: ["offhand"],
  scroll: ["offhand"],
  note: ["offhand"],
  bookmark: ["offhand"],
  mirror: ["offhand"],
  coffee: ["offhand", "charm"],
  tea: ["offhand", "charm"],
  bell: ["offhand", "charm"],
  hourglass: ["offhand", "charm"],
  compass: ["offhand", "charm"],
  trophy: ["offhand", "charm"],
  duck: ["companion"],
  unicorn: ["companion"],
  egg: ["companion"],
  fleece: ["companion"],
  satellite: ["companion"],
  comet: ["companion", "charm"],
};
export const fitsOf = (itemId: string): Slot[] => FITS[itemId] ?? ["charm"];

/** Where a first find goes on its own: the first empty slot it fits (Head, Hand, Off hand, Charm, Companion) that wasn't emptied by hand. */
export function autoSlotFor(itemId: string, gear: GearSnapshot, touched: readonly string[]): Slot | null {
  if (Object.values(gear).includes(itemId)) return null;
  return SLOTS.map((s) => s.id).find((s) => fitsOf(itemId).includes(s) && !gear[s] && !touched.includes(s)) ?? null;
}

/** Free pawns, then the four that unlock from the quests themselves. "My picture" is your profile picture. */
export const PAWNS = [
  { id: "photo", emoji: "🖼️", label: "My picture" },
  { id: "classic", emoji: "♟️", label: "Classic" },
  { id: "elf", emoji: "🧝", label: "Elf" },
  { id: "wizard", emoji: "🧙", label: "Wizard" },
  { id: "ninja", emoji: "🥷", label: "Ninja" },
  { id: "robot", emoji: "🤖", label: "Robot" },
  { id: "fox", emoji: "🦊", label: "Fox" },
  { id: "cat", emoji: "🐱", label: "Cat" },
  { id: "frog", emoji: "🐸", label: "Frog" },
  { id: "koala", emoji: "🐨", label: "Koala" },
  { id: "penguin", emoji: "🐧", label: "Penguin" },
  { id: "astronaut", emoji: "🧑‍🚀", label: "Astronaut" },
  { id: "owl", emoji: "🦉", label: "Owl" },
  { id: "dragon", emoji: "🐉", label: "Dragon", unlock: "Defeat a dragon-type foe (Null Pointer Dragon, Elder Dragon)" },
  { id: "unicorn", emoji: "🦄", label: "Unicorn", unlock: "Find any Exotic item" },
  { id: "royal", emoji: "👑", label: "Royal", unlock: "Finish 10 quests" },
  { id: "ghost", emoji: "👻", label: "Ghost", unlock: "Have 5 foes slip past you (we all have off days)" },
] as const;
export type PawnId = (typeof PAWNS)[number]["id"];
export const pawnOf = (id: string | null | undefined) => PAWNS.find((p) => p.id === id) ?? PAWNS[1];

/** The profile picture a "My picture" pawn shows. */
export const photoUrl = (userId: string, avatarAt: Date | string | null | undefined) => (avatarAt ? `/api/avatars/${userId}?v=${new Date(avatarAt).getTime()}` : null);

/** Pawn colors. "accent" follows each viewer's theme. */
export const PAWN_COLORS = ["accent", "#0f766e", "#b91c1c", "#c2410c", "#7c3aed", "#0369a1", "#be185d", "#475569"] as const;
export const pawnFill = (c: string | null | undefined) => (c && c !== "accent" && (PAWN_COLORS as readonly string[]).includes(c) ? c : "var(--color-accent-600)");

/** A player's look on the map. */
export type Look = { userId: string | null; name: string; pawn: string; color: string; gear: GearSnapshot; photo?: string | null };

/** Clean up stored gear: known slots, known items that fit there. */
export function parseGear(v: unknown): GearSnapshot {
  const out: GearSnapshot = {};
  if (!v || typeof v !== "object") return out;
  for (const [slot, id] of Object.entries(v as Record<string, unknown>))
    if (isSlot(slot) && typeof id === "string" && ITEMS.some((i) => i.id === id) && fitsOf(id).includes(slot)) out[slot] = id;
  return out;
}
export const itemById = (id: string | undefined) => (id ? ITEMS.find((i) => i.id === id) : undefined);

const fill = (template: string, h: string, w: string) => template.replace("{h}", h).replace("{w}", w);

export type TeamworkEvent = {
  step: number;
  trouble: QuestTrouble;
  victim: Completion;
  /** The next teammate to save a case, or the victim when they finished the run alone. */
  helper: Completion | null;
  self: boolean;
  /** The helper's Off hand or Charm when they saved, named in the rescue line. */
  itemId?: string;
};

/**
 * How each trouble played out. The rescuer is whoever saves the next case after
 * the victim's and isn't the victim. With no one else before the end, the victim
 * rescues themselves when the run finishes, whoever takes the final step.
 */
export function teamwork(map: QuestMap, done: Completion[], steps: number): TeamworkEvent[] {
  const out: TeamworkEvent[] = [];
  for (const t of map.troubles) {
    const victim = earner(done[t.step - 1]);
    if (!victim) continue;
    const same = (c: Completion) => (victim.userId ? c.userId === victim.userId : c.name === victim.name);
    const later = done.slice(t.step);
    let helper = later.find((c) => !c.imported && !same(c)) ?? null;
    let self = false;
    // Once the quest reaches the end, nobody is left stuck: anyone no teammate came
    // back for walks out at the finish on their own (no thank-you find).
    if (!helper && done.length >= steps) {
      helper = done.slice(t.step - 1).filter((c) => !c.imported && same(c)).pop() ?? null;
      self = !!helper;
    }
    const g = helper?.gear ?? {};
    out.push({ step: t.step, trouble: t, victim, helper, self, itemId: helper ? (self ? (g.head ?? g.charm) : (g.offhand ?? g.charm)) : undefined });
  }
  return out;
}

/** "Jordan was bitten by a Guile Worm!" */
export const troubleLine = (e: TeamworkEvent, who = e.victim.name) => `${fill(e.trouble.trouble.got, "", who).trim()}!`;

/** "Priya cured Jordan with the Potion of Coffee!" or a self-rescue. */
export function rescueLine(e: TeamworkEvent, helperName = e.helper?.name ?? "", victimName = e.victim.name, to = "the end") {
  const item = itemById(e.itemId)?.name;
  if (e.self) return `${victimName} rescued themselves${item ? ` with the ${item}` : ""} and limped into ${to}!`;
  return sentence(`${fill(e.trouble.trouble.rescue, helperName, victimName)}${item ? ` with the ${item}!` : ""}`);
}

/** Thank-you finds from rescues, given to the helper (not for self-rescues). */
export function rescueFinds(events: TeamworkEvent[], done: Completion[]) {
  return events
    .filter((e) => e.helper && !e.self)
    .map((e) => {
      const at = done.indexOf(e.helper!);
      return {
        ...e.trouble.thanks,
        kind: "item" as const,
        step: at + 1,
        thanks: true,
        winner: { userId: e.helper!.userId, name: e.helper!.name, status: e.helper!.status, at: e.helper!.at, gear: e.helper!.gear ?? null },
      };
    });
}

/** Everyone who has saved a case in the run, the latest saver first (they lead). */
export function partyOf(done: Completion[]) {
  const seen = new Set<string>();
  const out: Completion[] = [];
  for (let i = done.length - 1; i >= 0; i--) {
    const k = done[i].userId ?? `name:${done[i].name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(done[i]);
  }
  return out;
}

/** Up to this many pawns walk the road; the rest fold into a "+N" bubble. */
export const PARTY_MAX = 5;
/** Distance along the trail between pawns in the party. */
export const PARTY_GAP = 95;

/** Points `gap`, `2 × gap`, ... back along the walked trail from the pawn at `position`. */
export function pointsBehind(map: QuestMap, position: number, count: number, gap = PARTY_GAP) {
  const i = Math.min(position, map.nodes.length - 1);
  const pts = [...map.trail.slice(0, map.before[i]), map.nodes[i]];
  const out: { x: number; y: number }[] = [];
  let want = gap;
  let walked = 0;
  for (let k = pts.length - 1; k > 0 && out.length < count; k--) {
    const a = pts[k];
    const b = pts[k - 1];
    const seg = Math.hypot(a.x - b.x, a.y - b.y);
    while (seg > 0 && walked + seg >= want && out.length < count) {
      const t = (want - walked) / seg;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      want += gap;
    }
    walked += seg;
  }
  // Not enough road walked yet: the rest wait at the start.
  while (out.length < count) out.push(pts[0]);
  return out;
}

/** Which party members get a pawn on the road: the leader, you, then the latest savers. */
export function shownParty<T extends { userId: string | null }>(party: T[], me: string | null) {
  if (party.length <= PARTY_MAX) return { shown: party, more: [] as T[] };
  const mine = party.findIndex((p) => p.userId === me);
  const pickIdx = new Set<number>([0]);
  if (mine >= 0) pickIdx.add(mine);
  for (let i = 1; pickIdx.size < PARTY_MAX; i++) pickIdx.add(i);
  return { shown: party.filter((_, i) => pickIdx.has(i)), more: party.filter((_, i) => !pickIdx.has(i)) };
}

/** What one person has done across quests, for gear, pawn unlocks and the Field Medic title. */
export type QuestRecord = {
  items: Map<string, number>;
  exotic: boolean;
  dragon: boolean;
  slipped: number;
  finished: number;
  rescues: number;
  teamwork: number;
};

const DRAGONS = new Set(["dragon", "elder"]);

/** Tally a person's quest record from runs' maps and completions. */
export function questRecord(userId: string, runs: { map: QuestMap; done: Completion[]; steps: number }[], since?: Date): QuestRecord {
  const rec: QuestRecord = { items: new Map(), exotic: false, dragon: false, slipped: 0, finished: 0, rescues: 0, teamwork: 0 };
  const ok = (c: Completion | null | undefined) => !!c && c.userId === userId && (!since || c.at >= since);
  for (const r of runs) {
    for (const e of r.map.events) {
      const c = earner(r.done[e.step - 1]);
      if (!ok(c)) continue;
      if (e.kind === "item") {
        rec.items.set(e.id, (rec.items.get(e.id) ?? 0) + 1);
        if (e.rarity === "exotic") rec.exotic = true;
      } else {
        const status = c!.status;
        if (status === "PASSED" && DRAGONS.has(e.id)) rec.dragon = true;
        if (status !== "PASSED" && status !== "FAILED") rec.slipped++;
      }
    }
    const tw = teamwork(r.map, r.done, r.steps);
    for (const f of rescueFinds(tw, r.done))
      if (f.winner.userId === userId && (!since || f.winner.at >= since)) {
        rec.items.set(f.id, (rec.items.get(f.id) ?? 0) + 1);
        if (f.rarity === "exotic") rec.exotic = true;
      }
    for (const e of tw) {
      if (e.self || !e.helper) continue;
      if (ok(e.helper)) {
        rec.rescues++;
        rec.teamwork++;
      }
      if (ok(e.victim)) rec.teamwork++;
    }
    if (r.steps > 0 && r.done.length >= r.steps && r.done.some(ok)) rec.finished++;
  }
  return rec;
}

/** Which of the unlockable pawns a record has earned. */
export function pawnUnlocked(id: string, rec: QuestRecord | null) {
  const p = PAWNS.find((x) => x.id === id);
  if (!p) return false;
  if (!("unlock" in p)) return true;
  if (!rec) return false;
  if (id === "dragon") return rec.dragon;
  if (id === "unicorn") return rec.exotic;
  if (id === "royal") return rec.finished >= 10;
  if (id === "ghost") return rec.slipped >= 5;
  return false;
}

export const rarityOfItem = (id: string): Rarity => itemById(id)?.rarity ?? "common";
export const foeById = (id: string) => FOES.find((f) => f.id === id);

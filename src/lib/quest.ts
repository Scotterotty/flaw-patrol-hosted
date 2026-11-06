// Quest maps for the mini game (opt-in). Every test run is a quest: a map
// generated from the run's id, a path with one step per case, and encounters
// and items on some steps. The pawn moves a step each time a case in the run
// gets a result; whoever saved the case that lands it on an encounter or item
// gets it. Nothing is stored: the map comes from the seed, and progress and
// rewards come from the results, so they can't drift out of step.

export const MAP_W = 1000;
export const MAP_H = 560;

/** Small, fast seeded random numbers (mulberry32) from a string. */
export function seeded(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rand: () => number, list: readonly T[]) => list[Math.floor(rand() * list.length)];

export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "exotic"] as const;
export type Rarity = (typeof RARITIES)[number];
export const RARITY_LABEL: Record<Rarity, string> = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", exotic: "Exotic" };

/**
 * `since` is the catalog a find joined in. Each run keeps the catalog it was
 * started with (TestRun.questCatalog), so adding finds never changes what an
 * earlier run's map hides or what people already found there. New finds go
 * at the end of the list, never in between.
 */
type Find = { id: string; name: string; emoji: string; rarity: Rarity; since?: number };
const c = (rarity: Rarity, list: [string, string, string][], since?: number): Find[] => list.map(([id, name, emoji]) => ({ id, name, emoji, rarity, ...(since && { since }) }));

/** The catalog new runs start with. Bump it (and TestRun.questCatalog's default) when adding finds. */
export const QUEST_CATALOG = 3;

export const ITEMS: Find[] = [
  ...c("common", [
    ["duck", "Rubber Duck of Debugging", "🦆"],
    ["coffee", "Potion of Coffee", "☕"],
    ["note", "Sticky Note of Reminders", "🗒️"],
    ["pencil", "Pencil of Repro Steps", "✏️"],
    ["cookie", "Cookie of Morale", "🍪"],
    ["clip", "Paperclip of Holding", "📎"],
    ["tea", "Mug of Calm", "🍵"],
    ["bookmark", "Bookmark of Last Known Good", "🔖"],
  ]),
  ...c("uncommon", [
    ["scroll", "Stack Trace Scroll", "📜"],
    ["lantern", "Lantern of Logs", "🏮"],
    ["boots", "Boots of Retest", "🥾"],
    ["lens", "Lens of Close Inspection", "🔍"],
    ["compass", "Compass of Coverage", "🧭"],
    ["battery", "Battery of Overtime", "🔋"],
    ["hourglass", "Hourglass of Timeouts", "⏳"],
  ]),
  ...c("rare", [
    ["shield", "Shield of Regression", "🛡️"],
    ["map", "Map of Edge Cases", "🗺️"],
    ["magnet", "Magnet of Flaky Tests", "🧲"],
    ["telescope", "Telescope of Observability", "🔭"],
    ["bell", "Bell of Alerts", "🔔"],
    ["keyboard", "Keyboard of Shortcuts", "⌨️"],
  ]),
  ...c("epic", [
    ["gem", "Green Build Gem", "💎"],
    ["orb", "Crystal Ball of Requirements", "🔮"],
    ["crown", "Crown of Code Review", "👑"],
    ["beads", "Amulet of Clean Logs", "📿"],
    ["satellite", "Satellite of Monitoring", "🛰️"],
  ]),
  ...c("legendary", [
    ["key", "Key to Prod", "🗝️"],
    ["ticket", "Golden Ticket of Hotfixes", "🎫"],
    ["trophy", "Trophy of Zero Bugs", "🏆"],
    ["feather", "Phoenix Feather of Rollback", "🪶"],
  ]),
  ...c("exotic", [
    ["unicorn", "Unicorn of Reproducible Bugs", "🦄"],
    ["comet", "Comet of Perfect Coverage", "☄️"],
    ["rainbow", "Rainbow of Green Pipelines", "🌈"],
  ]),
  // Catalog 2: beyond software testing.
  ...c("common", [
    ["acorn", "Lucky Acorn", "🌰"],
    ["bouquet", "Wildflower Bouquet", "💐"],
    ["stone", "Smooth River Stone", "🪨"],
    ["bread", "Loaf of Trail Bread", "🍞"],
    ["apple", "Shiny Red Apple", "🍎"],
    ["twine", "Ball of Twine", "🧶"],
    ["candle", "Candle Stub", "🕯️"],
  ], 2),
  ...c("uncommon", [
    ["clover", "Four-Leaf Clover", "🍀"],
    ["lute", "Traveler's Banjo", "🪕"],
    ["mushroom", "Glowing Mushroom", "🍄"],
    ["shell", "Seashell of Whispers", "🐚"],
    ["honey", "Pot of Wild Honey", "🍯"],
    ["hat", "Hat of Many Tricks", "🎩"],
  ], 2),
  ...c("rare", [
    ["dagger", "Crystal Dagger", "🗡️"],
    ["bow", "Elven Bow", "🏹"],
    ["spellbook", "Dusty Spellbook", "📖"],
    ["egg", "Dragon Egg", "🥚"],
    ["mirror", "Mirror of Truth", "🪞"],
  ], 2),
  ...c("epic", [
    ["storm", "Storm in a Bottle", "⚡"],
    ["sword", "Sword from the Stone", "⚔️"],
    ["wand", "Wand of Wonders", "🪄"],
    ["ember", "Volcano Ember", "🌋"],
  ], 2),
  ...c("legendary", [
    ["star", "Fallen Star", "⭐"],
    ["fleece", "Golden Fleece", "🐑"],
    ["ring", "Ring of the Ancients", "💍"],
  ], 2),
  ...c("exotic", [
    ["moonjar", "Moonbeam in a Jar", "🌙"],
    ["galaxy", "Pocket Galaxy", "🌌"],
  ], 2),
];

export const FOES: Find[] = [
  ...c("common", [
    ["mite", "a Lint Mite", "🐜"],
    ["heisenbug", "a wild Heisenbug", "🐛"],
    ["slime", "a Memory Leak Slime", "🟢"],
    ["bat", "a Stale Cache Bat", "🦇"],
    ["rat", "a Console Log Rat", "🐀"],
    ["snail", "a Missing Semicolon Snail", "🐌"],
  ]),
  ...c("uncommon", [
    ["goblin", "the Flaky Test Goblin", "👺"],
    ["ghost", "the Ghost of Cached Data", "👻"],
    ["owl", "the Off-by-One Owl", "🦉"],
    ["zombie", "the Deprecated API Zombie", "🧟"],
    ["scorpion", "the Broken Link Scorpion", "🦂"],
  ]),
  ...c("rare", [
    ["troll", "the Merge Conflict Troll", "🧌"],
    ["spider", "the Race Condition Spider", "🕷️"],
    ["kraken", "the Timeout Kraken", "🐙"],
    ["wolf", "the Regression Wolf", "🐺"],
  ]),
  ...c("epic", [
    ["dragon", "the Null Pointer Dragon", "🐉"],
    ["serpent", "the Infinite Loop Serpent", "🐍"],
    ["ogre", "the Production Outage Ogre", "👹"],
  ]),
  ...c("legendary", [
    ["demon", "the Friday Deploy Demon", "😈"],
    ["squid", "the Kernel Panic Squid", "🦑"],
    ["whale", "the Legacy Code Leviathan", "🐋"],
  ]),
  ...c("exotic", [
    ["alien", "the Works-on-My-Machine Alien", "👽"],
    ["rex", "the Ancient Y2K Rex", "🦖"],
  ]),
  // Catalog 2: beyond software testing.
  ...c("common", [
    ["toad", "a Grumpy Toad", "🐸"],
    ["raccoon", "a Mischievous Raccoon", "🦝"],
    ["boar", "a Wild Boar", "🐗"],
    ["mosquito", "a Mosquito Swarm", "🦟"],
    ["squirrel", "a Hungry Squirrel", "🐿️"],
  ], 2),
  ...c("uncommon", [
    ["wisp", "the Will-o'-the-Wisp", "✨"],
    ["golem", "the Moss Golem", "🗿"],
    ["witch", "the Swamp Witch", "🧙"],
    ["bandit", "the Masked Bandit", "🥷"],
    ["bear", "the Cave Bear", "🐻"],
  ], 2),
  ...c("rare", [
    ["eagle", "the Storm Eagle", "🦅"],
    ["crab", "the Giant Crab", "🦀"],
    ["minotaur", "the Minotaur", "🐂"],
    ["vampire", "the Vampire Count", "🧛"],
  ], 2),
  ...c("epic", [
    ["lich", "the Lich", "💀"],
    ["sphinx", "the Riddling Sphinx", "🦁"],
    ["mammoth", "the Woolly Mammoth", "🦣"],
  ], 2),
  ...c("legendary", [
    ["elder", "the Elder Dragon", "🐲"],
    ["treant", "the Ancient Treant", "🌳"],
    ["thunderbird", "the Thunderbird", "⛈️"],
  ], 2),
  ...c("exotic", [
    ["dodo", "the Last Dodo", "🦤"],
    ["moonrabbit", "the Moon Rabbit", "🐇"],
  ], 2),
  // Catalog 3: the Owlbear and friends.
  ...c("common", [["goose", "a Cranky Goose", "🪿"]], 3),
  ...c("uncommon", [["cube", "the Gelatinous Cube", "🧊"]], 3),
  ...c("rare", [["owlbear", "the Owlbear", "🦉"]], 3),
  ...c("epic", [["basilisk", "the Basilisk", "🦎"]], 3),
  ...c("legendary", [["griffin", "the Griffin", "🪽"]], 3),
];

/**
 * Teamwork events (catalog 3 on): trouble hidden on a step. Whoever lands there
 * gets stuck until the next teammate to save a case comes to the rescue.
 * `got` reads "{w} was bitten by a Guile Worm"; `rescue` reads "{h} cured {w}".
 */
export type TroubleDef = { id: string; name: string; emoji: string; rarity: Rarity; got: string; rescue: string };
export const TROUBLES: TroubleDef[] = [
  { id: "toe", name: "Stubbed Toe", emoji: "🦶", rarity: "common", got: "{w} stubbed a toe on a Loose Cable", rescue: "{h} patched up {w}" },
  { id: "bog", name: "Sticky Bog of Scope Creep", emoji: "🟤", rarity: "common", got: "{w} fell into the Sticky Bog of Scope Creep", rescue: "{h} pulled {w} out of the Sticky Bog" },
  { id: "trap", name: "Bear Trap of Legacy Config", emoji: "🪤", rarity: "uncommon", got: "{w} stepped in a Bear Trap of Legacy Config", rescue: "{h} pried {w} loose" },
  { id: "web", name: "Race Condition Web", emoji: "🕸️", rarity: "uncommon", got: "{w} got tangled in a Race Condition Web", rescue: "{h} cut {w} free" },
  { id: "fog", name: "Fog of Missing Logs", emoji: "🌫️", rarity: "rare", got: "{w} got lost in the Fog of Missing Logs", rescue: "{h} led {w} out" },
  { id: "worm", name: "Guile Worm", emoji: "🪱", rarity: "rare", got: "{w} was bitten by a Guile Worm", rescue: "{h} cured {w}" },
  { id: "squeeze", name: "Infinite Loop Serpent", emoji: "🐍", rarity: "epic", got: "{w} was squeezed by the Infinite Loop Serpent", rescue: "{h} untangled {w}" },
  { id: "maze", name: "Maze of Merge Hell", emoji: "🌀", rarity: "legendary", got: "{w} got trapped in the Maze of Merge Hell", rescue: "{h} found {w} a way out" },
  { id: "leviathan", name: "Legacy Code Leviathan", emoji: "🐋", rarity: "exotic", got: "{w} was swallowed by the Legacy Code Leviathan", rescue: "{h} hauled {w} back out" },
];

// How likely each rarity is on a road of a given length. Longer runs are luckier:
// rarer tiers grow with the run's size until 50 cases, where the odds top out.
const BASE_WEIGHT: Record<Rarity, number> = { common: 50, uncommon: 25, rare: 13, epic: 7, legendary: 4, exotic: 1 };
const LUCK_POWER: Record<Rarity, number> = { common: 0, uncommon: 0.5, rare: 1, epic: 1.5, legendary: 2, exotic: 2.5 };
export const LUCKIEST_RUN = 50;

/** Chance of each rarity for one find on a road with this many steps. Sums to 1. */
export function rarityOdds(steps: number): Record<Rarity, number> {
  const luck = Math.min(1, Math.max(steps, 1) / LUCKIEST_RUN);
  const w = RARITIES.map((r) => BASE_WEIGHT[r] * luck ** LUCK_POWER[r]);
  const total = w.reduce((a, b) => a + b, 0);
  return Object.fromEntries(RARITIES.map((r, i) => [r, w[i] / total])) as Record<Rarity, number>;
}

function rollRarity(rand: () => number, odds: Record<Rarity, number>): Rarity {
  let x = rand();
  for (const r of RARITIES) {
    if (x < odds[r]) return r;
    x -= odds[r];
  }
  return "common";
}

const PLACES_FROM = ["Dev Hollow", "Staging Shire", "Backlog Bay", "Sprint Harbor", "Standup Springs"];
const PLACES_TO = ["Release Peak", "Fort Production", "Ship-It Citadel", "Green Build Keep", "Launch Tower"];

export type QuestEvent = { step: number; kind: "item" | "foe"; id: string; name: string; emoji: string; rarity: Rarity };
/** Trouble on a step, and the thank-you find its rescuer gets (as rare as the trouble). */
export type QuestTrouble = { step: number; trouble: TroubleDef; thanks: Omit<QuestEvent, "step" | "kind"> };

type Deco = { x: number; y: number; kind: "tree" | "peak" | "lake" | "rock"; size: number };

export type QuestMap = {
  from: string;
  to: string;
  /** Point for every step: 0 is the start, `steps` is the destination. */
  nodes: { x: number; y: number }[];
  /** SVG path through every node. */
  path: string;
  /** The trail's points, and for each node how many of them lie before it, so the walked part follows the curves. */
  trail: { x: number; y: number }[];
  before: number[];
  events: QuestEvent[];
  troubles: QuestTrouble[];
  decor: Deco[];
};

/** A smooth winding trail across the map, sampled into `steps + 1` evenly spaced points. */
function trail(rand: () => number, steps: number) {
  const waypoints = 5 + Math.floor(rand() * 3);
  const ctrl = Array.from({ length: waypoints }, (_, i) => ({
    x: 70 + (i * (MAP_W - 140)) / (waypoints - 1),
    y: 90 + rand() * (MAP_H - 180),
  }));
  // Catmull-Rom through the waypoints, finely sampled.
  const fine: { x: number; y: number }[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < 40; k++) {
      const t = k / 40;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      fine.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  fine.push(ctrl[ctrl.length - 1]);
  // Even spacing along the trail's length.
  const len = [0];
  for (let i = 1; i < fine.length; i++) len.push(len[i - 1] + Math.hypot(fine[i].x - fine[i - 1].x, fine[i].y - fine[i - 1].y));
  const total = len[len.length - 1];
  const nodes: { x: number; y: number }[] = [];
  const before: number[] = [];
  let j = 0;
  for (let s = 0; s <= steps; s++) {
    const want = (s / Math.max(1, steps)) * total;
    while (j < len.length - 2 && len[j + 1] < want) j++;
    const seg = len[j + 1] - len[j] || 1;
    const t = Math.min(1, Math.max(0, (want - len[j]) / seg));
    const node = { x: fine[j].x + (fine[j + 1].x - fine[j].x) * t, y: fine[j].y + (fine[j + 1].y - fine[j].y) * t };
    nodes.push(node);
    before.push(j + 1);
  }
  const path = fine.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return { nodes, path, fine, before };
}

/** The map for a run. Same seed, step count and catalog, same map. */
export function generateQuest(seed: string, steps: number, catalog = QUEST_CATALOG): QuestMap {
  const rand = seeded(seed);
  const { nodes, path, fine, before } = trail(rand, Math.max(1, steps));

  // About one event every four steps, between 1 and 12. Never on the start, and
  // only on the destination when the road is a single step long.
  const count = Math.min(12, Math.max(1, Math.round(steps / 4)), Math.max(1, steps - 1));
  const free = steps < 2 ? [Math.max(1, steps)] : Array.from({ length: steps - 1 }, (_, i) => i + 1);
  const spots: number[] = [];
  for (let i = 0; i < count && free.length; i++) spots.push(free.splice(Math.floor(rand() * free.length), 1)[0]);
  const odds = rarityOdds(steps);
  const events: QuestEvent[] = spots
    .sort((a, b) => a - b)
    .map((step) => {
      const kind = rand() < 0.5 ? ("item" as const) : ("foe" as const);
      const rarity = rollRarity(rand, odds);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `since` is catalog bookkeeping, not part of the event
      const { since, ...find } = pick(rand, (kind === "item" ? ITEMS : FOES).filter((f) => f.rarity === rarity && (f.since ?? 1) <= catalog));
      return { step, kind, ...find };
    });

  // Scenery away from the trail.
  const decor: Deco[] = [];
  for (let tries = 0; decor.length < 46 && tries < 600; tries++) {
    const x = 20 + rand() * (MAP_W - 40);
    const y = 20 + rand() * (MAP_H - 40);
    const near = fine.some((p) => Math.hypot(p.x - x, p.y - y) < 46) || decor.some((d) => Math.hypot(d.x - x, d.y - y) < 34);
    if (near) continue;
    const r = rand();
    decor.push({ x, y, kind: r < 0.5 ? "tree" : r < 0.72 ? "peak" : r < 0.85 ? "lake" : "rock", size: 0.8 + rand() * 0.6 });
  }

  const from = pick(rand, PLACES_FROM);
  const to = pick(rand, PLACES_TO);
  // Troubles roll from their own seed, after everything else, so they never move what a map already had.
  const troubles: QuestTrouble[] = [];
  if (catalog >= 3 && steps >= 4) {
    const tr = seeded(`${seed}:trouble`);
    const max = Math.min(3, Math.floor(steps / 6));
    const n = Math.floor(tr() * (max + 1));
    // Never the start or the destination, and never where an event already is.
    const open = Array.from({ length: steps - 2 }, (_, i) => i + 1).filter((st) => !events.some((e) => e.step === st));
    for (let i = 0; i < n && open.length; i++) {
      const step = open.splice(Math.floor(tr() * open.length), 1)[0];
      const rarity = rollRarity(tr, odds);
      const pool = TROUBLES.filter((t) => t.rarity === rarity);
      const trouble = pool.length ? pick(tr, pool) : TROUBLES[0];
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- catalog bookkeeping
      const { since, ...thanks } = pick(tr, ITEMS.filter((f) => f.rarity === trouble.rarity && (f.since ?? 1) <= catalog));
      troubles.push({ step, trouble, thanks });
    }
    troubles.sort((a, b) => a.step - b.step);
  }

  return { from, to, nodes, path, trail: fine, before, events, troubles, decor };
}

/** Worn quest gear by slot (see src/lib/quest-gear.ts), as snapshotted on a result. */
export type GearSnapshot = Partial<Record<"head" | "hand" | "offhand" | "charm" | "companion", string>>;

/** `imported`: the result came in from a spreadsheet. It moves the pawn but never earns finds or trouble (ver_183). */
export type Completion = { entryId: string; at: Date; userId: string | null; name: string; status: string; gear?: GearSnapshot | null; imported?: boolean };

/** Who earns what's on a step: the result that landed there, unless it was imported from a sheet. */
export const earner = <C extends Completion>(c: C | null | undefined): C | undefined => (c && !c.imported ? c : undefined);

/** A person's name for the quest map. Someone with no name shows "ryan.meredith@x.com" as "Ryan Meredith". */
export function questName(name: string) {
  const m = /^([^@\s]+)@[^@\s]+$/.exec(name.trim());
  if (!m) return name;
  const words = m[1].split(/[._+-]+/).filter(Boolean);
  return words.length ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : name;
}

/**
 * The order the pawn walks: results saved in Flaw Patrol first, by when they were saved,
 * then results brought in from a sheet. So an import never moves a find someone already has.
 */
export function walkOrder<C extends Completion>(done: C[]) {
  const t = (c: C) => c.at.getTime();
  return [...done.filter((c) => !c.imported).sort((a, b) => t(a) - t(b)), ...done.filter((c) => c.imported).sort((a, b) => t(a) - t(b))];
}

export type QuestReward = QuestEvent & { winner: { userId: string | null; name: string; status: string; at: Date; gear?: GearSnapshot | null } | null };

/**
 * Who earned each event: the person whose result moved the pawn onto that step.
 * `done` is the run's cases in the order they first got a result.
 */
export function questRewards(map: QuestMap, done: Completion[]): QuestReward[] {
  return map.events.map((e) => {
    const c = earner(done[e.step - 1]);
    return { ...e, winner: c ? { userId: c.userId, name: c.name, status: c.status, at: c.at, gear: c.gear ?? null } : null };
  });
}

/** Rewards someone has landed on. The rest stay off the map and out of the page until then. */
export function foundRewards(map: QuestMap, done: Completion[]) {
  return questRewards(map, done).filter((r): r is FoundReward => r.winner !== null);
}

export type FoundReward = QuestReward & { winner: NonNullable<QuestReward["winner"]> };

export type Satchel = { userId: string | null; name: string; finds: (FoundReward & { runNumber: number; caseNumber?: number; caseKey?: string })[] };

/**
 * Everyone's finds across quests, one satchel per person, in name order.
 * `emptiedAt` holds when each person's satchel was last emptied (an XP reset or going live); older finds are left out.
 */
export function satchels(quests: { run: { number: number }; rewards: FoundReward[]; order: { caseNumber?: number; caseKey?: string }[] }[], emptiedAt = new Map<string, Date>()): Satchel[] {
  const by = new Map<string, Satchel>();
  for (const q of quests)
    for (const r of q.rewards) {
      const since = r.winner.userId ? emptiedAt.get(r.winner.userId) : undefined;
      if (since && r.winner.at < since) continue;
      const key = r.winner.userId ?? `name:${r.winner.name}`;
      const s = by.get(key) ?? { userId: r.winner.userId, name: r.winner.name, finds: [] };
      s.finds.push({ ...r, runNumber: q.run.number, caseNumber: q.order[r.step - 1]?.caseNumber, caseKey: q.order[r.step - 1]?.caseKey });
      by.set(key, s);
    }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** How an encounter went, from the result that landed on it. A failing result still counts: it found a bug there. */
export type FoeOutcome = "defeated" | "bug" | "past";
export function foeOutcome(status: string): FoeOutcome {
  if (status === "PASSED") return "defeated";
  if (status === "FAILED") return "bug";
  return "past";
}
export const FOE_OUTCOME_LABEL: Record<FoeOutcome, string> = { defeated: "Defeated", bug: "Found a bug", past: "Slipped past" };

const itemName = (id: string | undefined) => (id ? ITEMS.find((i) => i.id === id)?.name : undefined);

/**
 * What happened at an encounter, as a sentence. With gear worn when the case was
 * saved, it names the item used: Hand on a defeat, Off hand on a bug, Head or Charm when it slipped past.
 */
export function foeLine(who: string, foe: string, status: string, gear?: GearSnapshot | null) {
  const o = foeOutcome(status);
  if (o === "defeated") {
    const it = itemName(gear?.hand);
    return it ? `${who} defeated ${foe} using the ${it}!` : `${who} defeated ${foe}`;
  }
  if (o === "bug") {
    const it = itemName(gear?.offhand);
    return it ? `${who} held off ${foe} with the ${it} and found a bug!` : `${who} met ${foe} and found a bug`;
  }
  const head = itemName(gear?.head);
  if (head) return `${who} slipped past ${foe}, hidden under the ${head}`;
  const charm = itemName(gear?.charm);
  return charm ? `${who} slipped past ${foe}, saved by the ${charm}` : `${who} slipped past ${foe}`;
}

/** Sentences end once: lines that already shout keep their "!". */
export const sentence = (line: string) => (/[.!?]$/.test(line) ? line : `${line}.`);

/** Points for the part of the trail already walked, ending at the pawn. */
export function walkedPoints(map: QuestMap, position: number) {
  const i = Math.min(position, map.nodes.length - 1);
  return [...map.trail.slice(0, map.before[i]), map.nodes[i]].map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

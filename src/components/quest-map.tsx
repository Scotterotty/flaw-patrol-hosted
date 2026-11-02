import { RARITY_STYLE } from "./rarity";
import { foeLine, RARITY_LABEL, MAP_H, MAP_W, walkedPoints, type FoundReward, type QuestMap } from "@/lib/quest";
import { itemById, pawnFill, pawnOf, pointsBehind, rescueLine, shownParty, SLOT_ANGLE, SLOTS, troubleLine, type Look, type TeamworkEvent } from "@/lib/quest-gear";
import { SEASON_INFO, type SeasonId } from "@/lib/seasons";
import { SCENERY, SeasonFx, SeasonGround, TrailLights } from "./quest-scenery";

/** A party member on the map: their look and how many cases they've saved in the run. */
export type PartyPawn = Look & { cases: number };

// The quest map: scenery, the trail, the encounters and items found so far, and
// the team's pawn. What lies ahead stays hidden until someone lands on it.
// Colors come from the theme's palette variables, so it follows light and dark.

const TREE = "var(--color-emerald-600)";
const GROUND = "var(--color-emerald-50)";

export function QuestMapView({
  map,
  steps,
  position,
  rewards,
  compact = false,
  party = [],
  me = null,
  waiting = null,
  teamwork = [],
  season = null,
}: {
  map: QuestMap;
  steps: number;
  position: number;
  rewards: FoundReward[];
  compact?: boolean;
  /** Everyone who has saved a case, latest saver first. Empty shows the plain team pawn. */
  party?: PartyPawn[];
  me?: string | null;
  /** The viewer's look: until they save a case in this run, their pawn waits faded at the start. */
  waiting?: Look | null;
  teamwork?: TeamworkEvent[];
  /** Seasonal scenery, from the day the run started. Null is the plain green map. */
  season?: SeasonId | null;
}) {
  const pawn = map.nodes[Math.min(position, map.nodes.length - 1)];
  const walked = walkedPoints(map, position);
  const done = position >= steps && steps > 0;
  const showNodes = !compact && steps <= 80;
  const wait = waiting && !done && !party.some((p) => p.userId === waiting.userId) ? waiting : null;
  const look = season ? SCENERY[season] : null;
  const trailColor = look?.trail ?? "var(--color-amber-700)";
  const end = map.nodes[map.nodes.length - 1];
  return (
    <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="h-auto w-full rounded-lg" role="img" aria-label={`${season ? `${SEASON_INFO[season].name} quest` : "Quest"} from ${map.from} to ${map.to}: ${position} of ${steps} steps`}>
      {look ? <SeasonGround look={look} decor={map.decor} uid={season!} /> : <rect width={MAP_W} height={MAP_H} rx={14} fill={GROUND} />}
      {!look && map.decor.map((d, i) => (
        <g key={i} transform={`translate(${d.x.toFixed(0)} ${d.y.toFixed(0)}) scale(${d.size.toFixed(2)})`} aria-hidden>
          {d.kind === "tree" && (
            <>
              <rect x={-2} y={4} width={4} height={8} fill="var(--color-amber-800)" />
              <circle r={10} fill={TREE} opacity={0.75} />
            </>
          )}
          {d.kind === "peak" && (
            <>
              <path d="M-16 12 L0 -14 L16 12 Z" fill="var(--color-slate-400)" />
              <path d="M-5 -6 L0 -14 L5 -6 Z" fill="var(--color-surface)" />
            </>
          )}
          {d.kind === "lake" && <ellipse rx={20} ry={10} fill="var(--color-sky-300)" opacity={0.7} />}
          {d.kind === "rock" && <circle r={5} fill="var(--color-stone-400)" />}
        </g>
      ))}

      <path d={map.path} fill="none" stroke={trailColor} strokeWidth={4} strokeDasharray="2 9" strokeLinecap="round" opacity={look ? 0.85 : 0.7} />
      {look?.lights && <TrailLights trail={map.trail} />}
      {position > 0 && (
        <polyline points={walked} fill="none" stroke="var(--color-accent-600)" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {showNodes &&
        map.nodes.slice(1, -1).map((n, i) => <circle key={i} cx={n.x} cy={n.y} r={3} fill={i + 1 <= position ? "var(--color-accent-600)" : trailColor} opacity={0.8} />)}

      {rewards.map((e) => {
        const n = map.nodes[e.step];
        return (
          <g key={e.step}>
            <title>{`${e.kind === "item" ? `${e.winner.name} found the ${e.name}` : foeLine(e.winner.name, e.name, e.winner.status, e.winner.gear)} (${RARITY_LABEL[e.rarity]})`}</title>
            <circle cx={n.x} cy={n.y} r={19} fill="var(--color-surface)" stroke={RARITY_STYLE[e.rarity].stroke} strokeWidth={e.rarity === "common" ? 2.5 : 4} />
            <text x={n.x} y={n.y + 7} textAnchor="middle" fontSize={20}>
              {e.emoji}
            </text>
          </g>
        );
      })}

      {teamwork.map((t) => {
        const n = map.nodes[t.step];
        const r = t.trouble.trouble;
        return (
          <g key={`t${t.step}`}>
            <title>{`${troubleLine(t)} ${t.helper ? rescueLine(t, undefined, undefined, map.to) : "Waiting for a teammate to help."} (${RARITY_LABEL[r.rarity]})`}</title>
            <circle cx={n.x} cy={n.y} r={19} fill="var(--color-surface)" stroke={RARITY_STYLE[r.rarity].stroke} strokeWidth={r.rarity === "common" ? 2.5 : 4} strokeDasharray="5 3" />
            <text x={n.x} y={n.y + 7} textAnchor="middle" fontSize={20}>
              {r.emoji}
            </text>
          </g>
        );
      })}

      <Place x={map.nodes[0].x} y={map.nodes[0].y} emoji="🏘️" label={map.from} season={season} />
      <Place x={end.x} y={end.y} emoji={done ? "🎉" : (look?.end ?? "🏰")} label={map.to} season={season} last />

      {wait && (
        <g opacity={0.55}>
          {(compact ? (["pawn"] as const) : (["pawn", "tag"] as const)).map((part) => (
            <PawnMark key={part} look={{ ...wait, name: "You · join by saving a case" }} x={map.nodes[0].x} y={map.nodes[0].y} scale={compact ? 0.9 : 1} mine part={part} tagAbove />
          ))}
        </g>
      )}
      {party.length === 0 ? (
        wait ? null : <g className="quest-pawn" transform={`translate(${pawn.x.toFixed(1)} ${pawn.y.toFixed(1)})`}>
          <title>{done ? "The team made it!" : `The team is on step ${position} of ${steps}`}</title>
          <ellipse cx={0} cy={4} rx={12} ry={4} fill="var(--color-slate-900)" opacity={0.25} />
          <g className="quest-pawn-bob">
            <circle cx={0} cy={-14} r={15} fill="var(--color-accent-600)" stroke="var(--color-surface)" strokeWidth={3} />
            <text x={0} y={-8} textAnchor="middle" fontSize={17}>
              ♟️
            </text>
          </g>
        </g>
      ) : (
        <Party map={map} position={position} party={party} me={me} hurt={hurtSet(teamwork)} compact={compact} />
      )}
      {look && !compact && <SeasonFx look={look} />}
    </svg>
  );
}

/** The start village or the destination. In season it gets a touch: snow on the roof, a bat and a pumpkin at the haunted house, fireworks for the new year. */
function Place({ x, y, emoji, label, season, last }: { x: number; y: number; emoji: string; label: string; season: SeasonId | null; last?: boolean }) {
  const look = season ? SCENERY[season] : null;
  return (
    <g>
      <circle cx={x} cy={y} r={24} fill="var(--color-surface)" stroke={look?.trail ?? "var(--color-amber-700)"} strokeWidth={3} />
      <text x={x} y={y + 9} textAnchor="middle" fontSize={24}>
        {emoji}
      </text>
      {look?.roofSnow && <path d={`M${x - 14} ${y - 9} q7 -6 14 -2 q7 -4 14 2`} stroke="#FFFFFF" strokeWidth={4} fill="none" strokeLinecap="round" aria-hidden />}
      {last && season === "halloween" && (
        <g aria-hidden>
          <text x={x + 22} y={y - 18} fontSize={14}>
            🦇
          </text>
          <text x={x - 34} y={y + 22} fontSize={15}>
            🎃
          </text>
        </g>
      )}
      {last && look?.lights && (
        <text x={x + 20} y={y + 24} fontSize={16} aria-hidden>
          🎆
        </text>
      )}
      <text
        x={x}
        y={y + 44}
        textAnchor="middle"
        fontSize={15}
        fontWeight={600}
        fill={look?.label ?? "var(--color-slate-800)"}
        stroke={look?.ground2 ?? "var(--color-emerald-50)"}
        strokeWidth={4}
        paintOrder="stroke"
      >
        {label}
      </text>
    </g>
  );
}

/** Who is still stuck in trouble, waiting for a teammate. */
const hurtSet = (teamwork: TeamworkEvent[]) => new Set(teamwork.filter((t) => !t.helper).map((t) => t.victim.userId ?? `name:${t.victim.name}`));

/** The party walks together: the latest saver leads, the rest follow evenly spaced along the walked trail. */
function Party({ map, position, party, me, hurt, compact }: { map: QuestMap; position: number; party: PartyPawn[]; me: string | null; hurt: Set<string>; compact: boolean }) {
  const { shown, more } = shownParty(party, me);
  const lead = map.nodes[Math.min(position, map.nodes.length - 1)];
  const behind = pointsBehind(map, position, shown.length - 1 + (more.length ? 1 : 0));
  const spots = [lead, ...behind];
  // A pawn standing on the start or finish moves its tag above it, so the place name stays readable.
  const ends = [map.nodes[0], map.nodes[map.nodes.length - 1]];
  const onPlace = (pt: { x: number; y: number }) => ends.some((e) => Math.hypot(e.x - pt.x, e.y - pt.y) < 40);
  const bubble = more.length ? spots[shown.length] : null;
  return (
    <g>
      {bubble && (
        <g transform={`translate(${bubble.x.toFixed(1)} ${bubble.y.toFixed(1)})`}>
          <title>{`Also in the party: ${more.map((p) => p.name).join(", ")}`}</title>
          <circle cx={0} cy={-14} r={14} fill="var(--color-surface)" stroke="var(--color-slate-300)" strokeWidth={2} />
          <text x={0} y={-9.5} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--color-slate-700)">
            +{more.length}
          </text>
        </g>
      )}
      {/* Drawn back to front so the leader sits on top; name tags go over every pawn so none hides another's. */}
      {(compact ? [false] : [false, true]).map((tags) =>
        shown
          .map((p, i) => ({ p, i }))
          .reverse()
          .map(({ p, i }) => (
            <PawnMark
              key={`${tags ? "t" : "p"}${p.userId ?? p.name}`}
              look={p}
              x={spots[i].x}
              y={spots[i].y}
              scale={(i === 0 ? 1.3 : 1.05) * (compact ? 0.9 : 1)}
              lead={i === 0}
              mine={!!me && p.userId === me}
              hurt={hurt.has(p.userId ?? `name:${p.name}`)}
              part={tags ? "tag" : "pawn"}
              tagAbove={onPlace(spots[i])}
            />
          )),
      )}
    </g>
  );
}

const RING = 21;

/** One pawn: emoji in a circle of its color, gear badges on an even ring, and a name tag. */
export function PawnMark({
  look,
  x,
  y,
  scale: s,
  lead,
  mine,
  hurt,
  part,
  tagAbove,
}: {
  /** Put the name tag over the pawn's head instead of under its feet. */
  tagAbove?: boolean;
  look: Look;
  x: number;
  y: number;
  scale: number;
  lead?: boolean;
  mine?: boolean;
  hurt?: boolean;
  /** Draw the pawn itself, or only its name tag (drawn in a layer above all pawns). */
  part: "pawn" | "tag";
}) {
  const worn = SLOTS.map((sl) => ({ slot: sl.id, item: itemById(look.gear[sl.id]) })).filter((w) => w.item);
  const label = hurt ? `🤢 ${look.name} · Needs help` : look.name;
  const w = label.length * 6.6 + 16;
  const tagY = tagAbove ? (-14 - RING - 8.5) * s - 21 : (RING + 8.5) * s - 14 * s + 12;
  if (part === "tag")
    return (
      <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} aria-hidden>
        <rect x={-w / 2} y={tagY} width={w} height={17} rx={8.5} fill={mine ? "var(--color-accent-600)" : "var(--color-surface)"} stroke={hurt ? "var(--st-failed)" : "var(--color-slate-200)"} />
        <text x={0} y={tagY + 12.5} textAnchor="middle" fontSize={11} fontWeight={600} fill={mine ? "#fff" : "var(--color-slate-900)"}>
          {label}
        </text>
      </g>
    );
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} className={lead ? "quest-pawn" : undefined}>
      <title>{`${look.name}${lead ? " (saved the latest case)" : ""}${hurt ? ", needs help" : ""}: ${worn.map((g) => g.item!.name).join(", ") || "no gear"}`}</title>
      <ellipse cx={0} cy={6 * s} rx={13 * s} ry={4 * s} fill="var(--color-slate-900)" opacity={0.2} />
      <g className={lead ? "quest-pawn-bob" : undefined}>
        <circle cx={0} cy={-14 * s} r={15 * s} fill={pawnFill(look.color)} stroke="var(--color-surface)" strokeWidth={3} />
        {look.pawn === "photo" && look.photo ? (
          // "My picture": the profile picture inside a ring of the pawn color.
          <>
            <clipPath id={`pawn-photo-${look.userId}-${x.toFixed(0)}`}>
              <circle cx={0} cy={-14 * s} r={12 * s} />
            </clipPath>
            <image href={look.photo} x={-12 * s} y={-26 * s} width={24 * s} height={24 * s} preserveAspectRatio="xMidYMid slice" clipPath={`url(#pawn-photo-${look.userId}-${x.toFixed(0)})`} />
          </>
        ) : (
          <text x={0} y={-8 * s} textAnchor="middle" fontSize={17 * s}>
            {pawnOf(look.pawn === "photo" ? "classic" : look.pawn).emoji}
          </text>
        )}
        {worn.map(({ slot, item }) => {
          const a = (SLOT_ANGLE[slot] * Math.PI) / 180;
          const bx = RING * Math.cos(a) * s;
          const by = (-14 + RING * Math.sin(a)) * s;
          return (
            <g key={slot}>
              <circle cx={bx.toFixed(1)} cy={by.toFixed(1)} r={8.5 * s} fill="var(--color-surface)" stroke={RARITY_STYLE[item!.rarity].stroke} strokeWidth={1.5} />
              <text x={bx.toFixed(1)} y={by.toFixed(1)} textAnchor="middle" dominantBaseline="central" fontSize={10 * s}>
                {item!.emoji}
              </text>
            </g>
          );
        })}
      </g>
    </g>
  );
}

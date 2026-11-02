import type { ReactNode } from "react";
import { MAP_H, MAP_W, seeded, type QuestMap } from "@/lib/quest";
import type { SeasonId } from "@/lib/seasons";

// Seasonal scenery for the quest map. Scenery only: the trail, encounters,
// pawns and XP are the same in every season. Fixed colors, since each season has its
// own ground (Halloween is dusk). Animation is gentle and stops for reduced motion.

type Deco = QuestMap["decor"][number];

export type Scenery = {
  ground: string;
  ground2: string;
  trail: string;
  label: string;
  tree: (i: number) => ReactNode;
  peak: ReactNode;
  lake: ReactNode;
  rock: ReactNode;
  /** Some trees become these little emoji (a pumpkin, a snowman), picked by position so a map always looks the same. */
  extras: string[];
  end: string;
  fx: "petals" | "sun" | "leaves" | "bats" | "snow";
  roofSnow?: boolean;
  lights?: boolean;
  moon?: boolean;
};

function RoundTree({ fill, trunk, dots = [] }: { fill: string; trunk: string; dots?: [number, number, string][] }) {
  return (
    <>
      <rect x={-2} y={4} width={4} height={8} fill={trunk} />
      <circle r={10} fill={fill} />
      {dots.map(([x, y, c], i) => (
        <circle key={i} cx={x} cy={y} r={2.2} fill={c} />
      ))}
    </>
  );
}

function Pine({ lit }: { lit?: boolean }) {
  return (
    <>
      <rect x={-2} y={8} width={4} height={6} fill="#6B4A2E" />
      <path d="M0 -16 L11 9 L-11 9 Z" fill="#2F6B4F" />
      <path d="M0 -16 L5 -4 L2 -6 L0 -3 L-2 -6 L-5 -4 Z" fill="#FFFFFF" />
      <path d="M-11 9 L11 9 L9 6 L4 8 L0 5 L-4 8 L-9 6 Z" fill="#FFFFFF" />
      {lit &&
        [
          [-4, 2, 0],
          [4, -3, 0.5],
          [2, 6, 1],
        ].map(([x, y, d]) => <circle key={d} cx={x} cy={y} r={1.6} fill="#FFE9A8" className="fx-twinkle" style={{ animationDelay: `${d}s` }} />)}
    </>
  );
}

function Peak({ body, cap }: { body: string; cap: string }) {
  return (
    <>
      <path d="M-16 12 L0 -14 L16 12 Z" fill={body} />
      <path d="M-5 -6 L0 -14 L5 -6 L2 -4 L0 -6 L-2 -4 Z" fill={cap} />
    </>
  );
}

const Emoji = ({ x = 0, y, size, children }: { x?: number; y: number; size: number; children: string }) => (
  <text x={x} y={y} fontSize={size} textAnchor="middle">
    {children}
  </text>
);

const FALL_LEAVES = ["#E07B2A", "#C8442B", "#E9B634", "#B5572B"];

const frozenPond = (cracks: boolean) => (
  <>
    <ellipse rx={21} ry={11} fill="#CDE6F5" stroke="#FFFFFF" strokeWidth={2} />
    {cracks && <path d="M-10 -2 l6 -3 M2 3 l8 -4" stroke="#FFFFFF" strokeWidth={1.5} />}
    <Emoji x={2} y={3} size={9}>
      ⛸️
    </Emoji>
  </>
);
const snowRock = <ellipse rx={7} ry={4} fill="#FFFFFF" stroke="#D3E0EC" />;

const winter: Scenery = {
  ground: "#EEF4FA",
  ground2: "#DCE8F3",
  trail: "#8FA6BC",
  label: "#24384C",
  tree: () => <Pine />,
  peak: <Peak body="#C9D8E6" cap="#FFFFFF" />,
  lake: frozenPond(true),
  rock: snowRock,
  extras: ["⛄", "🦊", "❄️", "🛷", "🐧", "🧣"],
  end: "🏰",
  fx: "snow",
  roofSnow: true,
};

export const SCENERY: Record<SeasonId, Scenery> = {
  spring: {
    ground: "#E6F4DA",
    ground2: "#D6EDC6",
    trail: "#B98A4E",
    label: "#2F4A2A",
    tree: (i) =>
      i % 3 === 0 ? (
        <RoundTree fill="#F4A6C0" trunk="#8A5A3B" dots={[[-4, -3, "#FFFFFF"], [3, 2, "#FFFFFF"], [4, -5, "#FFFFFF"]]} />
      ) : (
        <RoundTree fill="#6DBB63" trunk="#7A5232" dots={[[-3, -4, "#F7C8DA"], [4, 1, "#FFF3A6"]]} />
      ),
    peak: <Peak body="#9FB59A" cap="#FFFFFF" />,
    lake: (
      <>
        <ellipse rx={20} ry={10} fill="#8CCBEB" />
        <Emoji y={4} size={11}>
          🦆
        </Emoji>
      </>
    ),
    rock: (
      <>
        <circle r={5} fill="#A8A29E" />
        <circle cx={4} cy={-4} r={2.5} fill="#F7D046" />
      </>
    ),
    extras: ["🌷", "🌼", "🦋", "🐣", "🐝", "🌸"],
    end: "🏰",
    fx: "petals",
  },
  summer: {
    ground: "#E4F2C6",
    ground2: "#D3E9AC",
    trail: "#B98A4E",
    label: "#2F4A1E",
    tree: (i) =>
      i % 4 === 0 ? (
        <>
          <path d="M0 12 Q2 0 0 -8" stroke="#8A5A3B" strokeWidth={3} fill="none" />
          <path d="M0 -8 q-10 -4 -14 2 M0 -8 q10 -4 14 2 M0 -8 q-6 -8 -12 -6 M0 -8 q6 -8 12 -6" stroke="#2E8B45" strokeWidth={3.5} fill="none" strokeLinecap="round" />
        </>
      ) : (
        <RoundTree fill="#3E9B4F" trunk="#7A5232" />
      ),
    peak: <Peak body="#8FA77E" cap="#C9D9B8" />,
    lake: (
      <>
        <ellipse rx={25} ry={14} fill="#F2DFA6" />
        <ellipse rx={19} ry={9} fill="#59B7E8" />
        <Emoji x={14} y={-6} size={10}>
          ⛱️
        </Emoji>
      </>
    ),
    rock: <circle r={5} fill="#B6AFA6" />,
    extras: ["🌻", "⛱️", "🍉", "🐞", "🍦", "🐸"],
    end: "🏰",
    fx: "sun",
  },
  fall: {
    ground: "#F3E5C9",
    ground2: "#EAD5AE",
    trail: "#9C6B3A",
    label: "#4A3218",
    tree: (i) => <RoundTree fill={FALL_LEAVES[i % FALL_LEAVES.length]} trunk="#6B4A2E" />,
    peak: <Peak body="#A99A86" cap="#EFE6D6" />,
    lake: (
      <>
        <ellipse rx={20} ry={10} fill="#7FB3C9" />
        <Emoji x={-6} y={3} size={8}>
          🍁
        </Emoji>
      </>
    ),
    rock: <circle r={5} fill="#A39A8F" />,
    extras: ["🍂", "🍄", "🌰", "🦔", "🍁", "🥧"],
    end: "🏰",
    fx: "leaves",
  },
  halloween: {
    ground: "#3B2D57",
    ground2: "#2C2144",
    trail: "#F28C28",
    label: "#F6EEFF",
    tree: () => <path d="M0 12 L0 -3 M0 -1 L-8 -10 M0 -4 L7 -13 M-4 -5 L-10 -4 M3 -8 L9 -7 M-6 -8 L-6 -13" stroke="#160F22" strokeWidth={2.6} fill="none" strokeLinecap="round" />,
    peak: <Peak body="#4E4070" cap="#8A7FB0" />,
    lake: (
      <>
        <ellipse rx={20} ry={10} fill="#6BCB77" opacity={0.75} />
        <circle cx={-6} cy={-2} r={2.5} fill="#B8F5BE" className="fx-twinkle" />
        <circle cx={5} cy={1} r={1.8} fill="#B8F5BE" className="fx-twinkle" style={{ animationDelay: "0.7s" }} />
      </>
    ),
    rock: (
      <>
        <path d="M-6 8 L-6 -3 A6 6 0 0 1 6 -3 L6 8 Z" fill="#9A93B4" />
        <path d="M-2.5 -1 h5 M0 -3.5 v6" stroke="#5E5778" strokeWidth={1.4} />
      </>
    ),
    extras: ["🎃", "👻", "🕸️", "🍬", "🕯️", "🎃", "🦇", "🍭"],
    end: "🏚️",
    fx: "bats",
    moon: true,
  },
  winter,
  lights: {
    ...winter,
    tree: (i) => <Pine lit={i % 2 === 0} />,
    lake: frozenPond(false),
    extras: ["🎁", "☕", "⛄", "🧤", "🎁", "🍪", "❄️", "🦉"],
    lights: true,
  },
};

/** Gradient ids depend only on the season, so several maps of one season can share them. The ground, the sky touches (moon, sun) and every bit of decor. Every third tree becomes one of the season's extras. */
export function SeasonGround({ look, decor, uid }: { look: Scenery; decor: Deco[]; uid: string }) {
  return (
    <>
      <defs>
        <radialGradient id={`ground-${uid}`} cx="50%" cy="45%" r="70%">
          <stop offset="0" stopColor={look.ground} />
          <stop offset="1" stopColor={look.ground2} />
        </radialGradient>
        <radialGradient id={`glow-${uid}`}>
          <stop offset="0" stopColor="#FFF6C9" stopOpacity={0.9} />
          <stop offset="1" stopColor="#FFF6C9" stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect width={MAP_W} height={MAP_H} rx={14} fill={`url(#ground-${uid})`} />
      {look.moon && (
        <g aria-hidden>
          <circle cx={MAP_W - 95} cy={80} r={90} fill={`url(#glow-${uid})`} className="fx-glow" />
          <circle cx={MAP_W - 95} cy={80} r={38} fill="#F5E6A8" />
          <circle cx={MAP_W - 107} cy={70} r={6} fill="#E3D08C" />
          <circle cx={MAP_W - 83} cy={92} r={4} fill="#E3D08C" />
        </g>
      )}
      {look.fx === "sun" && (
        <g transform={`translate(${MAP_W - 75} 70)`} aria-hidden>
          <circle r={54} fill="#FFE27A" opacity={0.35} className="fx-glow" />
          <circle r={30} fill="#FFD23F" />
        </g>
      )}
      {decor.map((d, i) => {
        const extra = d.kind === "tree" && i % 3 === 2 ? look.extras[i % look.extras.length] : null;
        return (
          <g key={i} transform={`translate(${d.x.toFixed(0)} ${d.y.toFixed(0)}) scale(${d.size.toFixed(2)})`} aria-hidden>
            {extra ? (
              <text y={7} fontSize={18} textAnchor="middle" className={extra === "👻" ? "fx-bob" : undefined}>
                {extra}
              </text>
            ) : d.kind === "tree" ? (
              look.tree(i)
            ) : (
              look[d.kind]
            )}
          </g>
        );
      })}
    </>
  );
}

/** Winter lights: a string of twinkling lights along the trail. */
export function TrailLights({ trail }: { trail: { x: number; y: number }[] }) {
  const colors = ["#F5C542", "#FF9F6B", "#7FD3F0", "#C9A7FF"];
  const out: ReactNode[] = [];
  // About one bulb every 24 map units, whatever the trail's sampling.
  let gap = 0;
  let n = 0;
  for (let i = 1; i < trail.length - 1; i++) {
    const p = trail[i - 1];
    const q = trail[i];
    gap += Math.hypot(q.x - p.x, q.y - p.y);
    if (gap < 24) continue;
    gap = 0;
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const side = n % 2 ? 1 : -1;
    const nx = (-(q.y - p.y) / len) * 9 * side;
    const ny = ((q.x - p.x) / len) * 9 * side;
    out.push(<circle key={i} cx={(q.x + nx).toFixed(1)} cy={(q.y + ny).toFixed(1)} r={3.2} fill={colors[n % 4]} className="fx-twinkle" style={{ animationDelay: `${((n * 3) % 7) * 0.2}s` }} />);
    n++;
  }
  return <g aria-hidden>{out}</g>;
}

/** Things that drift across the map: snow, leaves, petals, or a few bats. Not on the small maps. */
export function SeasonFx({ look }: { look: Scenery }) {
  const r = seeded("season-fx");
  const out: ReactNode[] = [];
  if (look.fx === "snow")
    for (let i = 0; i < 46; i++)
      out.push(
        <circle
          key={i}
          className="fx-fall"
          cx={(r() * MAP_W).toFixed(0)}
          cy={0}
          r={(2 + r() * 2.6).toFixed(1)}
          fill="#FFFFFF"
          stroke="#C5D6E6"
          strokeWidth={0.6}
          style={{ animationDuration: `${(8 + r() * 8).toFixed(1)}s`, animationDelay: `-${(r() * 14).toFixed(1)}s`, ["--drift" as string]: `${(r() * 60 - 30).toFixed(0)}px` }}
        />,
      );
  else if (look.fx === "leaves" || look.fx === "petals") {
    const em = look.fx === "leaves" ? ["🍂", "🍁"] : ["🌸"];
    for (let i = 0; i < 16; i++)
      out.push(
        <text
          key={i}
          className="fx-fall"
          x={(r() * MAP_W).toFixed(0)}
          y={0}
          fontSize={(12 + r() * 6).toFixed(0)}
          style={{ animationDuration: `${(10 + r() * 8).toFixed(1)}s`, animationDelay: `-${(r() * 16).toFixed(1)}s`, ["--drift" as string]: `${(r() * 120 - 40).toFixed(0)}px` }}
        >
          {em[i % em.length]}
        </text>,
      );
  } else if (look.fx === "bats")
    for (let i = 0; i < 3; i++)
      out.push(
        <text key={i} className="fx-fly" x={0} y={60 + i * 46} fontSize={18} style={{ animationDuration: `${11 + i * 4}s`, animationDelay: `-${i * 5}s` }}>
          🦇
        </text>,
      );
  return (
    <g aria-hidden pointerEvents="none" className="fx-layer">
      {out}
    </g>
  );
}

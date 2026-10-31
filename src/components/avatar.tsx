import { cx } from "./ui";

export type AvatarPerson = {
  id: string;
  name: string | null;
  email?: string | null;
  avatarAt?: Date | string | null;
  // From the mini game (badgeOf in src/lib/game.ts); null when they don't play.
  frame?: string | null;
  title?: string | null;
};

// Avatar frames unlocked in the mini game. Keep in sync with FRAMES in src/lib/game.ts.
export const FRAME_STYLES: Record<string, string> = {
  bronze: "linear-gradient(135deg, #8c5a2b, #e3a869 45%, #b87333 60%, #6e4420)",
  silver: "linear-gradient(135deg, #6b7280, #f3f4f6 45%, #a1a1aa 60%, #52525b)",
  gold: "linear-gradient(135deg, #a16207, #fde047 45%, #eab308 60%, #854d0e)",
  holo: "conic-gradient(#f0abfc, #93c5fd, #86efac, #fde68a, #fca5a5, #f0abfc)",
  ink: "conic-gradient(#1e1b4b, #7c3aed, #c084fc, #4c1d95, #1e1b4b)",
  bug: "repeating-conic-gradient(#dc2626 0 12.5%, #16a34a 0 25%)",
  // Early adopters: a turning pearly ring with twinkling stars (.frame-fresh in globals.css).
  fresh: "conic-gradient(from var(--fresh-turn, 0deg), #10b981, #a7f3d0, #3b82f6, #e879f9, #fde047, #ffffff, #10b981)",
  // Glossary (ver_113): page edges, like a well-thumbed book.
  bookworm: "repeating-conic-gradient(#7c4a1e 0 6deg, #f5e6c8 6deg 12deg)",
};
const FRAME_CLASS: Record<string, string> = { fresh: "frame-fresh" };

// Background colors for initials, chosen to keep white text readable.
const COLORS = ["#7c3aed", "#2563eb", "#0f766e", "#15803d", "#b45309", "#be123c", "#4338ca", "#a21caf"];

function initials(label: string) {
  const parts = label.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** A person's picture, or their initials on a color that's stable for them. */
export function Avatar({ person, size = 24, className }: { person: AvatarPerson; size?: number; className?: string }) {
  const frame = person.frame ? FRAME_STYLES[person.frame] : undefined;
  if (!frame) return <Face person={person} size={size} className={className} />;
  const pad = size >= 40 ? 3 : 2;
  return (
    <span className={cx("relative inline-flex shrink-0 rounded-full", FRAME_CLASS[person.frame!], className)} style={{ background: frame, padding: pad }}>
      <Face person={person} size={size - pad * 2} className="ring-1 ring-surface" />
    </span>
  );
}

function Face({ person, size, className }: { person: AvatarPerson; size: number; className?: string }) {
  const label = person.name || person.email || "?";
  const style = { width: size, height: size };
  if (person.avatarAt) {
    const v = new Date(person.avatarAt).getTime();
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/avatars/${person.id}?v=${v}`} alt="" title={label} style={style} className={cx("inline-block shrink-0 rounded-full object-cover", className)} />;
  }
  return (
    <span
      aria-hidden="true"
      title={label}
      style={{ ...style, background: colorFor(person.id), fontSize: Math.max(9, Math.round(size * 0.4)) }}
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none", className)}
    >
      {initials(label)}
    </span>
  );
}

/** Picture and name together. */
export function PersonLabel({ person, size = 20, className }: { person: AvatarPerson; size?: number; className?: string }) {
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1.5", className)}>
      <Avatar person={person} size={size} />
      <span className="truncate">
        {person.name || person.email}
        {person.title && <span className="text-slate-500"> · {person.title}</span>}
      </span>
    </span>
  );
}

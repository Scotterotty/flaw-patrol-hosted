import "server-only";
import type { UmbrellaEntry } from "@/components/projects-browser";
import { relativeTime } from "./format";
import { can } from "./permissions";
import { lastActivity } from "./project-visits";
import type { Spelling } from "./spelling";
import type { Timing } from "./timing";
import { loadUmbrella, parseShortcuts, type Umbrella } from "./umbrella";
import { defaultShortcuts, freshShortcut, rcGlance, shortcutChoices } from "./umbrella-pages";

type Viewer = Parameters<typeof loadUmbrella>[1];
type Row = { id: string; pins: { starred: boolean; position: number | null; hidden: boolean }[] };

/**
 * The Umbrellas page's cards, all umbrellas at once (ver_100), with one last-activity
 * lookup for them and for the page's other test cycles (`activityIds`), returned as `activity`.
 */
export async function umbrellaCards(user: Viewer, rows: Row[], activityIds: string[], spelling: Spelling, now: Date, t: Timing) {
  const loaded = await Promise.all(rows.map((row) => t.step((u) => `${u?.group.name ?? "hidden umbrella"}: basics`, loadUmbrella(row.id, user))));
  const ids = [...new Set([...activityIds, ...loaded.flatMap((u) => (u ? [u.hub.id, ...u.projects.map((p) => p.id)] : []))])];
  const [activity, choiceSets] = await Promise.all([
    t.step("last activity (all at once)", lastActivity(ids)),
    Promise.all(loaded.map((u) => u && t.step(`${u.group.name}: release line + shortcuts`, shortcutChoices(u, rcGlance(u))))),
  ]);
  const cards: UmbrellaEntry[] = [];
  loaded.forEach((u, i) => {
    if (u) cards.push(card(u, rows[i], choiceSets[i]!, activity, spelling, now));
  });
  return { cards, activity };
}

function card(u: Umbrella, row: Row, choices: Awaited<ReturnType<typeof shortcutChoices>>, activity: Map<string, Date>, spelling: Spelling, now: Date): UmbrellaEntry {
  const at = [u.hub.id, ...u.projects.map((p) => p.id)]
    .map((id) => activity.get(id))
    .filter((d): d is Date => !!d)
    .reduce<number | null>((m, d) => Math.max(m ?? 0, d.getTime()), null);
  const fresh = new Map(choices.flatMap((c) => c.items).map((i) => [i.href, i]));
  const picked = parseShortcuts(u.group.shortcuts).map((s) => freshShortcut(u, s));
  return {
    id: u.group.id,
    name: u.group.name,
    tagline: `Umbrella · ${at ? `Last activity ${relativeTime(new Date(at), spelling, now)}` : "No activity yet"}`,
    // Counts in a shortcut's subtitle are refreshed from the page it points at.
    shortcuts: (picked.length ? picked : defaultShortcuts(u)).map((s) => ({
      ...s,
      sub: fresh.get(s.href)?.sub ?? s.sub,
    })),
    choices: can(u.who, "umbrella:shortcuts") ? choices : null,
    archived: !!u.group.archivedAt,
    // A bug bash on now (ver_93): the card says so, with Join.
    live: u.live ? { href: `/p/${u.hub.key}/bashes/${u.live.id}?join=1`, endsAt: u.live.endsAt } : null,
    restore: u.group.archivedAt && can(u.who, "umbrella:archive") ? u.current.filter((p) => p.archivedWithUmbrella).map((p) => p.name) : null,
    starred: row.pins[0]?.starred ?? false,
    position: row.pins[0]?.position ?? null,
    hidden: row.pins[0]?.hidden ?? false,
    canArchive: can(u.who, "umbrella:archive"),
    // Move into an umbrella… only offers umbrellas where you may add a test cycle (ver_127).
    canAddCycle: can(u.who, "cycle:create"),
    activity: at,
    cycles: u.projects.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      archived: !!p.archivedAt,
    })),
  };
}

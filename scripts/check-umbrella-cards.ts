// Umbrellas page card check (ver_100): for every person in the database, builds each
// umbrella card the old way (one umbrella after another, the full Release status report
// for the release line, last activity per umbrella) and the ver_100 way, and fails unless
// every card matches exactly. Also checks the release line against the umbrella's own
// Release status report for every umbrella, and last activity for every project.
//
// Run: npm run check:cards (DATABASE_URL picks the database; e2e:all runs it on the test database).
import { isDeepStrictEqual } from "node:util";
import { db } from "@/lib/db";
import { relativeTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { lastActivity } from "@/lib/project-visits";
import { stateOf } from "@/lib/rc-status";
import { spellingFor } from "@/lib/spelling";
import { startTiming } from "@/lib/timing";
import { loadUmbrella, parseShortcuts, type Umbrella } from "@/lib/umbrella";
import { umbrellaCards } from "@/lib/umbrella-cards";
import { defaultShortcuts, freshShortcut, rcGlance, shortcutChoices } from "@/lib/umbrella-pages";
import { listReleases, rcStatus } from "@/server/rc-status";

/** The release line before ver_100: the whole Release status report. */
async function oldGlance(u: Umbrella) {
  const scope = { projectIds: [u.hub.id, ...u.projects.map((p) => p.id)], addAnywhere: false };
  const viewer = { id: "", isAdmin: true };
  const [latest] = await listReleases(viewer, scope);
  if (!latest) return "No releases yet";
  const { columns } = await rcStatus(viewer, latest, { hide: [], add: [] }, scope);
  return `${latest} · ${columns.filter((c) => stateOf(c).label === "DONE").length} of ${columns.length} done`;
}

/** Last activity before ver_100. */
async function oldActivity(projectIds: string[]) {
  if (!projectIds.length) return new Map<string, Date>();
  const rows = await db.$queryRaw<{ id: string; at: Date | null }[]>`
    select p.id, greatest(
      (select max("updatedAt") from "TestCase" where "projectId" = p.id),
      (select max("createdAt") from "TestRun" where "projectId" = p.id),
      (select max(t."createdAt") from "TestResult" t join "TestRun" r on r.id = t."runId" where r."projectId" = p.id)
    ) as at
    from "Project" p where p.id = any(${projectIds})`;
  return new Map(rows.filter((r) => r.at).map((r) => [r.id, r.at!]));
}

/** The card loop from src/app/page.tsx before ver_100, word for word apart from the release line. */
async function oldCards(user: { id: string; isAdmin: boolean }, rows: { id: string; pins: { starred: boolean; position: number | null; hidden: boolean }[] }[], spelling: ReturnType<typeof spellingFor>, now: Date) {
  const umbrellas = [];
  for (const row of rows) {
    const u = await loadUmbrella(row.id, user);
    if (!u) continue;
    const at = [...(await oldActivity([u.hub.id, ...u.projects.map((p) => p.id)])).values()].reduce<number | null>((m, d) => Math.max(m ?? 0, d.getTime()), null);
    const choices = await shortcutChoices(u, await oldGlance(u));
    const fresh = new Map(choices.flatMap((c) => c.items).map((i) => [i.href, i]));
    const picked = parseShortcuts(u.group.shortcuts).map((s) => freshShortcut(u, s));
    umbrellas.push({
      id: u.group.id,
      name: u.group.name,
      tagline: `Umbrella · ${at ? `Last activity ${relativeTime(new Date(at), spelling, now)}` : "No activity yet"}`,
      shortcuts: (picked.length ? picked : defaultShortcuts(u)).map((s) => ({ ...s, sub: fresh.get(s.href)?.sub ?? s.sub })),
      choices: can(u.who, "umbrella:shortcuts") ? choices : null,
      archived: !!u.group.archivedAt,
      live: u.live ? { href: `/p/${u.hub.key}/bashes/${u.live.id}?join=1`, endsAt: u.live.endsAt } : null,
      restore: u.group.archivedAt && can(u.who, "umbrella:archive") ? u.current.filter((p) => p.archivedWithUmbrella).map((p) => p.name) : null,
      starred: row.pins[0]?.starred ?? false,
      position: row.pins[0]?.position ?? null,
      hidden: row.pins[0]?.hidden ?? false,
      canArchive: can(u.who, "umbrella:archive"),
      activity: at,
      cycles: u.projects.map((p) => ({ id: p.id, key: p.key, name: p.name, archived: !!p.archivedAt })),
    });
  }
  return umbrellas;
}

async function main() {
  const problems: string[] = [];
  const now = new Date();
  let cards = 0;
  let lines = 0;

  // 1. Every umbrella's release line, old vs new, as a workspace admin sees it.
  const admin = { id: "", isAdmin: true };
  for (const g of await db.projectGroup.findMany({ where: { hubProjectId: { not: null } }, select: { id: true } })) {
    const u = await loadUmbrella(g.id, admin);
    if (!u) continue;
    const [before, after] = await Promise.all([oldGlance(u), rcGlance(u)]);
    lines++;
    if (before !== after) problems.push(`Release line for ${u.group.name}: old "${before}", new "${after}"`);
  }

  // 2. Last activity for every project.
  const ids = (await db.project.findMany({ select: { id: true } })).map((p) => p.id);
  const [a, b] = await Promise.all([oldActivity(ids), lastActivity(ids)]);
  for (const id of ids) if (a.get(id)?.getTime() !== b.get(id)?.getTime()) problems.push(`Last activity for project ${id}: old ${a.get(id)?.toISOString()}, new ${b.get(id)?.toISOString()}`);

  // 3. Every person's whole set of cards.
  const users = await db.user.findMany({ select: { id: true, email: true, isAdmin: true, spelling: true } });
  for (const user of users) {
    const rows = await db.projectGroup.findMany({
      where: { hubProjectId: { not: null }, ...(user.isAdmin ? {} : { hub: { members: { some: { userId: user.id } } } }) },
      orderBy: { name: "asc" },
      select: { id: true, pins: { where: { userId: user.id } } },
    });
    const spelling = spellingFor(user.spelling);
    const before = await oldCards(user, rows, spelling, now);
    const { cards: after } = await umbrellaCards(user, rows, [], spelling, now, startTiming("check"));
    cards += after.length;
    if (!isDeepStrictEqual(before, after)) {
      for (let i = 0; i < Math.max(before.length, after.length); i++)
        if (!isDeepStrictEqual(before[i], after[i])) problems.push(`${user.email}: card ${before[i]?.name ?? after[i]?.name} differs\n  old ${JSON.stringify(before[i])}\n  new ${JSON.stringify(after[i])}`);
    }
  }

  console.log(`Checked ${lines} release lines, ${ids.length} projects' last activity and ${cards} cards for ${users.length} people.`);
  if (problems.length) {
    console.log(`✗ ${problems.length} differences:\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log("✓ Every umbrella card is the same the old way and the new way.");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

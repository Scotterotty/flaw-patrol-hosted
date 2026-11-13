import Link from "next/link";
import { runTag, runTitle } from "@/lib/run-label";
import { RunName } from "@/components/run-name";
import { PastQuests } from "@/components/past-quests";
import { QuestMapView } from "@/components/quest-map";
import { RARITY_STYLE } from "@/components/rarity";
import { YourPawnCard } from "@/components/your-pawn";
import { SatchelCard, type LoggedEncounter, type SatchelItem } from "@/components/satchel";
import { Card, cx, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { caseKey } from "@/lib/format";
import { foeLine, FOE_OUTCOME_LABEL, foeOutcome, ITEMS, RARITIES, RARITY_LABEL, satchels, sentence, type Rarity, type Satchel } from "@/lib/quest";
import { nearestItem, partiesFor, questRecordFor, questsFor } from "@/lib/quest-data";
import { fitsOf, isSlot, parseGear, PAWNS, pawnUnlocked, photoUrl, type Look } from "@/lib/quest-gear";
import { projectAccess } from "@/lib/session";
import { seasonFor } from "@/lib/seasons";
import { QuestOff } from "./quest-off";
import { DelveDoor } from "@/components/delve-door";

export const metadata = { title: "Quest map" };

/** Past quests shown as maps; older ones go in a collapsed, searchable list. */
const RECENT_PAST = 4;

export default async function QuestsPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ gear?: string }> }) {
  const { key } = await params;
  const { gear: openGear } = await searchParams;
  const { project, user } = await projectAccess(key);
  if (!(user.gameEnabled && user.questMap)) return <QuestOff />;
  const quests = await questsFor(project.id, 200);
  const winners = [...new Set(quests.flatMap((q) => q.finds.map((r) => r.winner.userId)).filter((id): id is string => !!id))];
  const resets = await db.user.findMany({ where: { id: { in: winners }, xpSince: { not: null } }, select: { id: true, xpSince: true } });
  const bags = satchels(
    quests.map((q) => ({ ...q, rewards: q.finds })),
    new Map(resets.map((u) => [u.id, u.xpSince!])),
  );
  const mine = bags.find((b) => b.userId === user.id);
  const team = bags.filter((b) => b !== mine);
  const runName = new Map(quests.map((q) => [q.run.number, runTitle(q.run)]));
  const where = (f: Find) => `${runName.get(f.runNumber) ?? "A run"}${f.caseNumber ? ` · ${f.caseKey ?? caseKey(project.key, f.caseNumber)}` : ""}`;
  const active = quests.filter((q) => q.run.state === "ACTIVE");
  const finished = quests.filter((q) => q.run.state !== "ACTIVE");
  const parties = await partiesFor([...active, ...finished.slice(0, RECENT_PAST)]);
  // Gear is yours across every project, so Change gear lists everything you've found anywhere.
  const record = await questRecordFor(user.id);
  const owned = ITEMS.filter((i) => record.items.has(i.id))
    .sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity))
    .map((i) => ({ id: i.id, name: i.name, emoji: i.emoji, rarity: i.rarity, count: record.items.get(i.id)!, fits: fitsOf(i.id) }));
  // With nothing in the satchel, Change gear points at the closest item still lying on a road.
  const nearest = owned.length ? null : await nearestItem(user.id, user.isAdmin);
  const gear = {
    worn: parseGear(user.questGear),
    auto: user.questGearAuto.filter(isSlot),
    nearest: nearest && {
      line: nearest.best ? `${nearest.best.runName}, ${nearest.best.away === 1 ? "1 case" : `${nearest.best.away} cases`} away` : null,
      href: nearest.best ? `/p/${nearest.best.projectKey}/quests/${nearest.best.runNumber}` : null,
      anyRuns: nearest.hasRuns,
    },
    owned,
    pawn: user.questPawn,
    color: user.questColor,
    photo: photoUrl(user.id, user.avatarAt),
    unlocked: PAWNS.filter((p) => pawnUnlocked(p.id, record)).map((p) => p.id),
    teamwork: record.teamwork,
    me: { name: user.name ?? user.email, userId: user.id },
  };
  // How you look on maps you haven't joined yet (waiting at the start).
  const look = { userId: user.id, name: user.name ?? user.email, pawn: user.questPawn, color: user.questColor, gear: gear.worn, photo: gear.photo };

  return (
    <div className="page page-list">
      <DelveDoor />
      <PageHeader title="Quest map" subtitle="Every test run is a quest. Each case that gets a result moves the team's pawn a step." />
      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-5">
          {quests.length === 0 && <EmptyState title="No quests yet">Start a test run and its map appears here.</EmptyState>}
          {active.length > 0 && <QuestGrid title="On the road" projectKey={project.key} quests={active} parties={parties} me={user.id} look={look} seasonal={user.seasonalMaps} />}
          {finished.length > 0 && <QuestGrid title="Past quests" projectKey={project.key} quests={finished.slice(0, RECENT_PAST)} parties={parties} me={user.id} look={look} seasonal={user.seasonalMaps} />}
          {finished.length > RECENT_PAST && (
            <PastQuests
              projectKey={project.key}
              rows={finished.slice(RECENT_PAST).map((q) => ({
                number: q.run.number,
                name: q.run.name,
                tag: runTag(q.run),
                release: q.run.release,
                from: q.map.from,
                to: q.map.to,
                steps: q.steps,
                position: q.position,
                found: q.rewards.length,
              }))}
            />
          )}
        </div>
        <aside className="space-y-4">
          <YourPawnCard gear={gear} openGear={openGear === "1"} />
          <Card className="p-4" role="region" aria-labelledby="satchel-heading">
            <h2 id="satchel-heading" className="text-sm font-semibold text-slate-800">
              Your satchel
            </h2>
            <SatchelCard projectKey={project.key} {...split(mine?.finds ?? [], where)} />
          </Card>
          {team.length > 0 && (
            <Card className="p-4" role="region" aria-labelledby="team-satchels-heading">
              <h2 id="team-satchels-heading" className="text-sm font-semibold text-slate-800">
                Team
              </h2>
              <ul className="mt-2 divide-y divide-slate-100 text-sm">
                {team.map((b) => {
                  const { items, encounters } = split(b.finds, where);
                  return (
                    <li key={b.userId ?? b.name} aria-label={`${b.name}'s satchel`} className="py-2 first:pt-0 last:pb-0">
                      <span className="block text-slate-800">{b.name}</span>
                      <TeamRow label="Items" projectKey={project.key} finds={items.map((i) => ({ ...i, what: `${i.name}${i.count > 1 ? ` ×${i.count}` : ""}` }))} />
                      <TeamRow
                        label="Encounters"
                        projectKey={project.key}
                        finds={encounters.map((e) => ({ ...e, id: e.key, count: 1, what: `${e.name}, ${FOE_OUTCOME_LABEL[e.outcome].toLowerCase()}` }))}
                      />
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

type Find = Satchel["finds"][number];

/**
 * A satchel's finds as the two lists it shows: items stacked by kind (rarest
 * first, linking the newest run), and every encounter on its own, newest first.
 */
function split(finds: Find[], where: (f: Find) => string): { items: SatchelItem[]; encounters: LoggedEncounter[] } {
  const by = new Map<string, SatchelItem>();
  const newest = [...finds].sort((a, b) => b.winner.at.getTime() - a.winner.at.getTime() || b.runNumber - a.runNumber);
  for (const f of newest.filter((f) => f.kind === "item")) {
    const seen = by.get(f.id);
    if (seen) seen.count++;
    else by.set(f.id, { id: f.id, name: f.name, emoji: f.emoji, rarity: f.rarity, count: 1, runNumber: f.runNumber, where: where(f) });
  }
  const items = [...by.values()].sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity));
  const encounters = newest
    .filter((f) => f.kind === "foe")
    .map((f) => ({
      key: `${f.runNumber}:${f.step}`,
      name: f.name,
      emoji: f.emoji,
      rarity: f.rarity,
      outcome: foeOutcome(f.winner.status),
      line: sentence(foeLine(f.winner.name, f.name, f.winner.status, f.winner.gear)),
      runNumber: f.runNumber,
      where: where(f),
    }));
  return { items, encounters };
}

/** Up to five finds as small tiles, then "+N" for the rest. */
const TEAM_ROW = 5;
function TeamRow({ label, projectKey, finds }: { label: string; projectKey: string; finds: { id: string; emoji: string; rarity: Rarity; count: number; runNumber: number; what: string }[] }) {
  return (
    <span className="mt-1 flex items-center gap-1.5">
      <span className="w-[4.5rem] shrink-0 text-xs text-slate-500">{label}</span>
      {finds.length === 0 ? (
        <span className="text-xs text-slate-400">None yet</span>
      ) : (
        <span className="flex flex-wrap items-center gap-1.5">
          {finds.slice(0, TEAM_ROW).map((f) => {
            const what = `${f.what} · ${RARITY_LABEL[f.rarity]}`;
            return (
              <Link
                key={f.id}
                href={`/p/${projectKey}/quests/${f.runNumber}`}
                title={what}
                aria-label={what}
                className={cx("relative rounded-md bg-slate-100 px-1 text-base leading-6 ring-2 ring-inset hover:bg-accent-100", RARITY_STYLE[f.rarity].ring)}
              >
                {f.emoji}
                {f.count > 1 && (
                  <span className="absolute -right-1.5 -bottom-1.5 rounded-full bg-slate-700 px-1 text-[11px] leading-4 font-semibold text-slate-50 tabular-nums" aria-hidden>
                    {f.count}
                  </span>
                )}
              </Link>
            );
          })}
          {finds.length > TEAM_ROW && <span className="text-xs text-slate-500 tabular-nums">+{finds.length - TEAM_ROW}</span>}
        </span>
      )}
    </span>
  );
}

function QuestGrid({
  title,
  projectKey,
  quests,
  parties,
  me,
  look,
  seasonal,
}: {
  title: string;
  projectKey: string;
  quests: Awaited<ReturnType<typeof questsFor>>;
  parties: Awaited<ReturnType<typeof partiesFor>>;
  me: string;
  look: Look;
  seasonal: boolean;
}) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {quests.map((q) => (
          <Link key={q.run.id} href={`/p/${projectKey}/quests/${q.run.number}`} className="group">
            <Card className="overflow-hidden transition group-hover:border-accent-500 group-hover:shadow">
              <QuestMapView map={q.map} steps={q.steps} position={q.position} rewards={q.rewards} compact party={parties.get(q.run.id)} me={me} waiting={look} teamwork={q.teamwork} season={seasonal ? seasonFor(q.run.createdAt) : null} />
              <div className="p-3">
                <p className="truncate text-sm font-medium text-slate-900">
                  <RunName run={q.run} />
                </p>
                <p className="text-xs text-slate-500">
                  {q.map.from} to {q.map.to} · {q.position} of {q.steps} steps · {q.rewards.length} found
                </p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

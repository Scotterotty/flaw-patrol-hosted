import Link from "next/link";
import { RunName } from "@/components/run-name";
import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/live-refresh";
import { QuestMapView } from "@/components/quest-map";
import { Card, EmptyState, LinkButton } from "@/components/ui";
import { caseKey } from "@/lib/format";
import { RarityBadge } from "@/components/rarity";
import { foeLine, LUCKIEST_RUN, rarityOdds, sentence } from "@/lib/quest";
import { partyLooks, questForRun } from "@/lib/quest-data";
import { parseGear, pawnFill, photoUrl, rescueLine, troubleLine } from "@/lib/quest-gear";
import { PawnFace } from "@/components/pawn-face";
import { cx } from "@/components/ui";
import { projectAccess } from "@/lib/session";
import { seasonFor } from "@/lib/seasons";
import { QuestOff } from "../quest-off";

export const metadata = { title: "Quest" };

/** "a 1%", "a 0.23%", or "less than a 0.01%" chance. */
const chance = (p: number) => (p < 0.0001 ? "less than a 0.01%" : `a ${(p * 100).toFixed(p >= 0.01 ? 0 : p >= 0.001 ? 1 : 2)}%`);

export default async function QuestPage({ params }: { params: Promise<{ key: string; number: string }> }) {
  const { key, number } = await params;
  const { project, user } = await projectAccess(key);
  if (!(user.gameEnabled && user.questMap)) return <QuestOff />;
  const n = Number(number);
  if (!Number.isInteger(n)) notFound();
  const q = await questForRun(project.id, n);
  if (!q) notFound();
  if (q.run.automated)
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState title="No quest for this run">
          Automated runs don&apos;t go on a quest. Only cases people test move the pawn.
          <span className="mt-3 block">
            <LinkButton href={`/p/${project.key}/runs/${q.run.number}`}>Open the run</LinkButton>
          </span>
        </EmptyState>
      </div>
    );
  const done = q.steps > 0 && q.position >= q.steps;
  const last = q.order[q.order.length - 1];
  const party = await partyLooks(q.order);
  // Finds and encounters, and teamwork events, in the order they happened along the road.
  const along = [...q.rewards.map((r) => ({ step: r.step, r, t: null })), ...q.teamwork.map((t) => ({ step: t.step, r: null, t }))].sort((a, b) => a.step - b.step);

  return (
    <div className="mx-auto max-w-6xl">
      <LiveRefresh url={`/api/live/runs/${q.run.id}`} />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            <RunName run={q.run} className="font-mono text-base font-normal text-slate-500" />
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {q.map.from} to {q.map.to} · {q.position} of {q.steps} steps
            {q.run.release && ` · ${q.run.release}`}
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton href={`/p/${project.key}/runs/${q.run.number}`}>Open the run</LinkButton>
          {q.run.state === "ACTIVE" && !done && (
            <LinkButton variant="primary" href={`/p/${project.key}/runs/${q.run.number}/execute`}>
              Take the next step
            </LinkButton>
          )}
        </div>
      </div>

      {done && (
        <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          🎉 The team reached {q.map.to}!{last && ` ${last.name} took the final step.`}
        </p>
      )}

      <Card className="p-2">
        <QuestMapView
          map={q.map}
          steps={q.steps}
          position={q.position}
          rewards={q.rewards}
          party={party}
          me={user.id}
          waiting={{ userId: user.id, name: user.name ?? user.email, pawn: user.questPawn, color: user.questColor, gear: parseGear(user.questGear), photo: photoUrl(user.id, user.avatarAt) }}
          teamwork={q.teamwork}
          season={user.seasonalMaps ? seasonFor(q.run.createdAt) : null}
        />
        {party.length > 0 && (
          <ul aria-label="The party" className="flex flex-wrap gap-2 px-2 pt-2 pb-1">
            {party.map((p, i) => (
              <li
                key={p.userId ?? p.name}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-xs font-semibold",
                  p.userId === user.id ? "border-accent-500 bg-accent-50 text-slate-900" : "border-slate-200 text-slate-800",
                )}
              >
                <span aria-hidden className="grid size-6 place-items-center overflow-hidden rounded-full text-sm" style={{ background: pawnFill(p.color) }}>
                  <PawnFace pawn={p.pawn} photo={p.photo} />
                </span>
                {p.name}
                <span className="font-normal text-slate-500">
                  {i === 0 && "leading · "}
                  {p.cases} {p.cases === 1 ? "case" : "cases"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-5 p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">Along the way</h2>
        {along.length === 0 ? (
          <p className="text-sm text-slate-500">
            {done ? "A quiet road: nothing turned up on this one." : "Nothing found yet. Who knows what waits around the next bend?"}
          </p>
        ) : (
          <ol className="divide-y divide-slate-100 text-sm">
            {along.map(({ step, r, t }) => {
              const c = q.order[step - 1];
              if (t)
                return (
                  <li key={`t${step}`} className="flex items-center gap-3 py-2">
                    <span className="w-14 shrink-0 text-xs text-slate-500 tabular-nums">Step {step}</span>
                    <span className="text-lg leading-none" aria-hidden>
                      {t.trouble.trouble.emoji}
                    </span>
                    <span className="min-w-0 flex-1 text-slate-800">
                      {troubleLine(t)}
                      <span className="block text-xs text-slate-500">
                        {t.helper ? `${t.self ? "🩹" : "🤝"} ${rescueLine(t, undefined, undefined, q.map.to)}` : "🤢 Needs help: the next teammate to save a case comes to the rescue."}
                      </span>
                    </span>
                    <span className={cx("shrink-0 text-xs font-semibold", t.helper ? (t.self ? "text-accent-700" : "text-emerald-700") : "text-red-700")}>
                      {t.helper ? (t.self ? "Self-rescue" : "Rescued") : "Needs help"}
                    </span>
                    <RarityBadge rarity={t.trouble.trouble.rarity} className="shrink-0" />
                    {c && <span className="shrink-0 font-mono text-xs text-slate-500">{c.caseKey ?? caseKey(project.key, c.caseNumber)}</span>}
                  </li>
                );
              const who = r!.winner.userId === user.id ? "You" : r!.winner.name;
              return (
                <li key={step} className="flex items-center gap-3 py-2">
                  <span className="w-14 shrink-0 text-xs text-slate-500 tabular-nums">Step {step}</span>
                  <span className="text-lg leading-none" aria-hidden>
                    {r!.emoji}
                  </span>
                  <span className="min-w-0 flex-1 text-slate-800">{r!.kind === "item" ? `${who} found the ${r!.name}.` : sentence(foeLine(who, r!.name, r!.winner.status, r!.winner.gear))}</span>
                  <RarityBadge rarity={r!.rarity} className="shrink-0" />
                  {c && <span className="shrink-0 font-mono text-xs text-slate-500">{c.caseKey ?? caseKey(project.key, c.caseNumber)}</span>}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-500">
        Encounters, items and trouble stay hidden until the pawn lands on them, and go to whoever saved that case here (results brought in from a spreadsheet move the pawn but find nothing). Whoever saves the next case after someone lands in trouble rescues them and gets a thank-you find. Longer runs find rarer things:
        on this {q.steps}-step road each find has {chance(rarityOdds(q.steps).exotic)} chance of being Exotic
        {q.steps < LUCKIEST_RUN ? ` (best odds from ${LUCKIEST_RUN} cases up).` : ", the best odds there are."} <Link href={`/p/${project.key}/quests`} className="text-accent-700 hover:underline">All quests and the team&apos;s satchels</Link>
      </p>
    </div>
  );
}

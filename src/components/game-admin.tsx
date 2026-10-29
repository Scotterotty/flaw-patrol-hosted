"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { launchGame, resetXp } from "@/server/game-admin";
import { Badge, Button, Card, ErrorText, Input } from "./ui";

const CONFIRM = "GO LIVE";

type Person = { id: string; name: string; playing: boolean; xp: number; level: number; early: boolean; resetAt: string | null };

export function GameAdmin({ people, launchedAt }: { people: Person[]; launchedAt: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, question?: string) => {
    if (question && !window.confirm(question)) return;
    setError(null);
    start(async () => {
      const r = await action();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
      else router.refresh();
    });
  };

  return (
    <Card id="game-admin" className="scroll-mt-28 p-5" role="region" aria-labelledby="game-admin-heading">
      <h2 id="game-admin-heading" className="mb-1 text-sm font-semibold text-slate-800">
        Mini game admin
      </h2>
      <p className="mb-4 text-xs text-slate-500">
        Only workspace admins see this. A reset takes someone&apos;s XP back to 0, empties their quest satchel and clears the titles and frames they picked; the Early Adopter title and Early Adopter Shine frame stay.
      </p>

      <div className="mb-4 rounded-lg border border-slate-200 p-3 text-sm">
        {launchedAt ? (
          <p className="text-slate-700">
            Went live on <span className="font-medium">{launchedAt}</span>. Everyone who had signed in by then is an Early Adopter.
          </p>
        ) : (
          <>
            <p className="text-slate-700">
              Not live yet. Until you go live, everyone who signs in counts as an Early Adopter. Going live starts everyone&apos;s XP again from 0 and locks in the
              Early Adopter title for the people who signed in before then. It can only be done once.
            </p>
            {confirming ? (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3">
                <p className="text-sm font-medium text-red-800">This can&apos;t be undone.</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-red-800">
                  <li>Everyone&apos;s XP goes back to 0, satchels are emptied, and the titles and frames they picked are cleared.</li>
                  <li>The {people.filter((p) => p.early).length} people who have signed in so far keep the Early Adopter title and Early Adopter Shine frame. Nobody else can get them after this.</li>
                </ul>
                <label htmlFor="go-live-confirm" className="mt-3 block text-xs font-medium text-red-900">
                  Type {CONFIRM} to confirm
                </label>
                <Input id="go-live-confirm" className="mt-1 max-w-48" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={pending || typed.trim().toUpperCase() !== CONFIRM}
                    onClick={() => run(() => launchGame(typed))}
                  >
                    Go live now
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      setConfirming(false);
                      setTyped("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button className="mt-2" size="sm" disabled={pending} onClick={() => setConfirming(true)}>
                Go live…
              </Button>
            )}
          </>
        )}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1 font-medium">Person</th>
            <th className="py-1 font-medium">XP</th>
            <th className="py-1 font-medium">Level</th>
            <th className="py-1">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {people.map((p) => (
            <tr key={p.id}>
              <td className="py-1.5 pr-2">
                <span className="text-slate-800">{p.name}</span>
                <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
                  {!p.playing && <Badge>Not playing</Badge>}
                  {p.early && <Badge tone="violet">Early Adopter</Badge>}
                </span>
                {p.resetAt && <span className="block text-xs text-slate-500">Reset on {p.resetAt}</span>}
              </td>
              <td className="py-1.5 tabular-nums">{p.xp}</td>
              <td className="py-1.5 tabular-nums">{p.level}</td>
              <td className="py-1.5 text-right">
                <Button size="sm" disabled={pending} aria-label={`Reset ${p.name}'s XP`} onClick={() => run(() => resetXp(p.id), `Reset ${p.name}'s XP to 0 and empty their satchel?`)}>
                  Reset
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button className="mt-3" size="sm" variant="danger" disabled={pending} onClick={() => run(() => resetXp(null), "Reset everyone's XP to 0 and empty every satchel?")}>
        Reset everyone&apos;s XP and satchels
      </Button>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
    </Card>
  );
}

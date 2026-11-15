"use client";

import type { Role } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { relativeTime } from "@/lib/format";
import { ROLE_LABEL, ROLES_PICK } from "@/lib/permissions";
import { answerAskToBeAdded } from "@/server/workspace-join";
import { Avatar } from "./avatar";
import { Button, Card, ErrorText, Select } from "./ui";

export type WaitingPerson = { id: string; userId: string; name: string | null; email: string; avatarAt: string | null; at: string };

/**
 * Workspace settings → Waiting to be added (ver_259): people who signed in, aren't on any
 * umbrella, and pressed Ask to be added on the welcome page. Pick the umbrella and role, then Add.
 * Only shows while someone is waiting.
 */
export function WorkspaceWaiting({ people, umbrellas }: { people: WaitingPerson[]; umbrellas: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [places, setPlaces] = useState<Record<string, string>>({});
  const answer = (id: string, add: boolean) =>
    start(async () => {
      const r = await answerAskToBeAdded(id, { add, groupId: places[id] || undefined, role: roles[id] ?? "TESTER" });
      if (!r.ok) return setError(r.error);
      setError(null);
      router.refresh();
    });
  return (
    <Card id="waiting" className="scroll-mt-28 p-5 ring-2 ring-accent-200" role="region" aria-labelledby="waiting-heading">
      <h2 id="waiting-heading" className="text-sm font-semibold text-slate-800">
        Waiting to be added
      </h2>
      <p className="mt-0.5 text-sm text-slate-600">They signed in but aren&apos;t on an umbrella yet. Pick where they belong and press Add.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <ul className="mt-3 divide-y divide-slate-200">
        {people.map((p, i) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" data-testid="waiting-person">
            <span className="flex min-w-0 flex-1 basis-56 items-center gap-2">
              <Avatar person={{ id: p.userId, name: p.name, email: p.email, avatarAt: p.avatarAt }} size={28} />
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-900">{p.name || p.email}</span>
                <span className="block truncate text-xs text-slate-500" suppressHydrationWarning>
                  {p.name ? `${p.email} · ` : ""}asked {relativeTime(new Date(p.at))}
                </span>
              </span>
            </span>
            {umbrellas.length ? (
              <>
                <Select
                  aria-label={`Umbrella for ${p.name || p.email}`}
                  data-howto={i === 0 ? "waiting-umbrella" : undefined}
                  className="h-8 w-auto max-w-full text-xs"
                  value={places[p.id] ?? ""}
                  disabled={pending}
                  onChange={(e) => setPlaces((s) => ({ ...s, [p.id]: e.target.value }))}
                >
                  <option value="">Pick an umbrella</option>
                  {umbrellas.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
                <Select aria-label={`Role for ${p.name || p.email}`} className="h-8 w-auto max-w-full text-xs" value={roles[p.id] ?? "TESTER"} disabled={pending} onChange={(e) => setRoles((r) => ({ ...r, [p.id]: e.target.value as Role }))}>
                  {ROLES_PICK.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="primary" disabled={pending || !places[p.id]} onClick={() => answer(p.id, true)} data-howto={i === 0 ? "waiting-add" : undefined}>
                  Add
                </Button>
              </>
            ) : (
              <span className="text-xs text-slate-500">Make an umbrella first, then add them to it.</span>
            )}
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => answer(p.id, false)}>
              Ignore
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

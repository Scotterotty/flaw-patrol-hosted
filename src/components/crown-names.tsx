"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setCrownNames } from "@/server/umbrella";
import { Button, ErrorText, Input } from "./ui";

/**
 * Mini game crowns (ver_96): an optional crown name per platform, so "Web" can read
 * "Ruler of the Web". Blank keeps "Ruler of <platform>".
 */
export function CrownNamesPanel({ groupId, platforms, canEdit }: { groupId: string; platforms: { name: string; crownName?: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [names, setNames] = useState(() => Object.fromEntries(platforms.map((p) => [p.name, p.crownName ?? ""])));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!platforms.length) return <p className="text-sm text-slate-500">Add platforms first: each one gets its own crown.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        People who play the mini game hold a crown for doing the most in the last 30 days: one for each platform, one for each big Case library folder, plus Bug Bash Champion, Trailblazer and Sharp Eye.
      </p>
      <ul className="space-y-2">
        {platforms.map((p) => (
          <li key={p.name} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-sm font-medium text-slate-800">{p.name}</span>
            <Input
              aria-label={`Crown name for ${p.name}`}
              value={names[p.name]}
              disabled={!canEdit}
              placeholder={`Ruler of ${p.name}`}
              maxLength={40}
              onChange={(e) => (setNames((n) => ({ ...n, [p.name]: e.target.value })), setSaved(false))}
              className="h-8"
            />
          </li>
        ))}
      </ul>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {canEdit && (
        <div className="flex items-center justify-end gap-2">
          {saved && <span className="text-xs text-slate-500">Saved</span>}
          <Button
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await setCrownNames(groupId, names);
                if (!r.ok) return setError(r.error);
                setSaved(true);
                router.refresh();
              })
            }
          >
            Save crown names
          </Button>
        </div>
      )}
    </div>
  );
}

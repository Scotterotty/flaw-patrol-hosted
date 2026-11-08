"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { keepEveryoneOpen } from "@/server/roles";
import { Button, ErrorText, LinkButton } from "./ui";

/**
 * The before-invite reminder, admins only, until they save What can they do once
 * or press Keep everyone open: people they add can use every feature except archive,
 * delete and connections, so tighten it first if they want.
 */
export function RolesNudge({ target, href }: { target: { groupId: string } | { projectId: string }; href: string }) {
  const router = useRouter();
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (gone) return null;
  return (
    <div className="my-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900" data-testid="roles-nudge">
      <p>
        <span aria-hidden className="mr-1.5 inline-grid size-[18px] place-items-center rounded-full bg-sky-600 text-[11px] font-bold text-white">
          i
        </span>
        <span className="font-semibold">Before you invite:</span> people you add can use every feature except archive, delete and connections. Want it tighter? Set it first.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <LinkButton size="sm" href={href}>
          Choose what roles can do
        </LinkButton>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await keepEveryoneOpen(target);
              if (!r.ok) return setError(r.error);
              setGone(true);
              router.refresh();
            })
          }
        >
          Keep everyone open
        </Button>
      </div>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
    </div>
  );
}

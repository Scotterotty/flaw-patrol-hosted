"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { askForMemberAccess } from "@/server/join-requests";
import { ErrorText } from "./ui";

/**
 * At the top of every page for a Viewer (ver_124, persona audit #6): what they can do here,
 * who can change it, and Ask for Member access. ✕ hides it on this device until their role changes.
 */
export function ViewerNote({ projectId, teamId, team, admins, asked }: { projectId: string; teamId: string; team: string; admins: string; asked: boolean }) {
  const key = `fp:viewer-note:${teamId}`;
  const [hidden, setHidden] = useState(true);
  const [done, setDone] = useState(asked);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(key) === "1");
    } catch {
      setHidden(false);
    }
  }, [key]);
  if (hidden) return null;
  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(key, "1");
    } catch {}
  };
  return (
    <div role="note" data-testid="viewer-note" className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 ring-1 ring-sky-200 ring-inset">
      <p className="min-w-0 flex-1">
        <b>You&apos;re a Viewer in {team}.</b> You can see everything here and join bug bashes. To run tests or edit cases, ask an admin{admins ? ` (${admins})` : ""}.{" "}
        {done ? (
          <span className="font-medium">You asked for Member access. An admin will see it in Members.</span>
        ) : (
          <button
            type="button"
            disabled={pending}
            className="font-medium text-sky-800 underline hover:text-sky-950"
            onClick={() =>
              start(async () => {
                const res = await askForMemberAccess(projectId, path);
                if (!res.ok) return setError(res.error);
                setDone(true);
                router.refresh();
              })
            }
          >
            {pending ? "Asking…" : "Ask for Member access"}
          </button>
        )}
      </p>
      <button type="button" aria-label="Hide this note" onClick={close} className="shrink-0 rounded px-1 text-sky-700 hover:bg-sky-100">
        ✕
      </button>
      {error && (
        <div className="w-full">
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        </div>
      )}
    </div>
  );
}

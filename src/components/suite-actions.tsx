"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { renameSuite, setSuiteArchived } from "@/server/suites";
import { ErrorText } from "./error-text";
import { Modal } from "./modal";
import { Button, Field, Input } from "./ui";

export function ArchiveSuiteButton({ projectId, suiteId, archived }: { projectId: string; suiteId: string; archived: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      className={archived ? undefined : "text-red-700"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setSuiteArchived(projectId, suiteId, !archived);
          router.refresh();
        })
      }
    >
      {archived ? "Restore suite" : "Archive suite"}
    </Button>
  );
}

/**
 * Rename a suite in a small box. `look` picks the opener: a "✎ Rename" link by the title, or a
 * full-width item in a ⋯ / More menu. `otherNames` are the project's other suite names, for a gentle
 * same-name warning; `sharedWith` is how many test cycles also run this umbrella suite.
 */
export function RenameSuiteButton({
  projectId,
  suiteId,
  name,
  otherNames = [],
  sharedWith = 0,
  look,
}: {
  projectId: string;
  suiteId: string;
  name: string;
  otherNames?: string[];
  sharedWith?: number;
  look: "pencil" | "menu";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const trimmed = value.trim();
  const twin = trimmed && trimmed !== name && otherNames.some((n) => n.trim().toLowerCase() === trimmed.toLowerCase());
  const tooLong = trimmed.length > 200;

  const show = () => {
    setValue(name);
    setError(null);
    setOpen(true);
  };
  const save = () =>
    start(async () => {
      if (!trimmed) return setError("Give the suite a name.");
      if (tooLong) return setError("Keep the name under 200 characters.");
      if (trimmed === name) return setOpen(false);
      const res = await renameSuite(projectId, suiteId, trimmed);
      if (!res.ok) return setError(res.error);
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      {look === "pencil" ? (
        <button
          type="button"
          onClick={show}
          aria-label="Rename suite"
          title="Rename suite"
          className="rounded-md px-1.5 py-0.5 text-sm font-normal text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-accent-500"
        >
          <span aria-hidden>✎</span> Rename
        </button>
      ) : (
        <Button variant="ghost" role="menuitem" onClick={show}>
          Rename suite…
        </Button>
      )}
      <Modal open={open} onClose={() => !pending && setOpen(false)} title="Rename suite" locked={pending}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field label="Name" htmlFor={`rename-suite-${suiteId}`}>
            <Input
              id={`rename-suite-${suiteId}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              autoFocus
              maxLength={250}
            />
          </Field>
          {twin && (
            <p className="text-sm text-amber-700" data-testid="rename-twin">
              Another suite is already called {trimmed}. You can still save.
            </p>
          )}
          {tooLong && <p className="text-sm text-red-700">Keep the name under 200 characters.</p>}
          {sharedWith > 0 && (
            <p className="text-sm text-slate-600">
              Shared with {sharedWith} {sharedWith === 1 ? "test cycle" : "test cycles"}. They all see the new name.
            </p>
          )}
          <p className="text-sm text-slate-500">Old runs show the name they ran under next to the new one. The cases don&apos;t change.</p>
          {error && <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !trimmed || tooLong}>
              {pending ? "Saving…" : "Save name"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { listClients } from "@/lib/clients";
import { saveCaseClients } from "@/server/clients";
import { Button, ErrorText } from "./ui";

// Clients (ver_214): on a case's page, which of its test cycles' clients it is tested on.

export function CaseClients({ projectId, caseId, all, picked, guessed, canEdit }: { projectId: string; caseId: string; all: string[]; picked: string[]; guessed: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [ticked, setTicked] = useState(picked);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await saveCaseClients(projectId, caseId, ticked);
      if (!r.ok) return setError(r.error);
      setEditing(false);
      setError(null);
      setNote(r.updated ? `Saved. ${r.updated} open ${r.updated === 1 ? "run" : "runs"} not started on this case use it now.` : "Saved. Runs you start from now on use it.");
      router.refresh();
    });
  return (
    <div data-testid="case-clients" data-howto="case-clients">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Clients</h2>
        {canEdit && !editing && (
          <Button size="sm" variant="ghost" onClick={() => (setTicked(picked), setEditing(true), setNote(""))}>
            Change
          </Button>
        )}
      </div>
      {editing ? (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-sm text-slate-600">Test this case on:</legend>
          {all.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm text-slate-800">
              <input type="checkbox" checked={ticked.includes(c)} onChange={(e) => setTicked(e.target.checked ? all.filter((x) => x === c || ticked.includes(x)) : ticked.filter((x) => x !== c))} />
              {c}
            </label>
          ))}
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="primary" disabled={pending || !ticked.length} onClick={save}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </fieldset>
      ) : (
        <p className="text-sm text-slate-800">
          {listClients(picked)}
          {guessed && <span className="block text-xs text-slate-500">Guessed from the case&apos;s words.</span>}
        </p>
      )}
      {note && (
        <p role="status" className="mt-1 text-xs text-emerald-700">
          ✓ {note}
        </p>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

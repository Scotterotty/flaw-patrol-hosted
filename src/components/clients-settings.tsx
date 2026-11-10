"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cleanClients, MAX_CLIENT_NAME, MAX_CLIENTS } from "@/lib/clients";
import { saveCycleClients } from "@/server/clients";
import { Button, ErrorText, Input } from "./ui";

// Clients (ver_214): Settings → a test cycle → Clients. The apps or devices each case is tested on.
// Runs started after saving run each case once per client and open on a client grid.

export function ClientsSettings({ projectId, clients, canChange, cycle }: { projectId: string; clients: string[]; canChange: boolean; cycle: string }) {
  const router = useRouter();
  const [list, setList] = useState(clients);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const changed = JSON.stringify(list) !== JSON.stringify(clients);

  const add = () => {
    const name = typed.trim();
    if (!name) return;
    if (list.some((c) => c.toLowerCase() === name.toLowerCase())) return setError(`${name} is already on the list.`);
    if (list.length >= MAX_CLIENTS) return setError(`A test cycle can have up to ${MAX_CLIENTS} clients.`);
    setList(cleanClients([...list, name]));
    setTyped("");
    setError(null);
    setSaved(false);
  };
  const move = (i: number, by: -1 | 1) => {
    const next = [...list];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setList(next);
    setSaved(false);
  };
  const save = () =>
    start(async () => {
      const r = await saveCycleClients(projectId, list);
      if (!r.ok) return setError(r.error);
      setList(r.clients);
      setSaved(true);
      router.refresh();
    });

  return (
    <div className="space-y-3" data-testid="clients-settings" data-howto="settings-clients">
      <p className="text-sm text-slate-600">
        Test each case on more than one app or device, like a demo dry run on Web, Unreal and Unity iOS. Runs you start after saving show a grid with a column for each client.
      </p>
      {list.length > 0 ? (
        <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label={`Clients for ${cycle}`}>
          {list.map((c, i) => (
            <li key={c} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="w-5 text-right text-xs text-slate-400">{i + 1}</span>
              <span className="flex-1 font-medium text-slate-800">{c}</span>
              {canChange && (
                <>
                  <Button size="sm" variant="ghost" aria-label={`Move ${c} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Move ${c} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${c}`}
                    onClick={() => {
                      setList(list.filter((x) => x !== c));
                      setSaved(false);
                    }}
                  >
                    Remove
                  </Button>
                </>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">No clients. Each case runs once, as usual.</p>
      )}
      {canChange && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label className="sr-only" htmlFor={`client-add-${projectId}`}>
            New client
          </label>
          <Input id={`client-add-${projectId}`} value={typed} maxLength={MAX_CLIENT_NAME} onChange={(e) => setTyped(e.target.value)} placeholder="Add a client, like Web" className="w-56" data-howto="client-add" />
          <Button type="submit" size="sm" disabled={!typed.trim()}>
            Add client
          </Button>
          <Button size="sm" variant="primary" className="ml-auto" disabled={!changed || pending} onClick={save} data-howto="clients-save">
            {pending ? "Saving…" : "Save clients"}
          </Button>
        </form>
      )}
      {saved && !changed && (
        <p role="status" className="text-sm text-emerald-700">
          ✓ Saved. {list.length ? "Runs you start from now on test each case on these clients." : "New runs test each case once."} Runs already going stay as they are.
        </p>
      )}
      <p className="text-xs text-slate-500">Flaw Patrol guesses which clients each case covers from its words, like &quot;Web - Move an asset&quot;. Change it on the case if the guess is wrong.</p>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { WatchedBuild } from "@/lib/teamcity-config";
import { disconnectTeamCity, saveTeamCity, teamcityBuildTypes } from "@/server/teamcity";
import { Button, ErrorText, Field, InfoTip, Input } from "./ui";

// Umbrella Settings → TeamCity (ver_228): the server address, a read-only access token and the
// builds to watch on the Status page. The token never comes back to the browser.

export type TeamCitySaved = { baseUrl: string; buildTypes: WatchedBuild[]; tokenReadable: boolean };

export function TeamCityPanel({ groupId, saved, canEdit, statusHref }: { groupId: string; saved: TeamCitySaved | null; canEdit: boolean; statusHref: string }) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "");
  const [token, setToken] = useState("");
  const [all, setAll] = useState<WatchedBuild[] | null>(saved ? saved.buildTypes : null);
  const [picked, setPicked] = useState<Set<string>>(new Set(saved?.buildTypes.map((b) => b.id) ?? []));
  const [find, setFind] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      setError(null);
      setDone(null);
      const res = await teamcityBuildTypes(groupId, { baseUrl, token });
      if (!res.ok) return setError(res.error);
      setBaseUrl(res.baseUrl);
      // Builds already watched stay listed (and ticked) even if this token can't see them now.
      const kept = (saved?.buildTypes ?? []).filter((b) => !res.buildTypes.some((x) => x.id === b.id) && picked.has(b.id));
      setAll([...res.buildTypes, ...kept]);
      setPicked((p) => new Set([...p].filter((id) => res.buildTypes.some((b) => b.id === id) || kept.some((b) => b.id === id))));
    });

  const save = () =>
    start(async () => {
      setError(null);
      setDone(null);
      const res = await saveTeamCity(groupId, { baseUrl, token, buildTypes: (all ?? []).filter((b) => picked.has(b.id)) });
      if (!res.ok) return setError(res.error);
      setToken("");
      setDone(`✓ Saved. Watching ${res.count} ${res.count === 1 ? "build" : "builds"} on Status.`);
      router.refresh();
    });

  const disconnect = () =>
    start(async () => {
      const res = await disconnectTeamCity(groupId);
      if (!res.ok) return setError(res.error);
      setConfirmOff(false);
      setAll(null);
      setPicked(new Set());
      setBaseUrl("");
      router.refresh();
    });

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return (all ?? []).filter((b) => !q || `${b.project} ${b.name} ${b.id}`.toLowerCase().includes(q));
  }, [all, find]);

  if (!canEdit)
    return (
      <p className="text-sm text-slate-600" data-testid="teamcity-panel">
        {saved ? `Watching ${saved.buildTypes.map((b) => b.name).join(", ") || "no builds yet"} on ${saved.baseUrl}. An Admin can change this.` : "Not connected. An Admin can connect TeamCity here."}
      </p>
    );

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4" data-testid="teamcity-panel">
      <p className="text-sm text-slate-600">Flaw Patrol only reads builds from TeamCity and never changes anything there. Each picked build gets a card on Status.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {saved && !saved.tokenReadable && <p className="text-sm text-amber-800">The saved token can&apos;t be read here (it was saved with a different AUTH_SECRET). Paste it again.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Server address" htmlFor="tc-url">
          <Input id="tc-url" data-howto="teamcity-url" type="url" inputMode="url" autoComplete="off" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://teamcity.example.com" />
        </Field>
        <Field label="Access token" htmlFor="tc-token" hint={saved ? "Leave empty to keep the saved token." : undefined}>
          <span className="flex items-center gap-1.5">
            <Input id="tc-token" data-howto="teamcity-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={saved ? "••••••••" : "Paste the token"} />
            <InfoTip text="Make one in TeamCity: your name (top right) → Profile → Access Tokens → Create access token. A token from someone who can only view builds is enough. Saved encrypted, like the Jira token, and only used by the server." />
          </span>
        </Field>
      </div>
      <Button onClick={load} disabled={pending || !baseUrl.trim() || (!token.trim() && !saved)} data-howto="teamcity-load">
        {pending && !all ? "Checking…" : all ? "Load the build list again" : "Check and load builds"}
      </Button>

      {all && (
        <fieldset className="space-y-2" data-howto="teamcity-builds">
          <legend className="mb-1 text-sm font-medium text-slate-700">Builds to watch ({picked.size} picked)</legend>
          {all.length > 8 && <Input aria-label="Find a build" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a build" className="max-w-sm" />}
          <ul className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
            {shown.map((b) => (
              <li key={b.id}>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 size-4 accent-accent-600" checked={picked.has(b.id)} onChange={() => toggle(b.id)} />
                  <span>
                    <span className="text-slate-900">{b.name}</span>
                    {b.project && <span className="text-slate-500"> · {b.project}</span>}
                  </span>
                </label>
              </li>
            ))}
            {!shown.length && <li className="text-sm text-slate-500">No builds match.</li>}
          </ul>
        </fieldset>
      )}

      {all && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={save} disabled={pending || !picked.size} data-howto="teamcity-save">
            {pending ? "Saving…" : saved ? "Save" : "Save and connect"}
          </Button>
          {saved && (
            <Link href={statusHref} className="text-sm font-medium text-accent-700 hover:underline">
              Open Status →
            </Link>
          )}
          {done && (
            <span className="text-sm text-emerald-700" role="status">
              {done}
            </span>
          )}
        </div>
      )}

      {saved &&
        (confirmOff ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            <span className="flex-1">Stop watching TeamCity? Its cards leave Status. Nothing changes in TeamCity.</span>
            <Button size="sm" variant="danger" onClick={disconnect} disabled={pending}>
              Disconnect
            </Button>
            <Button size="sm" onClick={() => setConfirmOff(false)}>
              Keep it
            </Button>
          </div>
        ) : (
          <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => setConfirmOff(true)}>
            Disconnect TeamCity
          </button>
        ))}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { QASE_SENDABLE, QASE_STATUS_LABEL, QASE_STATUSES, type QaseSendable } from "@/lib/qase-map";
import { STATUS_LABEL } from "@/lib/status";
import { disconnectQase, qaseProjects, saveQase } from "@/server/qase";
import { Button, ErrorText, Field, InfoTip, Input, Select } from "./ui";

// Umbrella Settings → Qase (ver_164): connect, pick what to share, and how results match up.

export type QaseSaved = {
  projectCode: string;
  projectTitle: string;
  send: boolean;
  bring: boolean;
  statusMap: Record<QaseSendable, string>;
  tokenReadable: boolean;
  hookPath: string;
};

export function QasePanel({ groupId, saved, linkHref, links, canEdit }: { groupId: string; saved: QaseSaved | null; linkHref: string; links: { linked: number; total: number } | null; canEdit: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<{ code: string; title: string }[] | null>(saved ? [{ code: saved.projectCode, title: saved.projectTitle }] : null);
  const [code, setCode] = useState(saved?.projectCode ?? "");
  const [send, setSend] = useState(saved?.send ?? true);
  const [bring, setBring] = useState(saved?.bring ?? true);
  const [map, setMap] = useState<Record<QaseSendable, string>>(saved?.statusMap ?? { PASSED: "passed", FAILED: "failed", BLOCKED: "blocked", RETEST: "blocked", SKIPPED: "skipped" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => setOrigin(window.location.origin), []);

  const load = () =>
    start(async () => {
      setError(null);
      setDone(null);
      const res = await qaseProjects(groupId, token);
      if (!res.ok) return setError(res.error);
      setProjects(res.projects);
      if (!res.projects.some((p) => p.code === code)) setCode(res.projects.length === 1 ? res.projects[0].code : "");
    });

  const save = () =>
    start(async () => {
      setError(null);
      setDone(null);
      const res = await saveQase(groupId, { token, projectCode: code, send, bring, statusMap: map as never });
      if (!res.ok) return setError(res.error);
      setToken("");
      setDone(`✓ Connected to Qase project ${res.projectTitle} (${res.code}).`);
      router.refresh();
    });

  const disconnect = () =>
    start(async () => {
      const res = await disconnectQase(groupId);
      if (!res.ok) return setError(res.error);
      setConfirmOff(false);
      setProjects(null);
      setCode("");
      router.refresh();
    });

  const hook = saved ? `${origin}${saved.hookPath}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hook);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  if (!canEdit)
    return (
      <p className="text-sm text-slate-600" data-testid="qase-panel">
        {saved ? `Shares results with Qase project ${saved.projectTitle} (${saved.projectCode}). An admin or lead can change this.` : "Not connected. An admin or lead can connect Qase here."}
      </p>
    );

  return (
    <div className="space-y-4" data-testid="qase-panel">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {saved && !saved.tokenReadable && <p className="text-sm text-amber-800">The saved token can&apos;t be read here (it was saved with a different AUTH_SECRET). Paste it again.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Qase API token" htmlFor="qase-token" hint={saved ? "Leave empty to keep the saved token." : undefined}>
          <span className="flex items-center gap-1.5">
            <Input id="qase-token" data-howto="qase-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={saved ? "••••••••" : "Paste the token"} />
            <InfoTip text="Make one in Qase: click your avatar → API tokens → Create a new API token. Results sent from here show in Qase under that token's person. Saved encrypted, like the Jira token." />
          </span>
        </Field>
        <Field label="Qase project" htmlFor="qase-project">
          {projects ? (
            <Select id="qase-project" value={code} onChange={(e) => setCode(e.target.value)}>
              {!code && <option value="">Pick a project…</option>}
              {projects.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.title} (code {p.code})
                </option>
              ))}
            </Select>
          ) : (
            <Button onClick={load} disabled={pending || !token.trim()} data-howto="qase-load">
              {pending ? "Checking…" : "Check token and load projects"}
            </Button>
          )}
        </Field>
      </div>
      {projects && saved && (
        <button type="button" className="text-xs text-accent-700 hover:underline" onClick={load} disabled={pending}>
          Load the project list again
        </button>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">What to share</legend>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" role="switch" className="mt-0.5 size-4 accent-accent-600" checked={send} onChange={(e) => setSend(e.target.checked)} data-testid="qase-send" />
          <span>
            <b className="text-slate-900">Send Flaw Patrol results to Qase</b> <span className="text-slate-500">as soon as someone saves a result</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" role="switch" className="mt-0.5 size-4 accent-accent-600" checked={bring} onChange={(e) => setBring(e.target.checked)} data-testid="qase-bring" />
          <span>
            <b className="text-slate-900">Bring Qase results into Flaw Patrol</b> <span className="text-slate-500">into the current test cycle</span>
          </span>
        </label>
      </fieldset>

      <details className="text-sm">
        <summary className="cursor-pointer text-slate-600">How results match up ({QASE_SENDABLE.filter((s) => map[s] !== s.toLowerCase()).map((s) => `${STATUS_LABEL[s]} → ${QASE_STATUS_LABEL[map[s]]}`).join(", ") || "same names"}) · Change</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1 pr-6 font-medium">Flaw Patrol</th>
                <th className="py-1 font-medium">Sent to Qase as</th>
              </tr>
            </thead>
            <tbody>
              {QASE_SENDABLE.map((s) => (
                <tr key={s}>
                  <td className="py-1 pr-6">
                    <label htmlFor={`qase-map-${s}`}>{STATUS_LABEL[s]}</label>
                  </td>
                  <td className="py-1">
                    <Select id={`qase-map-${s}`} value={map[s]} onChange={(e) => setMap({ ...map, [s]: e.target.value })} className="w-auto min-w-40">
                      {[...QASE_STATUSES, ""].map((q) => (
                        <option key={q} value={q}>
                          {QASE_STATUS_LABEL[q]}
                        </option>
                      ))}
                    </Select>
                  </td>
                </tr>
              ))}
              <tr>
                <td className="py-1 pr-6 text-slate-500">Untested, Explored</td>
                <td className="py-1 text-slate-500">Not sent</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Coming in from Qase: Passed, Failed, Blocked and Skipped keep their names, and Invalid becomes Retest.</p>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={save} disabled={pending || !code} data-howto="qase-save">
          {pending ? "Saving…" : saved ? "Save" : "Save and connect"}
        </Button>
        {saved && (
          <Link href={linkHref} className="text-sm font-medium text-accent-700 hover:underline" data-testid="qase-link-cases" data-howto="qase-link-cases">
            Link cases{links ? ` · ${links.linked} of ${links.total} linked` : ""} →
          </Link>
        )}
        {done && (
          <span className="text-sm text-emerald-700" role="status">
            {done}
          </span>
        )}
      </div>

      {saved && (
        <div className="space-y-1 border-t border-slate-100 pt-3 text-sm">
          <p className="text-slate-600">
            <b className="text-slate-800">Instant results from Qase</b> (optional, once Flaw Patrol is on a server Qase can reach): in Qase, open Settings → Webhooks, add this link and tick the result and run events. Until then, Qase results come in when someone opens a test cycle or clicks Sync now.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700" data-testid="qase-hook">
              {hook}
            </code>
            <Button size="sm" onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>
      )}

      {saved &&
        (confirmOff ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            <span className="flex-1">Stop sharing with Qase? Case links are forgotten. Results already shared stay in both tools.</span>
            <Button size="sm" variant="danger" onClick={disconnect} disabled={pending}>
              Disconnect
            </Button>
            <Button size="sm" onClick={() => setConfirmOff(false)}>
              Keep it
            </Button>
          </div>
        ) : (
          <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => setConfirmOff(true)}>
            Disconnect Qase
          </button>
        ))}
    </div>
  );
}

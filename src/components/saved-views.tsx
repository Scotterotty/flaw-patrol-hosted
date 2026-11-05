"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteReportView, saveReportView } from "@/server/saved-reports";
import { Button, cx, ErrorText, Input } from "./ui";

export type SavedView = { id: string; name: string; query: string; shared: boolean; createdByName: string; canDelete: boolean };

/** Named report filters: open one in a click, save the current filters, or copy a link to them. */
export function SavedViews({ projectId, views, current }: { projectId: string; views: SavedView[]; current: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveReportView(projectId, { name, query: current, shared });
      if (!r.ok) return setError(r.error);
      setSaving(false);
      setName("");
      router.refresh();
    });

  const remove = (v: SavedView) => {
    if (!window.confirm(`Delete the saved view "${v.name}"${v.shared ? " for everyone" : ""}?`)) return;
    start(async () => {
      const r = await deleteReportView(projectId, v.id);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Copy the address from the browser instead.");
    }
  };

  return (
    <section aria-label="Saved views" className="mb-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs font-medium text-slate-500">Saved views</span>
        {views.length === 0 && <span className="text-xs text-slate-400">None yet</span>}
        {views.map((v) => (
          <span
            key={v.id}
            className={cx(
              "inline-flex items-center rounded-full border text-xs",
              v.query === current ? "border-accent-500 bg-accent-50 text-accent-800" : "border-slate-300 text-slate-700",
            )}
          >
            <Link href={`?${v.query}`} className="py-1 pr-1 pl-2.5 hover:underline" title={`${v.shared ? "Shared" : "Only you"} · saved by ${v.createdByName}`}>
              {v.name}
              {!v.shared && <span className="text-slate-400"> (only you)</span>}
            </Link>
            {v.canDelete && (
              <button type="button" onClick={() => remove(v)} disabled={pending} aria-label={`Delete saved view ${v.name}`} className="rounded-full px-1.5 py-1 text-slate-400 hover:text-red-700">
                ×
              </button>
            )}
          </span>
        ))}
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={copy} data-howto="view-copy-link">
            {copied ? "Link copied" : "Copy link"}
          </Button>
          {!saving && (
            <Button size="sm" onClick={() => setSaving(true)} data-howto="view-save-open">
              Save this view…
            </Button>
          )}
        </span>
      </div>
      {saving && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this view" aria-label="View name" data-howto="view-name" className="h-8 w-64" maxLength={80} />
          <label className="flex items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="accent-accent-600" />
            Share with everyone in this test cycle
          </label>
          <Button size="sm" variant="primary" type="submit" disabled={pending || !name.trim()} data-howto="view-save">
            Save view
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setSaving(false)}>
            Cancel
          </Button>
        </form>
      )}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
    </section>
  );
}

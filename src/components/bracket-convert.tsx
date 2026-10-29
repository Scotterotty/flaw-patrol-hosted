"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { convertBracketTitles, previewBracketTitles, undoBracketTitles } from "@/server/tags";
import { tagColor, type TagColors } from "@/lib/tags";
import { TagPill } from "./tag-pill";
import { Modal } from "./modal";
import { Button, ErrorText } from "./ui";

type Preview = { count: number; tags: { tag: string; count: number }[]; example: { before: string; after: string; tags: string[] } | null };
type Undo = { id: string; title: string; tags: string[] }[];

/**
 * Case library banner (ver_96): "N case titles start with [brackets]". Review shows what
 * would change; Turn them into tags gives each case a new version, and Undo puts them back.
 */
export function BracketBanner({ projectId, count, colors, platforms }: { projectId: string; count: number; colors: TagColors; platforms: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dropDash, setDropDash] = useState(true);
  const [matchPlatforms, setMatchPlatforms] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = (opts: { dropDash: boolean; matchPlatforms: boolean }) =>
    start(async () => {
      setError(null);
      const r = await previewBracketTitles(projectId, opts);
      if (!r.ok) return setError(r.error);
      setPreview(r);
    });

  if (undo)
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900" role="status">
        <span className="flex-1">
          ✓ Turned {undo.length === 1 ? "1 title" : `${undo.length} titles`} into tags. Each case&apos;s old title is in its History.
        </span>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await undoBracketTitles(projectId, undo);
              if (!r.ok) return setError(r.error);
              setUndo(null);
              router.refresh();
            })
          }
        >
          Undo
        </Button>
        <button type="button" className="text-emerald-800 hover:underline" onClick={() => setUndo(null)}>
          Dismiss
        </button>
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      </div>
    );

  if (!count) return null;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-slate-700" data-testid="bracket-banner">
        <span className="flex-1">
          <strong>{count === 1 ? "1 case title starts" : `${count} case titles start`} with [brackets].</strong> Turn the bracket words into tags to tidy the titles and filter by them.
        </span>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setOpen(true);
            load({ dropDash, matchPlatforms });
          }}
        >
          Review…
        </Button>
      </div>
      <Modal open={open} title="Turn [brackets] into tags" onClose={() => setOpen(false)}>
          <div className="space-y-4 text-sm">
            {preview?.example && (
              <div className="rounded-md border border-slate-200 p-3">
                <p className="mb-1 text-xs font-semibold text-slate-500">Before</p>
                <p className="mb-2 font-medium text-slate-500 line-through decoration-slate-300">{preview.example.before}</p>
                <p className="mb-1 text-xs font-semibold text-slate-500">After</p>
                <p className="flex flex-wrap items-center gap-1 font-medium text-slate-900">
                  {preview.example.tags.map((t) => (
                    <TagPill key={t} tag={t} color={tagColor(t, colors)} />
                  ))}
                  {preview.example.after}
                </p>
              </div>
            )}
            {preview && preview.tags.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-700">Tags it makes</p>
                <div className="flex flex-wrap gap-1.5">
                  {preview.tags.map((t) => (
                    <TagPill key={t.tag} tag={t.tag} color={tagColor(t.tag, colors)} className="px-2 py-0.5 text-xs">
                      <span className="font-normal opacity-70 tabular-nums">{t.count}</span>
                    </TagPill>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-accent-600"
                  checked={dropDash}
                  onChange={(e) => {
                    setDropDash(e.target.checked);
                    load({ dropDash: e.target.checked, matchPlatforms });
                  }}
                />
                Drop the &quot; - &quot; after the brackets
              </label>
              {platforms && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-accent-600"
                    checked={matchPlatforms}
                    onChange={(e) => {
                      setMatchPlatforms(e.target.checked);
                      load({ dropDash, matchPlatforms: e.target.checked });
                    }}
                  />
                  Spell tags like their platform ([WEB] becomes Web, in its color)
                </label>
              )}
            </div>
            <p className="text-xs text-slate-500">Only brackets at the start of a title change. Each case keeps its old title in History, and you can Undo right after.</p>
            <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={pending || !preview?.count}
                onClick={() =>
                  start(async () => {
                    const r = await convertBracketTitles(projectId, { dropDash, matchPlatforms });
                    if (!r.ok) return setError(r.error);
                    setOpen(false);
                    setUndo(r.undo);
                    router.refresh();
                  })
                }
              >
                {pending ? "Working…" : `Turn ${preview?.count ?? count} ${(preview?.count ?? count) === 1 ? "title" : "titles"} into tags`}
              </Button>
            </div>
          </div>
        </Modal>
    </>
  );
}

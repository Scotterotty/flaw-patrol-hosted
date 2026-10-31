"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AreaWord } from "@/lib/area-tags";
import { tagColor, type TagColors } from "@/lib/tags";
import { convertAreaTitles, undoAreaTitles } from "@/server/tags";
import { TagPill } from "./tag-pill";
import { Modal } from "./modal";
import { Button, ErrorText } from "./ui";

type Undo = { id: string; title: string; tags: string[] }[];

/**
 * Case library banner (ver_102): "N cases have an area word after the platform". Review…
 * lists each word with a tick box; unticked words aren't offered again, and Undo puts the
 * titles back.
 */
export function AreaBanner({ projectId, words, colors }: { projectId: string; words: AreaWord[]; colors: TagColors }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  // New words start ticked too: the review box is where people say No.
  const [off, setOff] = useState<string[]>([]);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const on = words.filter((w) => !off.includes(w.word));
  const total = words.reduce((n, w) => n + w.count, 0);
  const picked = on.reduce((n, w) => n + w.count, 0);

  if (undo)
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900" role="status">
        <span className="flex-1">
          ✓ Tagged {undo.length === 1 ? "1 case" : `${undo.length} cases`} with their area. Each case&apos;s old title is in its History.
        </span>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await undoAreaTitles(projectId, undo);
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

  if (!words.length || hidden) return null;
  const sample = words.slice(0, 2).map((w) => w.word);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-slate-700" data-testid="area-banner">
        <span className="flex-1">
          <strong>
            {total === 1 ? "1 case has" : `${total} cases have`} an area word after the platform
          </strong>
          , like {sample.join(" or ")}. Turn them into tags?
        </span>
        <Button size="sm" onClick={() => setHidden(true)}>
          Not now
        </Button>
        <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
          Review…
        </Button>
      </div>
      <Modal open={open} title="Turn area words into tags" onClose={() => setOpen(false)}>
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">Tick the words that are parts of your app. The rest stay in the title, and Flaw Patrol won&apos;t suggest them again.</p>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {words.map((w) => {
              const checked = !off.includes(w.word);
              return (
                <li key={w.word}>
                  <label className="grid cursor-pointer grid-cols-[1.25rem_8rem_1fr] items-center gap-3 px-3 py-2 max-sm:grid-cols-[1.25rem_1fr]" data-testid="area-word">
                    <input
                      type="checkbox"
                      className="accent-accent-600"
                      checked={checked}
                      aria-label={w.word}
                      onChange={(e) => setOff(e.target.checked ? off.filter((x) => x !== w.word) : [...off, w.word])}
                    />
                    <span className={checked ? "" : "opacity-50"}>
                      <TagPill tag={w.word} color={tagColor(w.word, colors)} className="px-2 py-0.5 text-xs">
                        <span className="font-normal tabular-nums opacity-70">{w.count}</span>
                      </TagPill>
                      <span className="block text-xs text-slate-500">{w.known ? "already a tag" : "dash after it"}</span>
                    </span>
                    <span className="min-w-0 text-xs text-slate-500 max-sm:col-start-2">
                      <span className="line-through decoration-slate-300">{w.example.before}</span> → <span className="font-medium text-slate-800">{w.example.after}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-slate-500">Only the word right after a platform tag changes. Each case keeps its old title in History, and you can Undo right after.</p>
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={pending || (!on.length && !off.length)}
              onClick={() =>
                start(async () => {
                  const r = await convertAreaTitles(
                    projectId,
                    on.map((w) => w.word),
                    off,
                  );
                  if (!r.ok) return setError(r.error);
                  setOpen(false);
                  if (r.undo.length) setUndo(r.undo);
                  router.refresh();
                })
              }
            >
              {pending ? "Working…" : on.length ? `Tag ${picked} ${picked === 1 ? "case" : "cases"}` : "Don't suggest these again"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}


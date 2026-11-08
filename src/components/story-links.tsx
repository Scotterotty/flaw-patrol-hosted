"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { linkStory, searchStories } from "@/server/stories";
import { Modal } from "./modal";
import { TypeBadge } from "./story-coverage";
import { Button, cx, ErrorText, InfoTip, Input } from "./ui";

export type StoryChip = { key: string; title: string; status: string; url: string | null; type?: string; missing?: boolean; stale?: string };
type Found = { key: string; title: string; status: string; url: string; type?: string };

/** One linked requirement: type, key ↗, title and Jira status, with × to unlink. */
export function StoryTag({ s, onRemove }: { s: StoryChip; onRemove?: () => void }) {
  return (
    <span className={cx("inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs", s.missing ? "border-orange-200 bg-orange-50" : "border-slate-200 bg-surface")}>
      {s.type && <TypeBadge type={s.type} />}
      {s.url ? (
        <a href={s.url} target="_blank" rel="noreferrer" className="font-mono font-medium text-accent-700 hover:underline">
          {s.key} ↗
        </a>
      ) : (
        <span className="font-mono font-medium text-slate-700">{s.key}</span>
      )}
      <span className={cx("min-w-0 truncate", s.missing ? "text-orange-800" : "text-slate-700")} title={s.stale ? `As of ${new Date(s.stale).toLocaleString()}: Jira couldn't be reached` : s.title}>
        {s.title || "…"}
      </span>
      {s.status && <span className="flex-none rounded bg-slate-100 px-1 text-[11px] text-slate-600">{s.status}</span>}
      {onRemove && (
        <button type="button" aria-label={`Unlink ${s.key}`} title={s.missing ? "Unlink" : `Unlink ${s.key}`} onClick={onRemove} className="flex-none text-slate-400 hover:text-red-700">
          ×
        </button>
      )}
    </span>
  );
}

/** Live Jira requirement search: type a key or words, ↑ ↓ to move, Enter to pick, Esc to close. */
export function StorySearch({ projectId, onPick, onClose, autoFocus = true }: { projectId: string; onPick: (s: Found) => void; onClose: () => void; autoFocus?: boolean }) {
  const ids = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Found[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchStories(projectId, q);
      if (!live) return;
      if (r.ok) {
        setHits(r.issues);
        setError(null);
        setActive(0);
      } else setError(r.error);
    }, q ? 250 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, projectId]);
  return (
    <div className="rounded-md border border-slate-200 bg-surface p-2 shadow-sm">
      <Input
        ref={box}
        className="h-8"
        placeholder="Jira key or words"
        value={q}
        role="combobox"
        aria-expanded={!!hits?.length}
        aria-controls={`${ids}-list`}
        aria-activedescendant={hits?.[active] ? `${ids}-${active}` : undefined}
        aria-label="Find a Jira requirement"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min((hits?.length ?? 1) - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && hits?.[active]) {
            e.preventDefault();
            onPick(hits[active]);
          }
        }}
      />
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <ul id={`${ids}-list`} role="listbox" aria-label="Requirements" className="mt-1 max-h-56 overflow-y-auto">
        {hits?.map((h, i) => (
          <li
            key={h.key}
            id={`${ids}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseMove={() => setActive(i)}
            onClick={() => onPick(h)}
            className={cx("flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs", i === active && "bg-accent-50")}
          >
            {h.type && <TypeBadge type={h.type} />}
            <span className="font-mono text-slate-600">{h.key}</span>
            <span className="min-w-0 flex-1 truncate text-slate-800">{h.title}</span>
            <span className="text-[11px] text-slate-500">{h.status}</span>
          </li>
        ))}
        {hits && !hits.length && <li className="px-2 py-1 text-xs text-slate-500">Nothing matches.</li>}
      </ul>
    </div>
  );
}

/** The case page's "Requirements" field: link, see and unlink the Jira requirements a case tests. */
export function StoryLinks({ projectId, caseId, stories, canEdit, jira }: { projectId: string; caseId: string; stories: StoryChip[]; canEdit: boolean; jira: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [list, setList] = useState(stories);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  useEffect(() => setList(stories), [stories]);
  const change = (key: string, mode: "add" | "remove", chip?: StoryChip) =>
    start(async () => {
      setError(null);
      const r = await linkStory(projectId, [caseId], key, mode);
      if (!r.ok) return setError(r.error);
      setList((l) => (mode === "add" ? (l.some((s) => s.key === key) ? l : [...l, chip!]) : l.filter((s) => s.key !== key)));
      router.refresh();
    });
  return (
    <div>
      <h2 className="mb-1.5 flex items-center gap-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Requirements <InfoTip text="Jira stories, Epics and other requirements this case tests. Coverage shows on the Requirements page. Linking doesn't make a new case version." />
      </h2>
      <div className="flex flex-col items-start gap-1.5">
        {list.map((s) => (
          <StoryTag key={s.key} s={s} onRemove={canEdit ? () => change(s.key, "remove") : undefined} />
        ))}
        {!list.length && !canEdit && <p className="text-xs text-slate-500">None linked.</p>}
        {canEdit &&
          (adding ? (
            <div className="w-full">
              <StorySearch
                projectId={projectId}
                onClose={() => setAdding(false)}
                onPick={(f) => {
                  setAdding(false);
                  change(f.key, "add", { key: f.key, title: f.title, status: f.status, url: f.url });
                }}
              />
            </div>
          ) : jira ? (
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)} data-howto="case-link-req">
              + Link requirement
            </Button>
          ) : (
            <p className="text-xs text-slate-500">Connect Jira in Settings to link requirements.</p>
          ))}
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      </div>
    </div>
  );
}

/** Case library bulk bar: add a requirement to the ticked cases, or take it off them. */
export function LinkStoryButton({ projectId, cases, disabled, onDone }: { projectId: string; cases: { id: string; stories?: string[] }[]; disabled?: boolean; onDone: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [story, setStory] = useState<Found | null>(null);
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const has = story ? cases.filter((c) => c.stories?.includes(story.key)).length : 0;
  const n = cases.length;
  const close = () => {
    setOpen(false);
    setStory(null);
    setMode("add");
    setError(null);
  };
  const save = () =>
    story &&
    start(async () => {
      const r = await linkStory(projectId, cases.map((c) => c.id), story.key, mode);
      if (!r.ok) return setError(r.error);
      close();
      onDone(mode === "add" ? `Linked ${story.key} to ${r.changed} ${r.changed === 1 ? "case" : "cases"}.` : `Took ${story.key} off ${r.changed} ${r.changed === 1 ? "case" : "cases"}.`);
    });
  return (
    <>
      <Button size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        Link to requirement…
      </Button>
      <Modal open={open} onClose={close} title={`Link ${n} ${n === 1 ? "case" : "cases"} to a requirement`}>
        <div className="space-y-3">
          {story ? (
            <StoryTag s={{ ...story }} onRemove={() => setStory(null)} />
          ) : (
            <StorySearch projectId={projectId} onPick={setStory} onClose={close} />
          )}
          {story && (
            <fieldset className="space-y-1 text-sm">
              <legend className="sr-only">Add or remove</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="story-mode" checked={mode === "add"} onChange={() => setMode("add")} /> Add this requirement
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="story-mode" checked={mode === "remove"} onChange={() => setMode("remove")} /> Remove this requirement
              </label>
              <p className="flex items-center gap-1 text-xs text-slate-500">
                {mode === "add" ? (has ? `${has} of the ${n} already ${has === 1 ? "has" : "have"} it and ${has === 1 ? "is" : "are"} skipped.` : "") : `${has} of the ${n} ${has === 1 ? "has" : "have"} it.`}
                <InfoTip text="Cases keep their other requirements." />
              </p>
            </fieldset>
          )}
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" disabled={!story || pending} onClick={save}>
              {mode === "add" ? `Link ${n} ${n === 1 ? "case" : "cases"}` : `Unlink ${n} ${n === 1 ? "case" : "cases"}`}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

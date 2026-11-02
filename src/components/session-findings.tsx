"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clock, NOTE_LABEL, type LogKind } from "@/lib/charter";
import type { Finding, FindingGroup } from "@/lib/findings";
import { caseKey } from "@/lib/format";
import { shortDate } from "@/lib/spelling";
import { answerQuestion } from "@/server/findings";
import { PersonaChip } from "./charter-view";
import { useSpelling, useZone } from "./spelling";
import { Button, Card, cx, ErrorText, Textarea } from "./ui";

const KIND_STYLE: Record<LogKind, string> = {
  covered: "text-accent-700 ring-accent-300",
  note: "text-slate-600 ring-slate-300",
  bug: "text-red-700 ring-red-300",
  question: "text-amber-700 ring-amber-300",
  idea: "text-emerald-700 ring-emerald-300",
};

/** The findings list on Reports → Session findings, grouped by charter. */
export function SessionFindings({ projectId, projectKey, groups, canAnswer, canWrite }: { projectId: string; projectKey: string; groups: FindingGroup[]; canAnswer: boolean; canWrite: boolean }) {
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Card key={g.caseId} role="region" aria-label={g.title}>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
            <span aria-hidden>🧭</span>
            <Link href={`/p/${projectKey}/cases/${g.number}`} className="font-medium text-slate-900 hover:underline">
              {g.title}
            </Link>
            <span className="font-mono text-xs text-slate-400">{caseKey(projectKey, g.number)}</span>
            {g.persona && <PersonaChip persona={g.persona} />}
            <span className="text-xs text-slate-500">
              {g.sessions} {g.sessions === 1 ? "session" : "sessions"}
            </span>
          </div>
          <ul className="divide-y divide-slate-100">
            {g.items.map((f) => (
              <FindingRow key={`${f.resultId}-${f.note.id}`} f={f} group={g} projectId={projectId} projectKey={projectKey} canAnswer={canAnswer} canWrite={canWrite} />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function FindingRow({ f, group, projectId, projectKey, canAnswer, canWrite }: { f: Finding; group: FindingGroup; projectId: string; projectKey: string; canAnswer: boolean; canWrite: boolean }) {
  const [answering, setAnswering] = useState(false);
  const [text, setText] = useState(f.answer?.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const spelling = useSpelling();
  const zone = useZone();
  const { note } = f;
  const save = (value: string) =>
    start(async () => {
      const r = await answerQuestion(projectId, f.resultId, note.id, value);
      if (!r.ok) return setError(r.error);
      setAnswering(false);
      router.refresh();
    });
  const charterHref = `/p/${projectKey}/cases/new?charter=1&explore=${encodeURIComponent(note.text)}${group.personaId ? `&persona=${group.personaId}` : ""}`;

  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3 sm:flex-nowrap">
      <span className={cx("mt-0.5 w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-semibold ring-1 ring-inset", KIND_STYLE[note.kind])}>{NOTE_LABEL[note.kind]}</span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="whitespace-pre-wrap wrap-anywhere text-slate-800">
          {note.text || note.defect?.title}
          {note.defect && (
            <>
              {" · "}
              {note.defect.externalUrl ? (
                <a href={note.defect.externalUrl} target="_blank" rel="noreferrer" className="font-mono text-xs font-medium text-red-700 hover:underline">
                  {note.defect.externalKey}
                </a>
              ) : (
                <span className="font-mono text-xs text-red-700">D-{note.defect.number}</span>
              )}
              {note.text && note.defect.title !== note.text && <span className="text-xs text-red-700"> {note.defect.title}</span>}
            </>
          )}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {f.tester || "Someone"} · R{f.run}
          {f.release && ` ${f.release}`} · {clock(note.at)} into session · {shortDate(new Date(f.at), spelling, zone)}
          {note.attachments.length > 0 && ` · 📎 ${note.attachments.length}`}
        </p>
        {note.attachments.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-1.5">
            {note.attachments.map((a) => (
              <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="max-w-48 truncate rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:underline">
                {a.fileName}
              </a>
            ))}
          </p>
        )}
        {f.answer && !answering && (
          <p className="mt-1.5 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-900">
            <span className="font-medium">Answer:</span> {f.answer.text}
            <span className="text-emerald-700/80">
              {" "}
              ({f.answer.by}, {shortDate(new Date(f.answer.at), spelling, zone)})
            </span>
          </p>
        )}
        {answering && (
          <form
            className="mt-2 space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              save(text);
            }}
          >
            <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
            <Textarea rows={2} autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label="Answer" placeholder="What did you find out?" />
            <div className="flex gap-1.5">
              <Button size="sm" type="submit" variant="primary" disabled={pending || !text.trim()}>
                Save answer
              </Button>
              {f.answer && (
                <Button size="sm" disabled={pending} onClick={() => save("")}>
                  Reopen
                </Button>
              )}
              <Button size="sm" onClick={() => setAnswering(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs">
        {note.kind === "question" &&
          (f.answer ? (
            <span className="font-medium text-emerald-700">
              ✓ Answered
              {canAnswer && !answering && (
                <button type="button" className="ml-2 font-normal text-accent-700 hover:underline" onClick={() => setAnswering(true)}>
                  Edit
                </button>
              )}
            </span>
          ) : (
            canAnswer &&
            !answering && (
              <button type="button" className="font-medium text-accent-700 hover:underline" onClick={() => setAnswering(true)}>
                Mark answered
              </button>
            )
          ))}
        {note.kind === "idea" && canWrite && (
          <Link href={charterHref} className="font-medium text-accent-700 hover:underline">
            Turn into charter
          </Link>
        )}
      </div>
    </li>
  );
}

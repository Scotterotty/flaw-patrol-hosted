"use client";

// A bug reported with a bug template: what was filled in under each heading, and for a
// table set to grow, "I saw it again", which adds a row with the automatic cells filled in.

import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { deviceCell, nowCell, type Answer } from "@/lib/bug-layout";
import { addBugRow, bugRowStart } from "@/server/jira";
import { uploadAttachment } from "@/server/results";
import { Sp, useSpell } from "./spelling";
import { Button, cx, ErrorText, InfoTip } from "./ui";

export function BugAnswers({ projectId, defectId, templateName, answers, canAdd, inJira }: { projectId: string; defectId: string; templateName: string; answers: Answer[]; canAdd: boolean; inJira: boolean }) {
  const [open, setOpen] = useState(false);
  const growing = answers.filter((a) => a.growing && a.rows && a.columns);
  if (!answers.length) return null;
  return (
    <div className="mt-1" data-testid="bug-answers">
      <button type="button" className="text-xs text-accent-700 hover:underline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide what was reported" : `What was reported${templateName ? ` (${templateName})` : ""}`}
        {growing.length > 0 && !open && ` · ${growing.map((a) => `${a.heading}: ${a.rows!.length} ${a.rows!.length === 1 ? "row" : "rows"}`).join(", ")}`}
      </button>
      {open && (
        <div className="mt-2 space-y-2.5 rounded-lg border border-slate-200 bg-surface p-3 text-[13px]">
          {answers.map((a) =>
            a.rows && a.columns ? (
              <RowsTable key={a.id} projectId={projectId} defectId={defectId} answer={a} canAdd={canAdd && !!a.growing} inJira={inJira} />
            ) : a.text.trim() || a.files?.length ? (
              <div key={a.id}>
                <p className="font-semibold text-slate-800">{a.heading}</p>
                {a.text.trim() && <p className={cx("whitespace-pre-wrap text-slate-700", a.source === "file" && "font-mono text-xs")}>{a.text}</p>}
                {(a.files ?? []).map((f) => (
                  <a key={f.id} href={`/api/attachments/${f.id}`} target="_blank" rel="noreferrer" className="mr-2 text-accent-700 hover:underline">
                    {f.fileName}
                  </a>
                ))}
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function RowsTable({ projectId, defectId, answer, canAdd, inJira }: { projectId: string; defectId: string; answer: Answer; canAdd: boolean; inJira: boolean }) {
  const router = useRouter();
  const sp = useSpell();
  const cols = answer.columns!;
  const [rows, setRows] = useState(answer.rows!);
  const [adding, setAdding] = useState<string[] | null>(null);
  const [files, setFiles] = useState<{ id: string; fileName: string }[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [runName, setRunName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const begin = () =>
    start(async () => {
      setError(null);
      setNote(null);
      const res = await bugRowStart(projectId);
      if (!res.ok) return setError(res.error);
      const auto: Record<string, string> = { now: nowCell(), device: deviceCell(navigator.userAgent), who: res.who, build: res.build, env: res.env };
      setRunName(res.runName);
      setFiles([]);
      setAdding(cols.map((c) => (c.fill === "write" || c.fill === "files" ? "" : (auto[c.fill] ?? ""))));
    });

  const save = () =>
    start(async () => {
      setError(null);
      const res = await addBugRow(projectId, { defectId, answerId: answer.id, cells: adding!, attachmentIds: files.map((f) => f.id) });
      if (!res.ok) return setError(res.error);
      setRows(res.rows);
      setAdding(null);
      setNote(res.jiraError ?? (inJira ? "Row added. The table in the Jira bug is updated too." : "Row added."));
      router.refresh();
    });

  const addFile = async (list: FileList | null) => {
    for (const file of Array.from(list ?? [])) {
      const form = new FormData();
      form.set("file", file);
      const res = await uploadAttachment(projectId, form);
      if (res.ok) setFiles((f) => [...f, { id: res.attachment.id, fileName: res.attachment.fileName }]);
      else setError(res.error);
    }
  };

  return (
    <div>
      <p className="font-semibold text-slate-800">{answer.heading}</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div className="overflow-x-auto">
        <table className="min-w-full border border-slate-200 text-xs" data-testid="bug-rows">
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={i} className="border-r border-slate-100 bg-slate-100 px-2 py-1 text-left font-semibold whitespace-nowrap">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {cols.map((_, i) => (
                  <td key={i} className="border-t border-r border-slate-100 px-2 py-1 whitespace-pre-wrap">
                    {r[i] || "-"}
                  </td>
                ))}
              </tr>
            ))}
            {adding && (
              <tr data-testid="new-row">
                {cols.map((c, i) => (
                  <td key={i} className={cx("border-t border-r border-slate-100 px-1.5 py-1", c.fill === "files" && "bg-slate-50 text-slate-500")}>
                    {c.fill === "write" ? (
                      <input
                        aria-label={c.name}
                        className="w-full min-w-16 rounded border border-slate-300 bg-surface px-1.5 py-0.5"
                        value={adding[i]}
                        onChange={(e) => setAdding((a) => a!.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                    ) : c.fill === "files" ? (
                      <span className="flex flex-wrap items-center gap-1">
                        {files.map((f) => (
                          <Fragment key={f.id}>
                            <span>{f.fileName}</span>
                          </Fragment>
                        ))}
                        <label className="cursor-pointer rounded border border-slate-300 bg-surface px-1.5 py-0.5 text-slate-700 hover:bg-slate-50">
                          Add file
                          <input type="file" className="sr-only" aria-label="Add a file to this row" onChange={(e) => void addFile(e.target.files).then(() => (e.target.value = ""))} />
                        </label>
                      </span>
                    ) : (
                      <input
                        aria-label={c.name}
                        placeholder="Type it in"
                        className="w-full min-w-16 rounded border border-slate-300 bg-surface px-1.5 py-0.5"
                        value={adding[i]}
                        onChange={(e) => setAdding((a) => a!.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                    )}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {canAdd && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {adding ? (
            <>
              <span className="text-xs text-slate-500">
                <Sp>Some cells start filled in for you</Sp>
                {runName ? `, from your run "${runName}"` : ""}. You can change any of them. Times include the time zone.
              </span>
              <span className="flex-1" />
              <Button size="sm" onClick={() => setAdding(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" disabled={pending} onClick={save}>
                {pending ? "Saving…" : "Save row"}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="primary" disabled={pending} onClick={begin}>
                I saw it again
              </Button>
              <InfoTip text={sp("Adds a row. The gray cells fill in for you; you fill in the white ones.")} />
              {note && (
                <span className="text-xs text-emerald-700" role="status">
                  {note}
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import Papa from "papaparse";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import {
  detectSource,
  FIELD_LABEL,
  folderPreview,
  spacedSlashNames,
  wholeName,
  type FolderPreview,
  guessMapping,
  IMPORT_FIELDS,
  IMPORT_SOURCES,
  MAX_IMPORT,
  numberedSteps,
  rowsToCases,
  type ColumnMapping,
  type ImportField,
  type ImportSource,
} from "@/lib/csv-import";
import { PRIORITY_LABEL } from "@/lib/format";
import { importCases } from "@/server/import";
import { readSpreadsheet } from "@/server/spreadsheet";
import { checkStoryKeys } from "@/server/stories";
import { Button, Card, cx, ErrorText, Field, InfoTip, Input, Select } from "./ui";

/** Where imported cases can go: the umbrella's Case library, this test cycle, or a test cycle outside any umbrella. */
export type ImportPlace = { id: string; key: string; label: string; kind: "library" | "cycle" | "own"; folderOptions: { id: string; label: string }[] };

const NEW_FOLDER = "__new";

export function CsvImporter({
  projectId,
  places,
  initialPlaceId,
  initialFolderId,
  initialFolderPlaceId,
}: {
  projectId: string;
  places: ImportPlace[];
  initialPlaceId: string;
  initialFolderId: string | null;
  initialFolderPlaceId: string;
}) {
  const [placeId, setPlaceId] = useState(initialPlaceId);
  const place = places.find((p) => p.id === placeId) ?? places[0];
  const folderOptions = place.folderOptions;
  const startFolder = placeId === initialFolderPlaceId ? initialFolderId : null;
  // One folder for the whole file (the default), or folders built from the file's Folder column.
  // ver_91: a file with a Folder column (TestRail sections) keeps its folders unless you choose one folder.
  const [folderMode, setFolderMode] = useState<"one" | "file" | null>(null);
  const [oneFolder, setOneFolder] = useState(startFolder ?? NEW_FOLDER);
  const [newFolderName, setNewFolderName] = useState("");
  const [keepWhole, setKeepWhole] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [source, setSource] = useState<ImportSource>("other");
  const [folderId, setFolderId] = useState(startFolder ?? "");
  const [error, setError] = useState<string | null>(null);
  const [restoreBreaks, setRestoreBreaks] = useState(false);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [done, setDone] = useState<{ cases: number; shared: number; folderId: string | null; place: ImportPlace } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, start] = useTransition();

  const header = rows?.[0] ?? [];
  const result = useMemo(() => (rows ? rowsToCases(rows, mapping, source, { restoreBreaks, keepWhole }) : null), [rows, mapping, source, restoreBreaks, keepWhole]);
  const slashNames = useMemo(() => (rows ? spacedSlashNames(rows, mapping) : []), [rows, mapping]);
  const hasFolders = mapping.folder !== undefined && !!result?.cases.some((c) => c.folderPath.length);
  const oneMode = !hasFolders || folderMode === "one";
  const typeTagged = useMemo(() => [...new Set(result?.cases.flatMap((c) => c.tags.filter((t) => t.startsWith("type: ")).map((t) => t.slice(6))) ?? [])], [result]);
  const folderPaths = useMemo(() => new Set(result?.cases.map((c) => c.folderPath.join("\u0000")).filter(Boolean)).size, [result]);
  const tree = useMemo(() => (result ? folderPreview(result.cases) : []), [result]);
  // Jira story keys from the Requirements, Jira or Story column, checked against Jira before importing.
  const storyKeys = useMemo(() => [...new Set(result?.cases.flatMap((c) => c.stories) ?? [])], [result]);
  const storyCount = result?.cases.filter((c) => c.stories.length).length ?? 0;
  const mappedStoryColumn = mapping.requirements !== undefined ? `"${header[mapping.requirements]}"` : "";
  const [unknownStories, setUnknownStories] = useState<string[]>([]);
  const storyList = storyKeys.join(" ");
  useEffect(() => {
    let live = true;
    setUnknownStories([]);
    if (!storyList) return;
    const t = setTimeout(() => {
      checkStoryKeys(projectId, storyList.split(" ")).then((r) => {
        if (live && r.ok) setUnknownStories(r.unknown);
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [storyList, projectId]);
  const oneFolderLabel = oneFolder === NEW_FOLDER ? newFolderName.trim() : oneFolder ? folderOptions.find((f) => f.id === oneFolder)?.label.split(" / ").pop() : "";
  const needsName = oneMode && oneFolder === NEW_FOLDER && !newFolderName.trim();
  const pickPlace = (id: string) => {
    setPlaceId(id);
    const keep = id === initialFolderPlaceId ? initialFolderId : null;
    setFolderId(keep ?? "");
    setOneFolder(keep ?? NEW_FOLDER);
  };
  const chooseSource = (next: ImportSource, head: string[]) => {
    setSource(next);
    setMapping(guessMapping(head, next));
    setRestoreBreaks(next === "qtest");
  };

  const accept = (name: string, data: string[][]) => {
    if (data.length < 2) return setError("That file has no rows under the header.");
    data[0][0] = (data[0][0] ?? "").replace(/^﻿/, "");
    setFileName(name);
    setRows(data);
    setKeepWhole([]);
    // A test cycle of its own gets a folder named after the file. The Case library is
    // used by every release, so its folder is named after what the cases test instead.
    if (place.kind !== "library") setNewFolderName((n) => n || name.replace(/\.[^.]+$/, "").replace(/[/>\\]/g, "-").slice(0, 100));
    chooseSource(detectSource(data[0]), data[0]);
  };

  const load = (file: File) => {
    setError(null);
    setDone(null);
    if (/\.xlsx$/i.test(file.name)) {
      const form = new FormData();
      form.set("file", file);
      start(async () => {
        const res = await readSpreadsheet(projectId, form);
        if (!res.ok) return setError(res.error);
        accept(file.name, res.rows);
      });
      return;
    }
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      setError("Choose a .csv or .xlsx file. Older .xls files need saving as .xlsx or CSV first.");
      return;
    }
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      complete: (res) => accept(file.name, res.data.map((r) => r.map((c) => String(c ?? "")))),
      error: (e) => setError(`Couldn't read the file: ${e.message}`),
    });
  };

  const doImport = () =>
    start(async () => {
      if (!result) return;
      setError(null);
      const cases = oneMode ? result.cases.map((c) => ({ ...c, folderPath: [] })) : result.cases;
      const target = oneMode ? (oneFolder === NEW_FOLDER ? folderId || null : oneFolder || null) : folderId || null;
      // A new folder goes inside the folder picked for "Inside" only in file mode; in one-folder mode it goes at the top.
      const res = await importCases(place.id, oneMode && oneFolder === NEW_FOLDER ? null : target, cases, fileName, result.shared, oneMode && oneFolder === NEW_FOLDER ? newFolderName : "");
      if (!res.ok) return setError(res.error);
      setDone({ cases: res.created, shared: res.shared, folderId: res.folderId, place });
    });

  if (done !== null) {
    return (
      <Card className="p-6 text-center">
        <p className="text-lg font-semibold text-slate-900">
          ✓ Imported {done.cases} test cases{done.place.kind === "library" ? ` into the ${done.place.label}` : done.place.kind === "cycle" ? ` into ${done.place.label} only` : ""}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Each one starts at version 1 with a note naming {fileName}.
          {done.shared > 0 && ` Steps repeated in several cases became ${done.shared === 1 ? "a shared step" : `${done.shared} shared steps`}.`}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button
            onClick={() => {
              setRows(null);
              setDone(null);
            }}
          >
            Import another file
          </Button>
          <Link href={`/p/${done.place.key}/cases${done.folderId ? `?folder=${done.folderId}` : ""}`} className="inline-flex h-9 items-center rounded-md bg-accent-600 px-3.5 text-sm font-medium text-white hover:bg-accent-700">
            View cases
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) load(f);
        }}
        className={cx(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed bg-surface px-6 py-8 text-center",
          dragging ? "border-accent-500 bg-accent-50" : "border-slate-300 hover:border-slate-400",
        )}
      >
        <input type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        <span className="font-medium text-slate-800">{fileName ? `${fileName} · ${(rows?.length ?? 1) - 1} rows` : pending && !rows ? "Reading…" : "Drop a CSV or Excel (.xlsx) file here, or click to choose"}</span>
        <span className="mt-1 text-sm text-slate-500">
          Works with exports from qTest, TestRail, Zephyr, Xray and plain spreadsheets. Steps can be one per row or all in one cell.
        </span>
      </label>

      {rows && result && (
        <>
          <Card className="p-5">
            <Field label="Where is this file from?" htmlFor="import-source" hint="Matches that tool's columns, folders and formatting exactly. We picked it from the column names.">
              <Select
                id="import-source"
                value={source}
                onChange={(e) => chooseSource(e.target.value as ImportSource, header)}
                className="sm:max-w-xs"
              >
                {IMPORT_SOURCES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            {source === "qtest" && (
              <div className="mt-3">
                <label className="flex items-center gap-2 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    checked={restoreBreaks}
                    onChange={(e) => setRestoreBreaks(e.target.checked)}
                    aria-describedby="restore-breaks-help"
                    className="size-4 accent-accent-600"
                  />
                  Put back line breaks qTest&apos;s CSV export removed
                </label>
                <p id="restore-breaks-help" className="mt-0.5 ml-6 text-xs text-slate-500">
                  qTest joins the lines of each step, so &ldquo;Enter a SpaceA user can enter&hellip;&rdquo; was two lines. Check a few cases in the preview.
                </p>
              </div>
            )}
          </Card>

          {places.length > 1 && (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Where should these cases live?</h2>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Where should these cases live?">
                {places.map((p) => (
                  <Choice key={p.id} checked={p.id === place.id} onSelect={() => pickPlace(p.id)} name="import-place">
                    <span className="font-medium text-slate-900">
                      {p.kind === "library" ? p.label.replace(/ case library$/, "") + " case library" : `Only this test cycle (${p.label})`}
                      {p.kind === "library" && <span className="ml-2 rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-medium text-accent-700">Recommended</span>}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {p.kind === "library"
                        ? "Every test cycle in the umbrella can run them. Edit a case once and every future run uses the new version."
                        : "For one-off cases nobody needs again. Other test cycles won't see them."}
                    </span>
                  </Choice>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-800">{place.kind === "library" ? "Which folder in the library?" : "Which folder?"}</h2>
            <p className="mb-3 text-xs text-slate-500">
              {hasFolders
                ? `This file has a Folder column with ${folderPaths} different folder ${folderPaths === 1 ? "path" : "paths"}.`
                : "This file has no folders in it, so all cases go in one folder."}
            </p>
            <div className="space-y-2" role="radiogroup" aria-label="Which folder?">
              <Choice checked={oneMode} onSelect={() => setFolderMode("one")} name="folder-mode">
                <span className="font-medium text-slate-900">Put them all in one folder</span>
                {oneMode && (
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    <Select aria-label="Folder for all cases" className="h-8 w-auto text-sm" value={oneFolder} onChange={(e) => setOneFolder(e.target.value)}>
                      <option value={NEW_FOLDER}>New folder…</option>
                      <option value="">(Top level, no folder)</option>
                      {folderOptions.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </Select>
                    {oneFolder === NEW_FOLDER && (
                      <Input
                        aria-label="New folder name"
                        aria-invalid={needsName || undefined}
                        placeholder={place.kind === "library" ? "Name it after what the cases test" : "Folder name"}
                        className={cx("h-8 w-72 text-sm", needsName && "border-amber-500 ring-1 ring-amber-500")}
                        maxLength={100}
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value.replace(/[/>\\]/g, "-"))}
                      />
                    )}
                  </span>
                )}
                {oneMode && (
                  <span className="mt-1.5 block text-xs text-slate-500">
                    All {result.cases.length} cases go here.{hasFolders && " The Folder column is ignored."}
                    {place.kind === "library" && " Name the folder after what the cases test, since every run can use it."}
                  </span>
                )}
              </Choice>
              <Choice checked={!oneMode} disabled={!hasFolders} onSelect={() => setFolderMode("file")} name="folder-mode">
                <span className={cx("font-medium", hasFolders ? "text-slate-900" : "text-slate-400")}>Make folders from the file&apos;s Folder column</span>
                {!oneMode && (
                  <span className="mt-2 block">
                    <span className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                      Inside
                      <Select aria-label="Make the folders inside" className="h-8 w-auto text-sm" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                        <option value="">(Top level)</option>
                        {folderOptions.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </Select>
                    </span>
                    <ul className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm" aria-label="Folders this import makes">
                      <FolderPreviewRows nodes={tree} depth={0} />
                    </ul>
                    {slashNames.map((name) => {
                      const kept = keepWhole.includes(name);
                      return (
                        <span key={name} className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          {kept ? (
                            <span>
                              &ldquo;{name}&rdquo; stays one folder, named &ldquo;{wholeName(name)}&rdquo; because folder names can&apos;t hold a slash.
                            </span>
                          ) : (
                            <span>
                              &ldquo;{name}&rdquo; has a slash, so it becomes two folders: {name.split(/\s+\/\s+/).join(", then ")} inside it.
                            </span>
                          )}
                          <button
                            type="button"
                            className="font-medium text-amber-900 underline"
                            onClick={() => setKeepWhole((k) => (kept ? k.filter((x) => x !== name) : [...k, name]))}
                          >
                            {kept ? "Split it after all" : "Keep it as one folder"}
                          </button>
                        </span>
                      );
                    })}
                  </span>
                )}
              </Choice>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-800">Match your columns</h2>
            <p className="mb-4 text-xs text-slate-500">We guessed from the header names. Only Title is required. Rows that share a case ID, as in qTest exports, become one case.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_FIELDS.map((f: ImportField) => (
                <Field
                  key={f}
                  label={FIELD_LABEL[f] + (f === "title" ? " *" : "")}
                  htmlFor={`map-${f}`}
                  hint={f === "folder" && oneMode && mapping.folder !== undefined ? "Not used: all cases go in one folder" : undefined}
                >
                  <Select
                    id={`map-${f}`}
                    value={mapping[f] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value === "" ? undefined : Number(e.target.value) }))}
                  >
                    <option value="">(Not imported)</option>
                    {header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">
                  Preview: {result.cases.length} cases, {result.cases.reduce((n, c) => n + c.steps.length, 0)} steps
                  {result.shared.length > 0 && `, ${result.shared.length} shared ${result.shared.length === 1 ? "step" : "steps"}`}
                </h2>
                <p className="text-xs text-slate-500">Click a case to see its steps as they&apos;ll be numbered.</p>
                {typeTagged.length > 0 && (
                  <p className="mt-1 text-xs text-slate-600" data-testid="type-tags-note">
                    The file&apos;s Type values ({typeTagged.slice(0, 4).join(", ")}
                    {typeTagged.length > 4 ? "…" : ""}) become tags like &quot;type: {typeTagged[0]}&quot;, because Flaw Patrol&apos;s Type is only Manual or Automated.
                  </p>
                )}
                {result.cases.length > MAX_IMPORT && <p className="text-xs text-red-600">Split the file: at most {MAX_IMPORT} cases per import.</p>}
              </div>
              <span className="flex flex-wrap items-center justify-end gap-2">
                {/* The reason in words, not only in a hover tip on a gray button (ver_89). */}
                {needsName && <span className="text-xs font-medium text-amber-800">Name the folder first</span>}
                {!result.cases.length && <span className="text-xs font-medium text-amber-800">No cases found: check the Title column</span>}
                <Button variant="primary" disabled={pending || needsName || !result.cases.length || result.cases.length > MAX_IMPORT} title={needsName ? "Name the new folder first" : undefined} onClick={doImport}>
                  {pending ? "Importing…" : oneMode && oneFolderLabel ? `Import ${result.cases.length} cases into "${oneFolderLabel}"` : `Import ${result.cases.length} cases`}
                </Button>
              </span>
            </div>
            {storyCount > 0 && (
              <p className="flex items-center gap-1 border-b border-slate-200 px-4 py-2 text-xs text-slate-600">
                {storyCount} {storyCount === 1 ? "case links" : "cases link"} Jira requirements from the file&apos;s {mappedStoryColumn || "requirements"} column.
                {unknownStories.length > 0 && <span className="text-orange-800"> Jira doesn&apos;t know {unknownStories.slice(0, 10).join(", ")}{unknownStories.length > 10 ? ` and ${unknownStories.length - 10} more` : ""}. They&apos;re linked anyway and show as &quot;Not found in Jira&quot;.</span>}
                <InfoTip text="Several keys in one cell (comma or space) become several links. Other text in that column is kept as tags." />
              </p>
            )}
            {result.warnings.length > 0 && (
              <details className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
                <summary className="cursor-pointer">{result.warnings.length} {result.warnings.length === 1 ? "row needs" : "rows need"} a look</summary>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {result.warnings.slice(0, 50).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Row</th>
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Folder</th>
                    <th className="px-3 py-2 font-medium">Priority</th>
                    <th className="px-3 py-2 font-medium">Tags</th>
                    {storyCount > 0 && <th className="px-3 py-2 font-medium">Requirements</th>}
                    <th className="px-3 py-2 font-medium">Steps</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.cases.slice(0, 100).map((c) => (
                    <Fragment key={c.row}>
                      <tr className="align-top">
                        <td className="px-3 py-1.5 text-xs text-slate-400">{c.row}</td>
                        <td className="px-3 py-1.5 font-medium text-slate-800">
                          <button
                            type="button"
                            aria-expanded={openRow === c.row}
                            onClick={() => setOpenRow(openRow === c.row ? null : c.row)}
                            className="text-left hover:text-accent-700"
                          >
                            <span aria-hidden className="mr-1 inline-block w-3 text-slate-400">
                              {openRow === c.row ? "▾" : "▸"}
                            </span>
                            {c.sourceId && <span className="mr-1.5 font-mono text-xs font-normal text-slate-500">{c.sourceId}</span>}
                            {c.title}
                          </button>
                        </td>
                        <td className="px-3 py-1.5 text-xs text-slate-500">{oneMode ? oneFolderLabel : c.folderPath.join(" / ")}</td>
                        <td className="px-3 py-1.5 text-xs">{PRIORITY_LABEL[c.priority]}</td>
                        <td className="px-3 py-1.5 text-xs text-slate-500">
                          {c.tags.join(", ")}
                        </td>
                        {storyCount > 0 && <td className="px-3 py-1.5 font-mono text-xs text-accent-700">{c.stories.join(" ")}</td>}
                        <td className="px-3 py-1.5 text-xs text-slate-600" title={c.steps.map((s, i) => `${i + 1}. ${s.action}`).join("\n")}>
                          {c.steps.length}
                        </td>
                      </tr>
                      {openRow === c.row && (
                        <tr>
                          <td />
                          <td colSpan={storyCount > 0 ? 6 : 5} className="px-3 pb-3">
                            {c.preconditions && <p className="mb-2 text-xs whitespace-pre-wrap wrap-anywhere text-slate-600">{c.preconditions}</p>}
                            <ol className="divide-y divide-slate-100 rounded-md border border-slate-200 text-xs">
                              {numberedSteps(c, result.shared).map((s) => (
                                <li key={s.number} className="grid grid-cols-[3rem_1fr_1fr] gap-3 px-3 py-2">
                                  <span className="font-mono text-slate-500">{s.number}</span>
                                  <span className="whitespace-pre-wrap wrap-anywhere text-slate-800">
                                    {s.sharedName && <span className="mb-0.5 block text-[11px] font-medium text-accent-700">Shared: {s.sharedName}</span>}
                                    {s.action}
                                  </span>
                                  <span className="whitespace-pre-wrap wrap-anywhere text-slate-600">{s.expected}</span>
                                </li>
                              ))}
                            </ol>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {result.cases.length > 100 && <p className="px-4 py-2 text-xs text-slate-500">Showing the first 100.</p>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/** A radio choice drawn as a card. */
function Choice({
  checked,
  disabled,
  onSelect,
  name,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cx(
        "flex gap-3 rounded-lg border px-3.5 py-3 text-sm",
        checked ? "border-accent-500 bg-accent-50/60" : "border-slate-200",
        disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:border-accent-300",
      )}
    >
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onSelect} className="mt-0.5 size-4 flex-none accent-accent-600" />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

function FolderPreviewRows({ nodes, depth }: { nodes: FolderPreview[]; depth: number }) {
  const total = (n: FolderPreview): number => n.count + n.children.reduce((s, c) => s + total(c), 0);
  return (
    <>
      {nodes.map((n) => (
        <Fragment key={n.name}>
          <li className="flex items-center gap-1.5 py-0.5 text-slate-700" style={{ paddingLeft: depth * 16 }}>
            <span aria-hidden>📁</span>
            {n.name}
            {n.count > 0 && <span className="text-xs text-slate-400">{total(n)}</span>}
          </li>
          <FolderPreviewRows nodes={n.children} depth={depth + 1} />
        </Fragment>
      ))}
    </>
  );
}

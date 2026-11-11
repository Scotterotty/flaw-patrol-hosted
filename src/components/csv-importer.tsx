"use client";

import Link from "next/link";
import Papa from "papaparse";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import {
  detectSource,
  findHeaderRow,
  multiLineTitles,
  perRunColumns,
  rowLabel,
  runSheetRows,
  sheetResultCount,
  SHEET_HANDOFF,
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
  packedSteps,
  stepLines,
  stepPerRow,
  type ColumnMapping,
  type ImportWarning,
  type ImportField,
  type ImportSource,
} from "@/lib/csv-import";
import { count, PRIORITY_LABEL } from "@/lib/format";
import { findAreaWords, applyAreaWord, type AreaContext } from "@/lib/area-tags";
import { splitBracketTitle } from "@/lib/tags";
import { importCases } from "@/server/import";
import { readSpreadsheet } from "@/server/spreadsheet";
import { checkStoryKeys } from "@/server/stories";
import { Button, Card, cx, ErrorText, Field, InfoTip, Input, Select } from "./ui";

/** Where imported cases can go: the umbrella's Case library, this test cycle, or a test cycle outside any umbrella. */
export type ImportPlace = { id: string; key: string; label: string; kind: "library" | "cycle" | "own"; folderOptions: { id: string; label: string }[]; area: AreaContext };

const NEW_FOLDER = "__new";

export function CsvImporter({
  projectId,
  places,
  initialPlaceId,
  initialFolderId,
  initialFolderPlaceId,
  runHref,
}: {
  projectId: string;
  places: ImportPlace[];
  initialPlaceId: string;
  initialFolderId: string | null;
  initialFolderPlaceId: string;
  /** Where Create a run opens, for "Next: run these cases" after an import (ver_216). Null when you can't create runs. */
  runHref?: string | null;
}) {
  const [placeId, setPlaceId] = useState(initialPlaceId);
  const place = places.find((p) => p.id === placeId) ?? places[0];
  const folderOptions = place.folderOptions;
  const startFolder = placeId === initialFolderPlaceId ? initialFolderId : null;
  // Folders built from the file's Folder column, one folder for the whole file, or no folder.
  // A file with a Folder column (TestRail sections) keeps its folders unless you choose otherwise.
  const [folderMode, setFolderMode] = useState<"one" | "file" | "none" | null>(null);
  // The folder the file's folders go in: "" for none, a folder, or NEW_FOLDER named parentName.
  const [parentName, setParentName] = useState("");
  // "Have these cases been run before?": nothing picked until you answer.
  const [runBefore, setRunBefore] = useState<boolean | null>(null);
  // The import warning whose case and step the preview opened ("Show me the step").
  const [shownWarning, setShownWarning] = useState<ImportWarning | null>(null);
  const [oneFolder, setOneFolder] = useState(startFolder ?? NEW_FOLDER);
  const [newFolderName, setNewFolderName] = useState("");
  const [keepWhole, setKeepWhole] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][] | null>(null);
  // The row with the column names (0 = row 1), and the one we found by ourselves (ver_169).
  const [headerRow, setHeaderRow] = useState(0);
  const [foundRow, setFoundRow] = useState(0);
  // A title with several lines: first line is the title, the rest goes to Expected. Picked for you.
  const [firstLineTitle, setFirstLineTitle] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  // ver_216: Match your columns shows the matched ones; the rest wait under Show all columns.
  // A box you changed stays put, so it doesn't vanish when you set it to (Not imported).
  const [showAllFields, setShowAllFields] = useState(false);
  const [pinned, setPinned] = useState<ImportField[]>([]);
  const [source, setSource] = useState<ImportSource>("other");
  const [folderId, setFolderId] = useState(startFolder ?? "");
  const [error, setError] = useState<string | null>(null);
  const [restoreBreaks, setRestoreBreaks] = useState(false);
  // Lines under a step's name go to Expected. Picked by default; the card only shows when a file has such steps.
  const [moveExpected, setMoveExpected] = useState(true);
  // "Keep one more line in the step" in the preview: lines each step keeps, by "caseRow:stepIndex".
  const [keepLines, setKeepLines] = useState<Record<string, number>>({});
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [done, setDone] = useState<{ cases: number; shared: number; folderId: string | null; place: ImportPlace; results: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, start] = useTransition();

  const header = rows?.[headerRow] ?? [];
  const result = useMemo(
    () => (rows ? rowsToCases(rows, mapping, source, { restoreBreaks, keepWhole, moveExpected, keepLines, headerRow, firstLineTitle }) : null),
    [rows, mapping, source, restoreBreaks, keepWhole, moveExpected, keepLines, headerRow, firstLineTitle],
  );
  // Column names below row 1 make it a checklist sheet: section rows and multi-line titles (ver_169).
  const sheetMode = headerRow > 0;
  const longTitles = useMemo(() => (rows && sheetMode ? multiLineTitles(rows, mapping, headerRow) : 0), [rows, mapping, headerRow, sheetMode]);
  const titleSplit = sheetMode && firstLineTitle && longTitles > 0;
  const runColumns = perRunColumns(header, mapping);
  // ver_216: only the boxes that matter. Title always; Expected too when it comes from the title's extra lines.
  const fieldShown = (f: ImportField) => f === "title" || mapping[f] !== undefined || pinned.includes(f) || (f === "expected" && titleSplit && mapping.title !== undefined);
  const shownFields = IMPORT_FIELDS.filter((f) => showAllFields || fieldShown(f));
  const hiddenFields = IMPORT_FIELDS.filter((f) => !fieldShown(f)).length;
  const usedCols = new Set(Object.values(mapping).filter((v): v is number => v !== undefined));
  // Blank-named columns with nothing in them, and the ones filled in during a run, don't count as unmatched.
  const usableCols = header.filter((h, i) => (h ?? "").trim() || usedCols.has(i)).length;
  const matchedCols = header.filter((_, i) => usedCols.has(i)).length;
  const unmatched = header.flatMap((h, i) => ((h ?? "").trim() && !usedCols.has(i) && !runColumns.includes(i) ? [i] : []));
  const sheetResults = useMemo(() => (rows ? sheetResultCount(rows, headerRow) : 0), [rows, headerRow]);
  // Rows offered in "Use a different row": the first 50 that aren't blank.
  const rowChoices = useMemo(
    () => (rows ?? []).slice(0, 50).flatMap((r, i) => (r.some((c) => (c ?? "").trim()) ? [{ i, label: `Row ${i + 1}: ${rowLabel(r)}` }] : [])),
    [rows],
  );
  // Rows that will show as section titles once imported, said in the preview before importing.
  const titleCount = useMemo(() => (result ? result.cases.reduce((n, c) => n + numberedSteps(c, result.shared).filter((s) => s.title).length, 0) : 0), [result]);
  // Steps with more lines under their name, counted as the file has them (before any are moved),
  // and how many lines each step had, for the preview's keep-a-line buttons.
  const packed = useMemo(() => {
    if (!rows || !stepPerRow(source)) return { steps: 0, cases: 0, lines: new Map<string, number>() };
    const cases = rowsToCases(rows, mapping, source, { restoreBreaks, keepWhole, headerRow, firstLineTitle }).cases;
    const lines = new Map<string, number>();
    for (const c of cases) c.steps.forEach((s, k) => lines.set(`${c.row}:${k}`, stepLines(s.action).length));
    return { ...packedSteps(cases), lines };
  }, [rows, mapping, source, restoreBreaks, keepWhole, headerRow, firstLineTitle]);
  const keepMore = (key: string, by: number) => setKeepLines((m) => ({ ...m, [key]: Math.max(1, (m[key] ?? 1) + by) }));
  const slashNames = useMemo(() => (rows ? spacedSlashNames(rows, mapping, headerRow) : []), [rows, mapping, headerRow]);
  const hasFolders = (mapping.folder !== undefined || !!result?.sections.length) && !!result?.cases.some((c) => c.folderPath.length);
  const mode: "file" | "one" | "none" = folderMode === "none" ? "none" : hasFolders && folderMode !== "one" ? "file" : "one";
  const oneMode = mode === "one";
  const rootLabel = place.kind === "library" ? `${place.label.replace(/ case library$/i, "")} Case library` : place.label;
  const parentPath = folderId && folderId !== NEW_FOLDER ? (folderOptions.find((f) => f.id === folderId)?.label.split(" / ") ?? []) : [];
  // Area tags: the word after the platform. Words that are already tags (or [bracket]
  // tags in this file) are picked up on their own; new ones are listed with a tick box.
  const [areaOn, setAreaOn] = useState(true);
  const [areaOff, setAreaOff] = useState<string[]>([]);
  const areaPreview = useMemo(() => {
    if (!result) return null;
    const names = [...place.area.platforms, ...place.area.known];
    const split = result.cases.map((c) => {
      const s = splitBracketTitle(c.title, { platforms: names });
      // With no platforms, only the [bracket] tag leads; the file's own tags come after.
      return { title: s.title, tags: place.area.platforms.length ? [...s.tags, ...c.tags] : s.tags };
    });
    const ctx = { ...place.area, known: [...place.area.known, ...split.flatMap((c) => c.tags)] };
    return { split, ctx, words: findAreaWords(split, ctx) };
  }, [result, place.area]);
  const areaWords = areaOn && areaPreview ? areaPreview.words.filter((w) => w.known || !areaOff.includes(w.word)).map((w) => w.word) : [];
  const areaNew = areaPreview?.words.filter((w) => !w.known) ?? [];
  const areaTagsFor = (i: number) => {
    const c = areaPreview?.split[i];
    return c && areaWords.length ? applyAreaWord(c.title, c.tags, areaWords, areaPreview.ctx)?.tags.at(-1) : undefined;
  };
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
  const oneFolderLabel = oneFolder === NEW_FOLDER ? newFolderName.trim() : folderOptions.find((f) => f.id === oneFolder)?.label.split(" / ").pop();
  const needsName = (oneMode && oneFolder === NEW_FOLDER && !newFolderName.trim()) || (mode === "file" && folderId === NEW_FOLDER && !parentName.trim());
  // Where the cases land, for the Import button: a folder's name, or nothing for the top.
  const intoLabel = mode === "one" ? oneFolderLabel : mode === "file" ? (folderId === NEW_FOLDER ? parentName.trim() : parentPath.at(-1)) : "";
  // Which steps of each case came from a row with no ID, to label in the preview.
  const flaggedSteps = useMemo(() => {
    const out = new Map<number, Map<number, string>>();
    for (const w of result?.warnings ?? []) if (w.caseRow !== undefined && w.step !== undefined) out.set(w.caseRow, (out.get(w.caseRow) ?? new Map()).set(w.step, w.chip ?? ""));
    return out;
  }, [result]);
  useEffect(() => {
    if (!shownWarning?.caseRow) return;
    const id = shownWarning.step !== undefined ? `import-step-${shownWarning.caseRow}-${shownWarning.step}` : `import-case-${shownWarning.caseRow}`;
    document.getElementById(id)?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [shownWarning]);
  const pickPlace = (id: string) => {
    setPlaceId(id);
    const keep = id === initialFolderPlaceId ? initialFolderId : null;
    setFolderId(keep ?? "");
    setOneFolder(keep ?? NEW_FOLDER);
  };
  const chooseSource = (next: ImportSource, head: string[]) => {
    setSource(next);
    setMapping(guessMapping(head, next));
    setPinned([]);
    setRestoreBreaks(next === "qtest");
  };

  // Read the sheet with a different row as its column names.
  const pickHeaderRow = (data: string[][], h: number) => {
    setHeaderRow(h);
    setKeepLines({});
    setKeepWhole([]);
    chooseSource(detectSource(data[h] ?? []), data[h] ?? []);
  };

  const accept = (name: string, raw: string[][]) => {
    // Blank rows are kept so row numbers match the spreadsheet; trailing ones are dropped.
    const data = [...raw];
    while (data.length && data[data.length - 1].every((c) => !(c ?? "").trim())) data.pop();
    if (data.filter((r) => r.some((c) => (c ?? "").trim())).length < 2) return setError("That file has no rows under the header.");
    data[0][0] = (data[0][0] ?? "").replace(/^﻿/, "");
    const h = findHeaderRow(data);
    setFileName(name);
    setRows(data);
    setFoundRow(h);
    setFirstLineTitle(true);
    // A test cycle of its own gets a folder named after the file. The Case library is
    // used by every release, so its folder is named after what the cases test instead.
    if (place.kind !== "library") setNewFolderName((n) => n || name.replace(/\.[^.]+$/, "").replace(/[/>\\]/g, "-").slice(0, 100));
    pickHeaderRow(data, h);
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
      skipEmptyLines: false,
      complete: (res) => accept(file.name, res.data.map((r) => r.map((c) => String(c ?? "")))),
      error: (e) => setError(`Couldn't read the file: ${e.message}`),
    });
  };

  const doImport = () =>
    start(async () => {
      if (!result || runBefore === null) return;
      setError(null);
      const cases = mode === "file" ? result.cases : result.cases.map((c) => ({ ...c, folderPath: [] }));
      // A new folder is made at the top; in file mode the file's folders then go inside it.
      const [target, newName] =
        mode === "none" ? [null, ""] : mode === "one" ? (oneFolder === NEW_FOLDER ? [null, newFolderName] : [oneFolder, ""]) : folderId === NEW_FOLDER ? [null, parentName] : [folderId || null, ""];
      const area = { words: areaWords, skip: areaOn ? areaNew.filter((w) => areaOff.includes(w.word)).map((w) => w.word) : [] };
      const res = await importCases(place.id, target, cases, fileName, result.shared, newName, area, runBefore);
      if (!res.ok) return setError(res.error);
      setDone({ cases: res.created, shared: res.shared, folderId: res.folderId, place, results: sheetResults });
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
        {/* ver_216: the next step leads on, so a first import doesn't end at "what now?". */}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {runHref && done.cases > 0 && (
            <Link href={runHref} data-testid="import-next-run" className="inline-flex h-9 items-center rounded-md bg-accent-600 px-3.5 text-sm font-medium text-white hover:bg-accent-700">
              Next: run {done.cases === 1 ? "this case" : `these ${done.cases} cases`}
            </Link>
          )}
          <Link
            href={`/p/${done.place.key}/cases${done.folderId ? `?folder=${done.folderId}` : ""}`}
            data-howto="import-view"
            className={
              runHref && done.cases > 0
                ? "inline-flex h-9 items-center rounded-md border border-slate-300 bg-surface px-3.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                : "inline-flex h-9 items-center rounded-md bg-accent-600 px-3.5 text-sm font-medium text-white hover:bg-accent-700"
            }
          >
            View cases
          </Link>
          <Button
            onClick={() => {
              setRows(null);
              setDone(null);
            }}
          >
            Import another file
          </Button>
        </div>
        {done.results > 0 && rows && (
          <p className="mt-4 text-sm text-slate-700" data-testid="sheet-results-link">
            This sheet has {count(done.results, "result")} too.{" "}
            <Link
              href={done.place.kind === "library" ? `/p/${done.place.key}/runs?sheet=handoff` : `/p/${done.place.key}/runs/import?sheet=handoff`}
              onClick={() => handOffSheet(fileName, runSheetRows(rows, mapping, { headerRow, firstLineTitle }, source))}
              className="font-medium text-accent-700 underline"
            >
              Bring them into a run →
            </Link>
          </p>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <label
        data-howto="import-drop"
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
          {foundRow > 0 && (
            <div role="status" className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900" data-testid="header-row-found">
              <p className="font-semibold">
                {headerRow === foundRow ? `We found your column names on row ${headerRow + 1}` : `Column names from row ${headerRow + 1}`}
              </p>
              <p className="mt-0.5 text-xs text-sky-800">
                {headerRow > 0 ? `The rows above it${aboveExamples(rows, headerRow)} are skipped.` : "Every row under it is read as a case."}
              </p>
              <label className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">Use a different row</span>
                <Select aria-label="Use a different row" className="h-8 w-auto max-w-full text-xs" value={headerRow} onChange={(e) => pickHeaderRow(rows, Number(e.target.value))}>
                  {rowChoices.map((r) => (
                    <option key={r.i} value={r.i}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          )}

          {longTitles > 0 && mapping.title !== undefined && (
            <Card className="p-5" data-testid="long-titles">
              <h2 className="mb-1 text-sm font-semibold text-slate-800">Some titles have more than one line</h2>
              <p className="mb-3 text-xs text-slate-500">
                {count(longTitles, "title")} in the {header[mapping.title] || "Title"} column {longTitles === 1 ? "has" : "have"} more lines under the first. Already picked for you. You don&apos;t have to answer this to import.
              </p>
              <div className="space-y-2" role="radiogroup" aria-label="What to do with titles that have more than one line">
                <Choice checked={firstLineTitle} onSelect={() => setFirstLineTitle(true)} name="first-line-title">
                  <span className="font-medium text-slate-900">Use the first line as the title; the rest goes to Expected</span>
                  <span className="ml-2 rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-medium text-accent-700">Recommended</span>
                </Choice>
                <Choice checked={!firstLineTitle} onSelect={() => setFirstLineTitle(false)} name="first-line-title">
                  <span className="font-medium text-slate-900">Keep the whole text as the title</span>
                </Choice>
              </div>
            </Card>
          )}

          {result.sections.length > 0 && (
            <Card className="p-5" data-testid="section-rows">
              <h2 className="mb-1 text-sm font-semibold text-slate-800">
                {result.sections.length === 1 ? "1 row looks like a section name" : `${result.sections.length} rows look like section names`}
              </h2>
              <p className="mb-2 text-xs text-slate-500">They have only one filled cell, so they become top folders for the cases under them.</p>
              <ul className="space-y-0.5 text-sm text-slate-700">
                {sectionSummary(result.sections, tree).map((s) => (
                  <li key={s.name}>
                    <span aria-hidden>📁</span> <span className="font-medium">{s.name}</span>
                    {s.children && <span className="text-slate-500"> › {s.children}</span>} <span className="text-xs text-slate-500">({count(s.cases, "case")})</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-5">
            <Field label="Where is this file from?" htmlFor="import-source" hint="Matches that tool's columns, folders and formatting exactly. We picked it from the column names.">
              <Select
                id="import-source"
                data-howto="import-source"
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

          {packed.steps > 0 && mapping.steps !== undefined && (
            <Card className="p-5" data-testid="packed-steps">
              <h2 className="mb-1 text-sm font-semibold text-slate-800">Some steps have their expected results inside them</h2>
              <p className="mb-3 text-xs text-slate-500">
                {packed.steps} {packed.steps === 1 ? "step" : "steps"} in {packed.cases} {packed.cases === 1 ? "case" : "cases"} {packed.steps === 1 ? "has" : "have"} more lines under the step name, like
                &ldquo;A user is able to&hellip;&rdquo;. Those lines are usually what should happen, so they belong in Expected.
              </p>
              <div className="space-y-2" role="radiogroup" aria-label="What to do with the lines under the step name">
                <Choice checked={moveExpected} onSelect={() => setMoveExpected(true)} name="move-expected">
                  <span className="font-medium text-slate-900">Move the lines under the step name to Expected</span>
                  <span className="ml-2 rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-medium text-accent-700">Recommended</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    The first line stays as the step. If Expected already has text, like &ldquo;Not Supported by: UNITY&rdquo;, it stays on top. To keep more of a step, open
                    its case in the preview below.
                  </span>
                </Choice>
                <Choice checked={!moveExpected} onSelect={() => setMoveExpected(false)} name="move-expected">
                  <span className="font-medium text-slate-900">Keep the steps as they are</span>
                  <span className="mt-0.5 block text-xs text-slate-500">Everything in the step cell stays in the step.</span>
                </Choice>
              </div>
            </Card>
          )}

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
                : "This file has no folders in it."}
              {!folderOptions.length && ` ${place.kind === "library" ? "Your Case library" : "This test cycle"} has no folders yet.`}
            </p>
            {/* Plain choices, and a dropdown only when there's a real folder to pick. */}
            <div className="space-y-2" role="radiogroup" aria-label="Which folder?">
              {hasFolders && (
                <Choice checked={mode === "file"} onSelect={() => setFolderMode("file")} name="folder-mode">
                  <span className="font-medium text-slate-900">Use the file&apos;s folders</span>
                  <span className="ml-2 rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-medium text-accent-700">Recommended</span>
                  {mode === "file" && (
                    <span className="mt-2 block space-y-2">
                      <span className="block text-xs text-slate-500" id="make-them-in">
                        Make them in:
                      </span>
                      <span role="radiogroup" aria-labelledby="make-them-in" className="block max-h-56 max-w-md overflow-auto rounded-md border border-slate-200 bg-surface p-1">
                        <PickRow on={folderId === ""} onPick={() => setFolderId("")}>
                          <span aria-hidden>📚</span> {rootLabel} <span className="text-xs opacity-75">(no parent folder)</span>
                        </PickRow>
                        {folderOptions.map((f) => (
                          <PickRow key={f.id} on={folderId === f.id} onPick={() => setFolderId(f.id)} depth={f.label.split(" / ").length}>
                            <span aria-hidden>📁</span> {f.label.split(" / ").pop()}
                          </PickRow>
                        ))}
                        <PickRow on={folderId === NEW_FOLDER} onPick={() => setFolderId(NEW_FOLDER)} depth={1} add>
                          ＋ New folder…
                        </PickRow>
                      </span>
                      {folderId === NEW_FOLDER && (
                        <Input
                          aria-label="New folder to make them in"
                          aria-invalid={needsName || undefined}
                          placeholder="New folder name, e.g. 2026 Imports"
                          className={cx("h-8 w-72 max-w-full text-sm", needsName && "border-amber-500 ring-1 ring-amber-500")}
                          maxLength={100}
                          value={parentName}
                          onChange={(e) => setParentName(e.target.value.replace(/[/>\\]/g, "-"))}
                        />
                      )}
                      <span className="block text-xs text-slate-500">You&apos;ll get these folders:</span>
                      <ul className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm" aria-label="Folders this import makes">
                        <li className="py-0.5 text-xs text-slate-500">
                          <span aria-hidden>📚</span> {[rootLabel, ...parentPath].join(" › ")}
                        </li>
                        {folderId === NEW_FOLDER && (
                          <li className="flex items-center gap-1.5 py-0.5 font-medium text-accent-700" style={{ paddingLeft: 16 }}>
                            <span aria-hidden>📁</span>
                            {parentName.trim() || "Your new folder"}
                            <span className="text-xs font-normal text-slate-400">new</span>
                          </li>
                        )}
                        <FolderPreviewRows nodes={tree} depth={folderId === NEW_FOLDER ? 2 : 1} />
                      </ul>
                      {slashNames.map((name) => {
                        const kept = keepWhole.includes(name);
                        return (
                          <span key={name} className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
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
              )}
              <Choice checked={mode === "one"} onSelect={() => setFolderMode("one")} name="folder-mode">
                <span className="font-medium text-slate-900">{folderOptions.length ? "Put them all in one folder" : "Put them all in one new folder"}</span>
                {mode === "one" && (
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    {folderOptions.length > 0 && (
                      <Select aria-label="Folder for all cases" className="h-8 w-auto max-w-full text-sm" value={oneFolder} onChange={(e) => setOneFolder(e.target.value)}>
                        <option value={NEW_FOLDER}>A new folder</option>
                        {folderOptions.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </Select>
                    )}
                    {oneFolder === NEW_FOLDER && (
                      <Input
                        aria-label="New folder name"
                        aria-invalid={needsName || undefined}
                        placeholder={place.kind === "library" ? "Name it after what the cases test" : "Folder name"}
                        className={cx("h-8 w-72 max-w-full text-sm", needsName && "border-amber-500 ring-1 ring-amber-500")}
                        maxLength={100}
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value.replace(/[/>\\]/g, "-"))}
                      />
                    )}
                  </span>
                )}
                {mode === "one" && (
                  <span className="mt-1.5 block text-xs text-slate-500">
                    All {result.cases.length} cases go here.{hasFolders && " The file's Folder column is ignored."}
                    {place.kind === "library" && " Name the folder after what the cases test, since every run can use it."}
                  </span>
                )}
              </Choice>
              <Choice checked={mode === "none"} onSelect={() => setFolderMode("none")} name="folder-mode">
                <span className="font-medium text-slate-900">Don&apos;t use folders</span>
                {mode === "none" && (
                  <span className="mt-1.5 block text-xs text-slate-500">
                    All {result.cases.length} cases go straight into {place.kind === "library" ? "the " : ""}
                    {rootLabel}, not in any folder.
                  </span>
                )}
              </Choice>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-800">Have these cases been run before?</h2>
            <p className="mb-3 text-xs text-slate-500">So runs know whether to tag them New.</p>
            <div className="space-y-2" role="radiogroup" aria-label="Have these cases been run before?" data-howto="import-run-before">
              <Choice checked={runBefore === true} onSelect={() => setRunBefore(true)} name="run-before">
                <span className="font-medium text-slate-900">Yes, we&apos;ve run them before</span>
                <span className="mt-0.5 block text-xs text-slate-500">For cases you already test with, for example from TestRail or a spreadsheet. Runs won&apos;t call them new.</span>
              </Choice>
              <Choice checked={runBefore === false} onSelect={() => setRunBefore(false)} name="run-before">
                <span className="font-medium text-slate-900">No, they&apos;re brand new</span>
                <span className="mt-0.5 block text-xs text-slate-500">Runs tag them New until someone runs them, so people read them carefully.</span>
              </Choice>
            </div>
          </Card>

          <Card className="p-5" data-howto="import-columns">
            <h2 className="mb-1 text-sm font-semibold text-slate-800">Match your columns</h2>
            <p className="mb-1 text-sm text-slate-700" data-testid="import-matched-count">
              We matched {matchedCols} of your {usableCols} {usableCols === 1 ? "column" : "columns"}.
            </p>
            <p className="mb-4 text-xs text-slate-600">We guessed from the header names. Only Title is required. Rows that share a case ID, as in qTest exports, become one case.</p>
            {unmatched.length > 0 && (
              <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="import-not-matched">
                Not matched: {listNames(unmatched.map((i) => header[i] || `Column ${i + 1}`))}. {unmatched.length === 1 ? "It isn't" : "They aren't"} imported unless you pick {unmatched.length === 1 ? "it" : "them"} below{showAllFields ? "" : " under Show all columns"}.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shownFields.map((f: ImportField) => (
                <Field
                  key={f}
                  label={FIELD_LABEL[f] + (f === "title" ? " *" : "")}
                  htmlFor={`map-${f}`}
                  hint={f === "folder" && mode !== "file" && mapping.folder !== undefined ? (mode === "none" ? "Not used: the cases go in no folder" : "Not used: all cases go in one folder") : undefined}
                >
                  <Select
                    id={`map-${f}`}
                    value={mapping[f] ?? ""}
                    onChange={(e) => {
                      setMapping((m) => ({ ...m, [f]: e.target.value === "" ? undefined : Number(e.target.value) }));
                      setPinned((p) => (p.includes(f) ? p : [...p, f]));
                    }}
                  >
                    <option value="">
                      {f === "expected" && titleSplit && mapping.title !== undefined ? `${header[mapping.title] || "Title"} (lines under the first)` : "(Not imported)"}
                    </option>
                    {header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
            {hiddenFields > 0 && (
              <button
                type="button"
                aria-expanded={showAllFields}
                onClick={() => setShowAllFields(!showAllFields)}
                className="mt-3 text-sm font-medium text-accent-700 hover:underline"
                data-testid="import-show-all-columns"
              >
                {showAllFields ? "▾ Show only matched columns" : `▸ Show all columns (${hiddenFields} more)`}
              </button>
            )}
            {runColumns.length > 0 && (
              <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600" data-testid="per-run-columns">
                {listNames(runColumns.map((i) => header[i]))} {runColumns.length === 1 ? "is" : "are"} left out. {runColumns.length === 1 ? "It's" : "They're"} filled in during a run.
                {sheetResults > 0 && ` This sheet has ${count(sheetResults, "result")} too: after you import, you can bring them into a run with one click.`}
              </p>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">
                  Preview: {count(result.cases.length, "case")}, {count(result.cases.reduce((n, c) => n + c.steps.length, 0), "step")}
                  {result.shared.length > 0 && `, ${result.shared.length} shared ${result.shared.length === 1 ? "step" : "steps"}`}
                </h2>
                <p className="text-xs text-slate-500">Click a case to see its steps as they&apos;ll be numbered.</p>
                {titleCount > 0 && (
                  <p className="mt-1 text-xs text-slate-600" data-testid="section-titles-note">
                    {count(titleCount, "row")} with nothing to check (like a short name such as SIGN IN or Space Lists with no expected result) will show as{" "}
                    {titleCount === 1 ? "a section title" : "section titles"} for the steps below {titleCount === 1 ? "it" : "them"}, with no result buttons.
                  </p>
                )}
                {typeTagged.length > 0 && (
                  <p className="mt-1 text-xs text-slate-600" data-testid="type-tags-note">
                    The file&apos;s Type values ({typeTagged.slice(0, 4).join(", ")}
                    {typeTagged.length > 4 ? "…" : ""}) become tags like &quot;type: {typeTagged[0]}&quot;, because Flaw Patrol&apos;s Type is only Manual or Automated.
                  </p>
                )}
                {result.cases.length > MAX_IMPORT && <p className="text-xs text-red-600">Split the file: at most {MAX_IMPORT} cases per import.</p>}
              </div>
              <span className="flex flex-wrap items-center justify-end gap-2">
                {/* The reason in words, not only in a hover tip on a gray button. */}
                {needsName && <span className="text-xs font-medium text-amber-800">Name the folder first</span>}
                {runBefore === null && <span className="text-xs font-medium text-amber-800">Answer &ldquo;Have these cases been run before?&rdquo;</span>}
                {!result.cases.length && <span className="text-xs font-medium text-amber-800">No cases found: check the Title column</span>}
                <Button
                  variant="primary"
                  disabled={pending || needsName || runBefore === null || !result.cases.length || result.cases.length > MAX_IMPORT}
                  title={needsName ? "Name the new folder first" : runBefore === null ? "Answer “Have these cases been run before?” first" : undefined}
                  onClick={doImport}
                  data-howto="import-go"
                >
                  {pending ? "Importing…" : intoLabel ? `Import ${count(result.cases.length, "case")} into "${intoLabel}"` : `Import ${count(result.cases.length, "case")}`}
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
            {!!areaPreview?.words.length && (
              <div className="space-y-1.5 border-b border-slate-200 px-4 py-2 text-xs text-slate-600" data-testid="import-area">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="accent-accent-600" checked={areaOn} onChange={(e) => setAreaOn(e.target.checked)} />
                  Turn the area word after the platform into a tag
                  <InfoTip text="In “[UNITY] Spaces - Deep Link”, Spaces is the part of the app. Words that are already tags are picked up on their own." />
                </label>
                {areaOn && (
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6">
                    {areaPreview.words.some((w) => w.known) && (
                      <span>
                        Already tags: {areaPreview.words.filter((w) => w.known).map((w) => `${w.word} (${w.count})`).join(", ")}.
                      </span>
                    )}
                    {areaNew.length > 0 && <span>New area words:</span>}
                    {areaNew.map((w) => (
                      <label key={w.word} className="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          className="accent-accent-600"
                          checked={!areaOff.includes(w.word)}
                          onChange={(e) => setAreaOff(e.target.checked ? areaOff.filter((x) => x !== w.word) : [...areaOff, w.word])}
                        />
                        {w.word} ({w.count})
                      </label>
                    ))}
                  </p>
                )}
              </div>
            )}
            {result.warnings.length > 0 && (
              <details open className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800" data-testid="import-warnings">
                <summary className="cursor-pointer font-medium">
                  {result.warnings.length} {result.warnings.length === 1 ? "thing" : "things"} to check before you import
                </summary>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
                  {result.warnings.slice(0, 50).map((w, i) => {
                    // Only the first 100 cases are listed below, so only those can be opened.
                    const listed = w.caseRow !== undefined && result.cases.findIndex((c) => c.row === w.caseRow) < 100;
                    return (
                      <li key={i}>
                        {w.lead && <b>{w.lead} </b>}
                        {w.text}
                        {listed && (
                          <>
                            {" "}
                            <button
                              type="button"
                              className="font-medium text-amber-900 underline"
                              onClick={() => {
                                setOpenRow(w.caseRow!);
                                setShownWarning({ ...w });
                              }}
                            >
                              {w.step !== undefined ? "Show me the step" : "Show me the case"}
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">File row</th>
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Folder</th>
                    <th className="px-3 py-2 font-medium">Priority</th>
                    <th className="px-3 py-2 font-medium">Tags</th>
                    {storyCount > 0 && <th className="px-3 py-2 font-medium">Requirements</th>}
                    <th className="px-3 py-2 font-medium">Steps</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.cases.slice(0, 100).map((c, i) => (
                    <Fragment key={c.row}>
                      <tr className={cx("align-top", shownWarning?.caseRow === c.row && shownWarning.step === undefined && "bg-amber-50")} id={`import-case-${c.row}`}>
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
                        <td className="px-3 py-1.5 text-xs text-slate-500">{mode === "none" ? "No folder" : oneMode ? oneFolderLabel : c.folderPath.join(" / ")}</td>
                        <td className="px-3 py-1.5 text-xs">{PRIORITY_LABEL[c.priority]}</td>
                        <td className="px-3 py-1.5 text-xs text-slate-500">
                          {[...c.tags, areaTagsFor(i)].filter(Boolean).join(", ")}
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
                            {moveExpected && c.steps.some((_, k) => (packed.lines.get(`${c.row}:${k}`) ?? 0) > 1) && (
                              <p className="mb-2 text-xs text-slate-500">
                                <span className="rounded bg-green-50 px-1 text-green-800">Green lines</span> move from the step to Expected. If a step needs one of them, click
                                Keep one more line in the step.
                              </p>
                            )}
                            <ol className="divide-y divide-slate-100 rounded-md border border-slate-200 text-xs">
                              {numberedSteps(c, result.shared).map((s, k) => {
                                const chip = flaggedSteps.get(c.row)?.get(k);
                                return (
                                <li
                                  key={k}
                                  id={`import-step-${c.row}-${k}`}
                                  className={cx("grid grid-cols-[3rem_1fr_1fr] gap-3 px-3 py-2", chip !== undefined && "bg-amber-50", shownWarning?.caseRow === c.row && shownWarning.step === k && "ring-2 ring-amber-400 ring-inset")}
                                >
                                  <span className="font-mono text-slate-500">{s.number}</span>
                                  <span className={cx("whitespace-pre-wrap wrap-anywhere text-slate-800", s.title && "font-bold")}>
                                    {s.sharedName && <span className="mb-0.5 block text-[11px] font-medium text-accent-700">Shared: {s.sharedName}</span>}
                                    {s.action}
                                    {chip && <span className="ml-1.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-amber-900">{chip}</span>}
                                  </span>
                                  <span className="whitespace-pre-wrap wrap-anywhere text-slate-600">
                                    <MovedExpected
                                      expected={s.expected}
                                      had={moveExpected ? (packed.lines.get(`${c.row}:${k}`) ?? 0) : 0}
                                      kept={keepLines[`${c.row}:${k}`] ?? 1}
                                      onKeep={(by) => keepMore(`${c.row}:${k}`, by)}
                                    />
                                  </span>
                                </li>
                                );
                              })}
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

/**
 * A preview step's Expected text. Lines that moved there from the step are the last ones and
 * show in green, with buttons to keep one more line in the step or undo that.
 */
function MovedExpected({ expected, had, kept, onKeep }: { expected: string; had: number; kept: number; onKeep: (by: number) => void }) {
  if (had < 2) return <>{expected}</>;
  const lines = expected.split("\n");
  const cut = Math.max(0, lines.length - (had - kept));
  const button = "rounded border border-slate-300 bg-surface px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:border-slate-400";
  return (
    <>
      {cut > 0 && `${lines.slice(0, cut).join("\n")}\n`}
      <span className="rounded bg-green-50 text-green-800" data-testid="moved-lines">
        {lines.slice(cut).join("\n")}
      </span>
      <span className="mt-1 flex flex-wrap gap-1.5">
        {kept < had - 1 && (
          <button type="button" className={button} onClick={() => onKeep(1)}>
            Keep one more line in the step
          </button>
        )}
        {kept > 1 && (
          <button type="button" className={button} onClick={() => onKeep(-1)}>
            Undo
          </button>
        )}
      </span>
    </>
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

/** One place in the "Make them in" folder list. */
function PickRow({ on, onPick, depth = 0, add, children }: { on: boolean; onPick: () => void; depth?: number; add?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cx(
        "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm",
        on ? "bg-accent-600 text-white" : cx("hover:bg-accent-50", add ? "font-medium text-accent-700" : "text-slate-800"),
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {children}
    </button>
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

/** " like Run Status, Date and Tester": the first cells of a few rows above the column names. */
function aboveExamples(rows: string[][], headerRow: number): string {
  const names = rows
    .slice(0, headerRow)
    .map((r) => (r.find((c) => (c ?? "").trim()) ?? "").trim().replace(/:$/, ""))
    .filter(Boolean)
    .slice(0, 3);
  return names.length ? ` (like ${listNames(names)})` : "";
}

/** "A", "A and B", "A, B and C". */
function listNames(names: string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Each section's folder, the first few folders inside it and how many cases it holds. */
function sectionSummary(sections: { name: string }[], tree: FolderPreview[]) {
  const total = (n: FolderPreview): number => n.count + n.children.reduce((s, c) => s + total(c), 0);
  const seen = new Set<string>();
  return sections.flatMap((s) => {
    const key = s.name.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    const node = tree.find((n) => n.name.toLowerCase() === key);
    const kids = node?.children.map((c) => c.name) ?? [];
    return [{ name: s.name, cases: node ? total(node) : 0, children: kids.length ? kids.slice(0, 3).join(", ") + (kids.length > 3 ? " …" : "") : "" }];
  });
}

/** Hands the sheet to "Results from a spreadsheet" in this tab, so nobody has to pick the file again. */
function handOffSheet(fileName: string, rows: string[][]) {
  try {
    sessionStorage.setItem(SHEET_HANDOFF, JSON.stringify({ fileName, rows, at: Date.now() }));
  } catch {
    // Too big or storage blocked: the import page still opens, and the file can be picked there.
  }
}
